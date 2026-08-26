import type { ServerEnv } from '@banhao/config';

/**
 * Phase D · R2 storage foundation.
 *
 * `@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner` are mocked at the
 * module boundary — no real R2 request is ever made here (Step 14). What's
 * asserted is the actual command `StorageService` builds (bucket, key,
 * ContentType, expiry), not just that *something* resolved, matching this
 * codebase's existing "assert the query that was built" test convention.
 *
 * `@banhao/config`'s `loadServerEnv` is mocked too, and each test sets its
 * return value before constructing `StorageService` — the constructor takes
 * no arguments (matching `SupabaseService`), so this is the only seam left to
 * control what environment the service sees. This also means these tests
 * exercise the exact same call `StorageService` makes under real NestJS DI,
 * closing the gap the previous DI-readiness review found.
 */

const sendMock = jest.fn();
const s3ClientConstructorSpy = jest.fn();

jest.mock('@aws-sdk/client-s3', () => {
  class FakePutObjectCommand {
    constructor(public readonly input: Record<string, unknown>) {}
  }
  class FakeDeleteObjectCommand {
    constructor(public readonly input: Record<string, unknown>) {}
  }
  class FakeHeadObjectCommand {
    constructor(public readonly input: Record<string, unknown>) {}
  }
  class FakeGetObjectCommand {
    constructor(public readonly input: Record<string, unknown>) {}
  }
  class FakeListObjectsV2Command {
    constructor(public readonly input: Record<string, unknown>) {}
  }
  // Mirrors the real `NotFound` exception's `instanceof`-checkable shape.
  // Defined inside the factory — jest.mock() factories may not reference
  // out-of-scope variables/classes.
  class FakeNotFound extends Error {
    constructor() {
      super('NotFound');
      this.name = 'NotFound';
    }
  }
  class FakeS3Client {
    constructor(config: Record<string, unknown>) {
      s3ClientConstructorSpy(config);
    }
    send = sendMock;
  }
  return {
    S3Client: FakeS3Client,
    PutObjectCommand: FakePutObjectCommand,
    DeleteObjectCommand: FakeDeleteObjectCommand,
    HeadObjectCommand: FakeHeadObjectCommand,
    GetObjectCommand: FakeGetObjectCommand,
    ListObjectsV2Command: FakeListObjectsV2Command,
    NotFound: FakeNotFound,
  };
});

const getSignedUrlMock = jest.fn();
jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: (...args: unknown[]) => getSignedUrlMock(...args),
}));

const loadServerEnvMock = jest.fn();
jest.mock('@banhao/config', () => ({
  loadServerEnv: () => loadServerEnvMock(),
}));

// Imported after the mocks above so StorageService picks them up.
import { NotFound } from '@aws-sdk/client-s3';
import { StorageService, StorageConfigError } from './storage.service';

const FULL_ENV: Partial<ServerEnv> = {
  r2AccountId: 'acct-123',
  r2AccessKeyId: 'access-key-123',
  r2SecretAccessKey: 'secret-key-123',
  r2Bucket: 'banhao-assets',
  r2PublicUrl: 'https://assets.banhao.app/',
};

function envMissing(...keys: (keyof ServerEnv)[]): ServerEnv {
  const env = { ...FULL_ENV } as ServerEnv;
  for (const key of keys) delete (env as Record<string, unknown>)[key];
  return env;
}

/** Sets what the next `new StorageService()` call sees, then constructs it. */
function serviceWith(env: ServerEnv): StorageService {
  loadServerEnvMock.mockReturnValue(env);
  return new StorageService();
}

/** The common case: all five R2 variables present. */
function service(): StorageService {
  return serviceWith(FULL_ENV as ServerEnv);
}

beforeEach(() => {
  sendMock.mockReset();
  s3ClientConstructorSpy.mockReset();
  getSignedUrlMock.mockReset();
  loadServerEnvMock.mockReset();
  getSignedUrlMock.mockResolvedValue('https://acct-123.r2.cloudflarestorage.com/signed?sig=x');
});

describe('StorageService — configuration', () => {
  it.each([
    'r2AccountId',
    'r2AccessKeyId',
    'r2SecretAccessKey',
    'r2Bucket',
    'r2PublicUrl',
  ] as const)('throws StorageConfigError when %s is missing', (key) => {
    expect(() => serviceWith(envMissing(key))).toThrow(StorageConfigError);
  });

  it('names every missing variable, not just the first', () => {
    expect(() => serviceWith(envMissing('r2AccountId', 'r2Bucket'))).toThrow(
      /R2_ACCOUNT_ID.*R2_BUCKET|R2_BUCKET.*R2_ACCOUNT_ID/,
    );
  });

  it('constructs successfully with all five present', () => {
    expect(() => service()).not.toThrow();
  });

  it('reads configuration via loadServerEnv(), not an injected parameter', () => {
    // The constructor takes zero arguments (see storage.service.ts) — this is
    // the one seam available to prove it actually calls the real loader.
    service();
    expect(loadServerEnvMock).toHaveBeenCalledTimes(1);
    expect(loadServerEnvMock).toHaveBeenCalledWith();
  });

  it('configures the S3 client for the R2 endpoint with region auto, once', () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const _service = service();

    expect(s3ClientConstructorSpy).toHaveBeenCalledTimes(1);
    expect(s3ClientConstructorSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        region: 'auto',
        endpoint: 'https://acct-123.r2.cloudflarestorage.com',
      }),
    );
  });

  it('never logs or throws the secret access key itself', () => {
    // The constructor's only log line names the bucket, not the credentials —
    // asserted by construction: nothing in storage.service.ts ever passes
    // r2SecretAccessKey to `this.logger`. A missing-config error also never
    // includes a value, only variable *names* (see the previous test).
    let thrown: unknown;
    try {
      serviceWith(envMissing('r2AccountId'));
    } catch (error) {
      thrown = error;
    }
    expect(String(thrown)).not.toContain(FULL_ENV.r2SecretAccessKey);
  });
});

describe('StorageService.getPublicUrl', () => {
  it('joins the configured base and the key with exactly one slash', () => {
    expect(service().getPublicUrl('restaurants/r1/cover.webp')).toBe(
      'https://assets.banhao.app/restaurants/r1/cover.webp',
    );
  });

  it('normalises a trailing slash on the configured base', () => {
    const withTrailingSlash = serviceWith({
      ...FULL_ENV,
      r2PublicUrl: 'https://assets.banhao.app///',
    } as ServerEnv);

    expect(withTrailingSlash.getPublicUrl('restaurants/r1/cover.webp')).toBe(
      'https://assets.banhao.app/restaurants/r1/cover.webp',
    );
  });

  it('rejects an unsafe key', () => {
    expect(() => service().getPublicUrl('../etc/passwd')).toThrow();
  });
});

describe('StorageService.getSignedUploadUrl', () => {
  it('signs a PutObjectCommand for the configured bucket and exact key', async () => {
    await service().getSignedUploadUrl('restaurants/r1/cover.webp', 'image/webp');

    const [, command] = getSignedUrlMock.mock.calls[0] as [unknown, { input: Record<string, unknown> }];
    expect(command.input).toEqual({
      Bucket: 'banhao-assets',
      Key: 'restaurants/r1/cover.webp',
      ContentType: 'image/webp',
    });
  });

  it('applies the default 300-second expiry', async () => {
    await service().getSignedUploadUrl('restaurants/r1/cover.webp', 'image/webp');

    const options = getSignedUrlMock.mock.calls[0][2] as { expiresIn: number };
    expect(options.expiresIn).toBe(300);
  });

  it('honours a caller-supplied expiry', async () => {
    await service().getSignedUploadUrl('restaurants/r1/cover.webp', 'image/webp', 120);

    const options = getSignedUrlMock.mock.calls[0][2] as { expiresIn: number };
    expect(options.expiresIn).toBe(120);
  });

  it('returns the signed URL, never the credentials that produced it', async () => {
    const url = await service().getSignedUploadUrl('restaurants/r1/cover.webp', 'image/webp');

    expect(url).toBe('https://acct-123.r2.cloudflarestorage.com/signed?sig=x');
    expect(url).not.toContain(FULL_ENV.r2SecretAccessKey);
    expect(url).not.toContain(FULL_ENV.r2AccessKeyId);
  });

  it('rejects an unsafe key before ever calling getSignedUrl', async () => {
    await expect(service().getSignedUploadUrl('../escape', 'image/webp')).rejects.toThrow();
    expect(getSignedUrlMock).not.toHaveBeenCalled();
  });
});

describe('StorageService.delete', () => {
  it('issues a DeleteObjectCommand for the configured bucket and exact key', async () => {
    await service().delete('restaurants/r1/cover.webp');

    expect(sendMock).toHaveBeenCalledTimes(1);
    const command = sendMock.mock.calls[0][0] as { input: Record<string, unknown> };
    expect(command.input).toEqual({ Bucket: 'banhao-assets', Key: 'restaurants/r1/cover.webp' });
  });

  it('never allows the caller to select a different bucket', async () => {
    await service().delete('restaurants/r1/cover.webp');

    const command = sendMock.mock.calls[0][0] as { input: Record<string, unknown> };
    // The bucket comes from config alone — `delete` takes only a key.
    expect(command.input.Bucket).toBe('banhao-assets');
  });

  it('rejects an unsafe key before ever calling R2', async () => {
    await expect(service().delete('../escape')).rejects.toThrow();
    expect(sendMock).not.toHaveBeenCalled();
  });
});

describe('StorageService.upload', () => {
  it('issues a PutObjectCommand with the exact key, body and content type', async () => {
    const body = Buffer.from('fake-image-bytes');
    const result = await service().upload({
      key: 'restaurants/r1/cover.webp',
      body,
      contentType: 'image/webp',
    });

    expect(result).toEqual({ key: 'restaurants/r1/cover.webp' });
    const command = sendMock.mock.calls[0][0] as { input: Record<string, unknown> };
    expect(command.input).toEqual({
      Bucket: 'banhao-assets',
      Key: 'restaurants/r1/cover.webp',
      Body: body,
      ContentType: 'image/webp',
    });
  });

  it('rejects an unsafe key before ever calling R2', async () => {
    await expect(
      service().upload({ key: '../escape', body: Buffer.from(''), contentType: 'image/webp' }),
    ).rejects.toThrow();
    expect(sendMock).not.toHaveBeenCalled();
  });
});

describe('StorageService.exists', () => {
  it('returns true when HeadObject succeeds', async () => {
    sendMock.mockResolvedValueOnce({});

    await expect(service().exists('restaurants/r1/cover.webp')).resolves.toBe(true);

    const command = sendMock.mock.calls[0][0] as { input: Record<string, unknown> };
    expect(command.input).toEqual({ Bucket: 'banhao-assets', Key: 'restaurants/r1/cover.webp' });
  });

  it('returns false for a real NotFound, rather than throwing', async () => {
    sendMock.mockRejectedValueOnce(new NotFound({ message: 'not found', $metadata: {} }));

    await expect(service().exists('restaurants/r1/cover.webp')).resolves.toBe(false);
  });

  it('rethrows any other failure — a 404 is not the same as "cannot tell"', async () => {
    sendMock.mockRejectedValueOnce(new Error('network timeout'));

    await expect(service().exists('restaurants/r1/cover.webp')).rejects.toThrow(
      'network timeout',
    );
  });

  it('rejects an unsafe key before ever calling R2', async () => {
    await expect(service().exists('../escape')).rejects.toThrow();
    expect(sendMock).not.toHaveBeenCalled();
  });
});

/**
 * The public/private bucket split — POD, Phase G-7.2 Phase 2.
 *
 * `R2_PUBLIC_URL` is an `*.r2.dev` development domain, and public access in R2
 * is granted **per bucket**. So a proof photo placed in `R2_BUCKET` would be
 * fetchable by anyone holding its key. These tests assert that the split is
 * real at the command level — which bucket each operation names — rather than
 * a naming convention inside one bucket.
 */
const PRIVATE_ENV: Partial<ServerEnv> = { ...FULL_ENV, r2PrivateBucket: 'banhao-private' };

function privateService(): StorageService {
  return serviceWith(PRIVATE_ENV as ServerEnv);
}

describe('StorageService — the private bucket', () => {
  it('defaults every existing operation to the PUBLIC bucket, unchanged', async () => {
    await privateService().getSignedUploadUrl('restaurants/x/cover.jpg', 'image/jpeg');

    const command = getSignedUrlMock.mock.calls[0]?.[1] as { input: Record<string, unknown> };
    expect(command.input.Bucket).toBe('banhao-assets');
  });

  it('presigns an upload into the private bucket when asked', async () => {
    await privateService().getSignedUploadUrl('deliveries/x/proof/y.jpg', 'image/jpeg', 300, 'private');

    const command = getSignedUrlMock.mock.calls[0]?.[1] as { input: Record<string, unknown> };
    expect(command.input.Bucket).toBe('banhao-private');
  });

  it('checks existence against the private bucket when asked', async () => {
    sendMock.mockResolvedValue({});

    await privateService().exists('deliveries/x/proof/y.jpg', 'private');

    const command = sendMock.mock.calls[0]?.[0] as { input: Record<string, unknown> };
    expect(command.input.Bucket).toBe('banhao-private');
  });

  it('signs a download URL against the private bucket by default', async () => {
    await privateService().getSignedDownloadUrl('deliveries/x/proof/y.jpg');

    const command = getSignedUrlMock.mock.calls[0]?.[1] as { input: Record<string, unknown> };
    expect(command.input.Bucket).toBe('banhao-private');
    expect(command.input.Key).toBe('deliveries/x/proof/y.jpg');
  });

  it('gives a download URL a short default expiry — an authorization, not a link', async () => {
    await privateService().getSignedDownloadUrl('deliveries/x/proof/y.jpg');

    expect(getSignedUrlMock.mock.calls[0]?.[2]).toEqual({ expiresIn: 120 });
  });

  it('refuses a private operation when R2_PRIVATE_BUCKET is unset, rather than falling back', async () => {
    // A fallback here would put proof photos in the bucket R2_PUBLIC_URL
    // serves — precisely what the split exists to prevent.
    await expect(service().getSignedDownloadUrl('deliveries/x/proof/y.jpg')).rejects.toBeInstanceOf(
      StorageConfigError,
    );
  });

  it('still serves public operations when R2_PRIVATE_BUCKET is unset', async () => {
    await expect(
      service().getSignedUploadUrl('restaurants/x/cover.jpg', 'image/jpeg'),
    ).resolves.toEqual(expect.any(String));
  });

  it('refuses at startup when the two buckets are the same', () => {
    expect(() =>
      serviceWith({ ...FULL_ENV, r2PrivateBucket: 'banhao-assets' } as ServerEnv),
    ).toThrow(StorageConfigError);
  });

  it('rejects an unsafe key on the private path too', async () => {
    await expect(
      privateService().getSignedDownloadUrl('deliveries/../../etc/passwd'),
    ).rejects.toThrow(/unsafe object key/i);
  });
});

/**
 * `listObjects` — added for the POD retention orphan sweep (DEC-039,
 * `ProofPhotoRetentionService`), which has no `deliveries` row to start from
 * and must discover candidate objects directly in R2.
 */
describe('StorageService — listObjects', () => {
  it('defaults to the private bucket — the only bucket POD objects live in', async () => {
    sendMock.mockResolvedValue({ Contents: [], IsTruncated: false });

    await privateService().listObjects('deliveries/');

    const command = sendMock.mock.calls[0]?.[0] as { input: Record<string, unknown> };
    expect(command.input.Bucket).toBe('banhao-private');
    expect(command.input.Prefix).toBe('deliveries/');
  });

  it('passes maxKeys and continuationToken through to the R2 command', async () => {
    sendMock.mockResolvedValue({ Contents: [], IsTruncated: false });

    await privateService().listObjects('deliveries/', 'private', {
      maxKeys: 100,
      continuationToken: 'tok-1',
    });

    const command = sendMock.mock.calls[0]?.[0] as { input: Record<string, unknown> };
    expect(command.input.MaxKeys).toBe(100);
    expect(command.input.ContinuationToken).toBe('tok-1');
  });

  it('maps Contents to {key, lastModified} and drops any entry with no Key', async () => {
    const lastModified = new Date('2026-01-01T00:00:00Z');
    sendMock.mockResolvedValue({
      Contents: [
        { Key: 'deliveries/a/proof/x.jpg', LastModified: lastModified },
        { LastModified: lastModified }, // no Key — must be dropped, not crash
      ],
      IsTruncated: false,
    });

    const result = await privateService().listObjects('deliveries/');

    expect(result.objects).toEqual([{ key: 'deliveries/a/proof/x.jpg', lastModified }]);
  });

  it('returns the continuation token only when R2 reports truncation', async () => {
    sendMock.mockResolvedValue({ Contents: [], IsTruncated: true, NextContinuationToken: 'tok-2' });

    const truncated = await privateService().listObjects('deliveries/');
    expect(truncated.nextContinuationToken).toBe('tok-2');

    sendMock.mockResolvedValue({ Contents: [], IsTruncated: false, NextContinuationToken: 'tok-2' });
    const notTruncated = await privateService().listObjects('deliveries/');
    expect(notTruncated.nextContinuationToken).toBeUndefined();
  });

  it('rejects an unsafe prefix before ever calling R2', async () => {
    await expect(privateService().listObjects('../escape/')).rejects.toThrow(/unsafe object prefix/i);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('allows a bare namespace prefix ending in "/" — listObjects is not a key', async () => {
    sendMock.mockResolvedValue({ Contents: [], IsTruncated: false });
    await expect(privateService().listObjects('deliveries/')).resolves.toEqual({
      objects: [],
      nextContinuationToken: undefined,
    });
  });
});
