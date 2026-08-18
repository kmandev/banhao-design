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
