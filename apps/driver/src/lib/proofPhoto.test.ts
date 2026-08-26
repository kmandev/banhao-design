import {
  prepareProofPhoto,
  ProofPhotoInvalidError,
  PROOF_PHOTO_CONTENT_TYPE,
  PROOF_PHOTO_MAX_BYTES,
  PROOF_PHOTO_MAX_DIMENSION,
  PROOF_PHOTO_QUALITY,
} from './proofPhoto';

/**
 * Proof photo preparation — POD, Phase G-7.2 Phase 2.
 *
 * `expo-image-manipulator` is mocked at the module boundary; what is asserted
 * is the manipulation `prepareProofPhoto` actually asks for (resize target,
 * quality, output format) and the guards it applies to the result — not merely
 * that something resolved. That matters because the EXIF property this module
 * depends on is a *consequence* of re-encoding to JPEG, so the re-encode
 * request is the thing worth pinning down.
 */

// `mock`-prefixed so jest's out-of-scope guard admits it in the factory below.
const mockManipulateAsync = jest.fn();

jest.mock('expo-image-manipulator', () => ({
  manipulateAsync: (...args: unknown[]) => mockManipulateAsync(...args),
  SaveFormat: { JPEG: 'jpeg', PNG: 'png' },
}));

const OK_RESULT = { uri: 'file:///tmp/proof.jpg', width: 1600, height: 1200 };

beforeEach(() => {
  mockManipulateAsync.mockReset();
  mockManipulateAsync.mockResolvedValue(OK_RESULT);
});

/** A stand-in for reading the prepared file's byte count. */
function bytes(size: number) {
  return jest.fn(async () => size);
}

describe('prepareProofPhoto — the re-encode', () => {
  it('resizes to the documented long edge and re-encodes as JPEG', async () => {
    await prepareProofPhoto('file:///tmp/camera.jpg', { measureBytes: bytes(400_000) });

    expect(mockManipulateAsync).toHaveBeenCalledWith(
      'file:///tmp/camera.jpg',
      [{ resize: { width: PROOF_PHOTO_MAX_DIMENSION } }],
      { compress: PROOF_PHOTO_QUALITY, format: 'jpeg' },
    );
  });

  it('constrains only ONE dimension, so a portrait capture is not squashed', async () => {
    await prepareProofPhoto('file:///tmp/camera.jpg', { measureBytes: bytes(400_000) });

    const actions = mockManipulateAsync.mock.calls[0]?.[1] as { resize: Record<string, number> }[];
    expect(Object.keys(actions[0]!.resize)).toEqual(['width']);
  });

  it('re-encodes rather than passing the camera file through — which is what drops EXIF', async () => {
    const result = await prepareProofPhoto('file:///tmp/camera.jpg', {
      measureBytes: bytes(400_000),
    });

    // An unstripped EXIF block would smuggle GPS into an object the customer
    // can download, in a flow that deliberately captures no location.
    expect(result.uri).toBe(OK_RESULT.uri);
    expect(result.uri).not.toBe('file:///tmp/camera.jpg');
    expect(mockManipulateAsync).toHaveBeenCalledTimes(1);
  });

  it('always reports image/jpeg — the one type the re-encode emits', async () => {
    const result = await prepareProofPhoto('file:///tmp/camera.jpg', {
      measureBytes: bytes(400_000),
    });

    // Telling the presign endpoint anything else would produce a
    // Content-Type-scoped URL the upload then fails against.
    expect(result.contentType).toBe(PROOF_PHOTO_CONTENT_TYPE);
  });

  it('stamps a capture time and returns the prepared dimensions', async () => {
    const capturedAt = new Date('2026-08-26T11:45:12.000Z');

    const result = await prepareProofPhoto('file:///tmp/camera.jpg', {
      capturedAt,
      measureBytes: bytes(400_000),
    });

    expect(result.capturedAt).toBe(capturedAt.toISOString());
    expect(result).toMatchObject({ width: 1600, height: 1200 });
  });
});

describe('prepareProofPhoto — the local validity gate', () => {
  it('rejects an empty source URI without calling the manipulator', async () => {
    await expect(prepareProofPhoto('')).rejects.toBeInstanceOf(ProofPhotoInvalidError);
    expect(mockManipulateAsync).not.toHaveBeenCalled();
  });

  it('rejects a manipulator failure as an invalid photo, not a crash', async () => {
    mockManipulateAsync.mockRejectedValue(new Error('decode failed'));

    await expect(
      prepareProofPhoto('file:///tmp/camera.jpg', { measureBytes: bytes(400_000) }),
    ).rejects.toBeInstanceOf(ProofPhotoInvalidError);
  });

  it('rejects a manipulator result with no URI', async () => {
    mockManipulateAsync.mockResolvedValue({ width: 0, height: 0 });

    await expect(
      prepareProofPhoto('file:///tmp/camera.jpg', { measureBytes: bytes(400_000) }),
    ).rejects.toBeInstanceOf(ProofPhotoInvalidError);
  });

  it('rejects a zero-byte file — it must never reach the review screen', async () => {
    await expect(
      prepareProofPhoto('file:///tmp/camera.jpg', { measureBytes: bytes(0) }),
    ).rejects.toThrow(/ว่างเปล่า/);
  });

  it('rejects a file over the ceiling', async () => {
    await expect(
      prepareProofPhoto('file:///tmp/camera.jpg', { measureBytes: bytes(PROOF_PHOTO_MAX_BYTES + 1) }),
    ).rejects.toThrow(/ใหญ่เกินไป/);
  });

  it('accepts a file exactly at the ceiling', async () => {
    await expect(
      prepareProofPhoto('file:///tmp/camera.jpg', { measureBytes: bytes(PROOF_PHOTO_MAX_BYTES) }),
    ).resolves.toMatchObject({ uri: OK_RESULT.uri });
  });

  it('rejects an unreadable file rather than uploading an unknown quantity', async () => {
    const measureBytes = jest.fn(async () => {
      throw new Error('ENOENT');
    });

    await expect(
      prepareProofPhoto('file:///tmp/camera.jpg', { measureBytes }),
    ).rejects.toBeInstanceOf(ProofPhotoInvalidError);
  });
});
