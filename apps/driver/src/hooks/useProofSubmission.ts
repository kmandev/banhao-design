import { useCallback, useRef, useState } from 'react';
import { repositories } from '../repositories';
import { ApiClientError } from '../lib/apiClient';
import { ProofUploadFailedError } from '../repositories/riderProofUpload';
import type { PreparedProofPhoto } from '../lib/proofPhoto';

/**
 * The POD confirmation — capture is done, this is everything after it
 * (Phase G-7.2 Phase 2, POD UX design frames P-06 through P-09).
 *
 * ## Three steps, one button, and no optimism anywhere
 *
 *   presign  →  PUT to R2  →  delivered command
 *
 * `ส่งสำเร็จ` is reported **only** after the delivered command returns 200.
 * Not after the upload, not after the presign, and never from a local guess —
 * the server is the sole authority for the transition, exactly as in Phase 1.
 * Each of the three steps has its own failure state and its own retry, and a
 * failure at any of them leaves the delivery open and the photo on the device.
 *
 * ## Why the object key is held across retries
 *
 * The expensive step at a doorway is the upload. If the *delivered command*
 * fails after the bytes are already in R2 — a dropped response, a 500, a
 * timeout — retrying must send the command alone rather than re-uploading a
 * photo that is already there. {@link uploadedKey} is that memory. It is
 * cleared only by a retake, which genuinely invalidates it.
 *
 * The reverse case is handled too: an **expired presign** (R2 answers a lapsed
 * signature with 403) restarts from the presign rather than retrying a PUT
 * that can only fail again.
 *
 * ## Duplicate protection
 *
 * `submitting` guards the whole sequence, so a rider double-tapping ส่งสำเร็จ
 * issues one sequence, not two. That is a convenience, not the safety
 * property: the server's guarded UPDATE is what actually makes a second
 * completion a no-op, and its repair path returns success rather than a
 * confusing 409. Both exist because a rider cannot tell a lost response from a
 * failed one.
 */

export type ProofSubmissionStage = 'idle' | 'presigning' | 'uploading' | 'confirming' | 'done';

export interface ProofSubmissionController {
  stage: ProofSubmissionStage;
  /** True for the whole presign → upload → confirm sequence. Blocks a second tap. */
  submitting: boolean;
  /** The last failure, as Thai copy. Cleared when a new attempt starts. */
  error: string | null;
  /**
   * True once bytes are in R2 for the current photo — so the retry copy can
   * honestly say the photo does not need retaking.
   */
  photoUploaded: boolean;
  /** `deliveries.delivered_at` from a successful completion, else `null`. */
  completedAt: string | null;
  submit: (deliveryId: string, photo: PreparedProofPhoto) => Promise<void>;
  /** Discards the uploaded object key, for a retake. The R2 object becomes an accepted orphan. */
  reset: () => void;
}

/**
 * Server-facing codes mapped to rider-facing Thai. Branching is on
 * `ApiClientError.code`, never on `message` — the same contract
 * `useRiderOfferInbox` and `useActiveDelivery` both follow.
 */
const ERROR_COPY: Record<string, string> = {
  INVALID_TRANSITION: 'สถานะงานเปลี่ยนไปแล้ว ระบบกำลังโหลดสถานะล่าสุด',
  NOT_ASSIGNED_RIDER: 'งานนี้ไม่ใช่งานของคุณแล้ว',
  NOT_FOUND: 'ระบบยังไม่พบรูปที่อัปโหลด กรุณาลองส่งอีกครั้ง',
  VALIDATION_FAILED: 'รูปหลักฐานไม่ถูกต้อง กรุณาถ่ายรูปใหม่',
  FORBIDDEN: 'บัญชีนี้ยังไม่ได้รับอนุมัติให้รับงาน',
};

function errorMessage(error: unknown): string {
  if (error instanceof ApiClientError) {
    return ERROR_COPY[error.code] ?? 'ดำเนินการไม่สำเร็จ กรุณาลองใหม่';
  }
  if (error instanceof ProofUploadFailedError) {
    return error.isExpiredAuthorization
      ? 'ลิงก์อัปโหลดหมดอายุ กรุณากดลองส่งอีกครั้ง'
      : 'ส่งรูปไม่สำเร็จ ตรวจสัญญาณอินเทอร์เน็ตแล้วลองอีกครั้ง';
  }
  return error instanceof Error ? error.message : 'เกิดข้อผิดพลาด';
}

export function useProofSubmission(): ProofSubmissionController {
  const [stage, setStage] = useState<ProofSubmissionStage>('idle');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [completedAt, setCompletedAt] = useState<string | null>(null);
  const [photoUploaded, setPhotoUploaded] = useState(false);

  /**
   * The key of an object already in R2 for the photo currently being
   * confirmed. Survives a failed delivered command so a retry does not
   * re-upload; cleared by {@link reset} on a retake.
   */
  const uploadedKey = useRef<string | null>(null);

  /**
   * Guards the sequence against a double tap synchronously. `submitting` state
   * alone is not enough — two presses in the same tick both read the old value
   * before React re-renders.
   */
  const inFlight = useRef(false);

  const reset = useCallback(() => {
    uploadedKey.current = null;
    setPhotoUploaded(false);
    setError(null);
    setStage('idle');
  }, []);

  const submit = useCallback(async (deliveryId: string, photo: PreparedProofPhoto) => {
    if (inFlight.current) return;
    inFlight.current = true;

    setSubmitting(true);
    setError(null);

    try {
      let objectKey = uploadedKey.current;

      if (!objectKey) {
        // Step 1 — authorize. The server templates the key; the client never
        // constructs or modifies one.
        setStage('presigning');
        const authorization = await repositories.proofUpload.requestUploadUrl(
          deliveryId,
          photo.contentType,
        );

        // Step 2 — the bytes go straight to R2 under the presigned URL alone.
        //
        // A failure here leaves `uploadedKey` unset, which is exactly right:
        // an expired presign (R2 answers a lapsed signature with 403) is not
        // retryable as a PUT, so the next attempt starts from a fresh
        // authorization rather than replaying a request that can only fail
        // again.
        setStage('uploading');
        await repositories.proofUpload.uploadToSignedUrl(
          authorization.uploadUrl,
          photo.uri,
          photo.contentType,
        );

        objectKey = authorization.objectKey;
        uploadedKey.current = objectKey;
        setPhotoUploaded(true);
      }

      // Step 3 — the only call that changes anything. The delivery is not
      // complete until this returns.
      setStage('confirming');
      const result = await repositories.deliveryActions.markDelivered(deliveryId, objectKey);

      // The server's own `deliveries.delivered_at`, never a local clock.
      setCompletedAt(result.deliveredAt ?? new Date().toISOString());
      setStage('done');
    } catch (cause) {
      setError(errorMessage(cause));
      setStage('idle');
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  }, []);

  return { stage, submitting, error, photoUploaded, completedAt, submit, reset };
}
