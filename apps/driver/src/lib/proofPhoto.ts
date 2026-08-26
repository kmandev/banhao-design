import * as ImageManipulator from 'expo-image-manipulator';

/**
 * Proof photo preparation — POD, Phase G-7.2 Phase 2.
 *
 * Sits between the camera and the upload, and exists for three reasons that
 * are all load-bearing rather than cosmetic:
 *
 * 1. **Size.** A modern phone camera produces a 3–8 MB JPEG. A rider at a
 *    doorway in อำเภอบุณฑริก on rural mobile data is the single most likely
 *    place an upload fails, and an uncompressed file is the single most likely
 *    reason. Re-encoding to a 1600 px long edge at quality 0.7 lands well under
 *    the ceiling below while staying ample as evidence of where food was left.
 *
 * 2. **EXIF.** A camera JPEG can carry GPS coordinates, a device identifier
 *    and a precise timestamp. The POD design deliberately captures **no**
 *    location — but an unstripped EXIF block would smuggle one into an object
 *    the customer can later download. `ImageManipulator.manipulateAsync`
 *    re-encodes the pixels and writes a fresh file, which drops EXIF as a
 *    consequence of how it works. That is asserted by test rather than assumed,
 *    because "it happens to strip it" is not a security property until
 *    something checks.
 *
 * 3. **A local validity gate.** A zero-byte or unreadable capture must never
 *    reach the review screen, let alone an upload. Failing here costs one
 *    retake; failing at the doorway after a 40-second upload costs the rider
 *    real time.
 *
 * The MIME type is fixed to `image/jpeg` because that is what the re-encode
 * emits. The server's allow-list also admits png and webp (for the merchant
 * flows), but POD only ever produces one format, and telling the presign
 * endpoint something the file is not would produce a `Content-Type`-scoped URL
 * the upload then fails against.
 */

/**
 * The long edge, in pixels, every proof photo is resized to.
 *
 * Chosen for legibility of a doorway and a food bag, not for archival quality.
 * A larger image does not make the evidence better; it makes the upload
 * likelier to fail.
 */
export const PROOF_PHOTO_MAX_DIMENSION = 1600;

/** JPEG quality after re-encode. */
export const PROOF_PHOTO_QUALITY = 0.7;

/**
 * The hard ceiling a prepared photo must come in under.
 *
 * At 1600 px / q0.7 a real photograph lands around 200–500 KB, so 2 MB is a
 * generous backstop that only fires if the manipulator produced something
 * unexpected. It is a local guard, not the security boundary — the API applies
 * its own limit, because a client-side check protects nobody from a client
 * that skips it.
 */
export const PROOF_PHOTO_MAX_BYTES = 2 * 1024 * 1024;

/** The one MIME type this module ever produces. */
export const PROOF_PHOTO_CONTENT_TYPE = 'image/jpeg';

export interface PreparedProofPhoto {
  /** A local `file://` URI for the re-encoded copy — never the camera's original. */
  uri: string;
  width: number;
  height: number;
  contentType: typeof PROOF_PHOTO_CONTENT_TYPE;
  /** When the rider pressed the shutter, from the device clock. Display only. */
  capturedAt: string;
}

/** A capture that could not be turned into a usable proof photo. */
export class ProofPhotoInvalidError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProofPhotoInvalidError';
  }
}

/**
 * How this module reads a prepared file's size.
 *
 * Injected rather than imported so a test never needs a filesystem, and so the
 * app does not take an `expo-file-system` dependency for one `HEAD`-shaped
 * question. `fetch` on a `file://` URI is supported by React Native's
 * networking stack and returns a blob whose `size` is the byte count.
 */
export type MeasureBytes = (uri: string) => Promise<number>;

const measureViaFetch: MeasureBytes = async (uri) => {
  const response = await fetch(uri);
  const blob = await response.blob();
  return blob.size;
};

/**
 * Re-encodes a camera capture into an upload-ready proof photo.
 *
 * Throws {@link ProofPhotoInvalidError} for anything unusable — an empty URI,
 * a manipulator failure, a zero-byte result, or a file over the ceiling. The
 * caller surfaces that as "ถ่ายไม่สำเร็จ ลองอีกครั้ง" and keeps the camera
 * open; it never advances to review with a file it could not validate.
 */
export async function prepareProofPhoto(
  sourceUri: string,
  options: { capturedAt?: Date; measureBytes?: MeasureBytes } = {},
): Promise<PreparedProofPhoto> {
  if (!sourceUri) {
    throw new ProofPhotoInvalidError('ไม่พบไฟล์รูปจากกล้อง');
  }

  const measureBytes = options.measureBytes ?? measureViaFetch;
  const capturedAt = (options.capturedAt ?? new Date()).toISOString();

  let result: { uri: string; width: number; height: number };
  try {
    result = await ImageManipulator.manipulateAsync(
      sourceUri,
      // Only the long edge is constrained; the manipulator preserves aspect
      // ratio when one dimension is given, so a portrait capture is not
      // squashed into a landscape frame.
      [{ resize: { width: PROOF_PHOTO_MAX_DIMENSION } }],
      { compress: PROOF_PHOTO_QUALITY, format: ImageManipulator.SaveFormat.JPEG },
    );
  } catch (cause) {
    throw new ProofPhotoInvalidError(
      cause instanceof Error ? cause.message : 'ประมวลผลรูปไม่สำเร็จ',
    );
  }

  if (!result?.uri) {
    throw new ProofPhotoInvalidError('ประมวลผลรูปไม่สำเร็จ');
  }

  let bytes: number;
  try {
    bytes = await measureBytes(result.uri);
  } catch (cause) {
    throw new ProofPhotoInvalidError(
      cause instanceof Error ? cause.message : 'อ่านไฟล์รูปไม่สำเร็จ',
    );
  }

  if (bytes <= 0) {
    throw new ProofPhotoInvalidError('ไฟล์รูปว่างเปล่า');
  }

  if (bytes > PROOF_PHOTO_MAX_BYTES) {
    throw new ProofPhotoInvalidError('ไฟล์รูปใหญ่เกินไป');
  }

  return {
    uri: result.uri,
    width: result.width,
    height: result.height,
    contentType: PROOF_PHOTO_CONTENT_TYPE,
    capturedAt,
  };
}
