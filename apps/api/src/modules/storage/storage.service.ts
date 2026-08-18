import { Injectable, Logger } from '@nestjs/common';
import {
  DeleteObjectCommand,
  HeadObjectCommand,
  NotFound,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { loadServerEnv } from '@banhao/config';

/**
 * Cloudflare R2 storage, behind a provider-agnostic boundary
 * (Phase D · R2 storage foundation).
 *
 * R2 exposes an S3-compatible API (`region: 'auto'`, endpoint
 * `https://<account>.r2.cloudflarestorage.com`), so this uses the AWS SDK v3
 * rather than Cloudflare's Worker-only R2 bindings — this API runs on Cloud
 * Run, not a Worker.
 *
 * **No business module may import `@aws-sdk/client-s3` directly.** Everything
 * outside this file depends on `StorageService`'s methods, never on
 * `S3Client`/`PutObjectCommand`/etc. — that is the whole point: swapping R2
 * for another S3-compatible provider later touches this one file only.
 *
 * First live caller: M-11, `apps/api/src/modules/merchant/restaurant-cover.*`
 * — the restaurant cover upload flow. Object-key shaping for restaurant
 * covers lives in `object-key.ts`, kept separate so this class stays
 * entity-agnostic and reusable for menu/delivery storage later without
 * modification.
 *
 * **Constructor takes no arguments** — matches `SupabaseService` exactly, and
 * for the same reason: a design-time TypeScript type (`ServerEnv`) is not a
 * NestJS DI token, and an optional constructor parameter typed with one
 * (`env?: ServerEnv`) is not resolvable by the real container — Nest reflects
 * it as a bare `Object` token, finds no provider for it, and throws
 * `UnknownDependenciesException` before the constructor body ever runs. That
 * shape was tried and empirically failed under `Test.createTestingModule` in
 * the readiness review that preceded this fix; calling `loadServerEnv()`
 * unconditionally here is what makes this class constructible by Nest DI at
 * all. Tests mock `@banhao/config`'s `loadServerEnv` export instead of
 * injecting an env object directly.
 */

export interface UploadInput {
  key: string;
  body: Buffer;
  contentType: string;
}

/** A short-lived, single-object, single-operation authorization — never a credential. */
const DEFAULT_SIGNED_UPLOAD_EXPIRY_SECONDS = 300;

/** Thrown when R2 is used before all five configuration values are present. */
export class StorageConfigError extends Error {
  constructor(missing: string[]) {
    super(
      `Cloudflare R2 storage is not configured. Missing: ${missing.join(', ')}. ` +
        'Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET and ' +
        'R2_PUBLIC_URL — see .env.example.',
    );
    this.name = 'StorageConfigError';
  }
}

/**
 * Rejects a key containing `..`, a leading `/`, or an empty segment.
 *
 * Defence in depth, matching this codebase's existing pattern (e.g.
 * `CartService`'s restaurant_id cross-check): every key this module actually
 * produces (`object-key.ts`) is already safe by construction, but every
 * method here that accepts a `key` string checks it again anyway, so a future
 * caller that skips the key builder fails loudly instead of reaching R2.
 */
function assertSafeObjectKey(key: string): void {
  if (
    key.length === 0 ||
    key.startsWith('/') ||
    key.includes('..') ||
    key.split('/').some((segment) => segment.length === 0)
  ) {
    throw new Error(`Refusing unsafe object key: ${key}`);
  }
}

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly bucket: string;
  private readonly publicUrl: string;
  private readonly client: S3Client;

  constructor() {
    const resolved = loadServerEnv();
    const missing = (
      [
        ['R2_ACCOUNT_ID', resolved.r2AccountId],
        ['R2_ACCESS_KEY_ID', resolved.r2AccessKeyId],
        ['R2_SECRET_ACCESS_KEY', resolved.r2SecretAccessKey],
        ['R2_BUCKET', resolved.r2Bucket],
        ['R2_PUBLIC_URL', resolved.r2PublicUrl],
      ] as const
    )
      .filter(([, value]) => !value)
      .map(([name]) => name);

    if (missing.length > 0) {
      throw new StorageConfigError(missing);
    }

    this.bucket = resolved.r2Bucket as string;
    this.publicUrl = (resolved.r2PublicUrl as string).replace(/\/+$/, '');

    const clientConfig: S3ClientConfig = {
      region: 'auto',
      endpoint: `https://${resolved.r2AccountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: resolved.r2AccessKeyId as string,
        secretAccessKey: resolved.r2SecretAccessKey as string,
      },
    };

    // Constructed once, here, and reused for the service's lifetime — never
    // per-request. `StorageService` is itself a Nest singleton (the default
    // provider scope), so this runs exactly once per process.
    this.client = new S3Client(clientConfig);

    this.logger.log(`R2 storage client initialised for bucket "${this.bucket}"`);
  }

  /**
   * Uploads a buffer directly through the API.
   *
   * Not the path the restaurant-cover flow actually uses — that goes through
   * `getSignedUploadUrl` so the image bytes never transit Cloud Run (Step 8).
   * Included because business logic may have a legitimate reason to write an
   * object server-side later (e.g. a generated thumbnail), and the provider
   * boundary should offer it now rather than being extended ad hoc then.
   */
  async upload(input: UploadInput): Promise<{ key: string }> {
    assertSafeObjectKey(input.key);

    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: input.key,
        Body: input.body,
        ContentType: input.contentType,
      }),
    );

    return { key: input.key };
  }

  async delete(key: string): Promise<void> {
    assertSafeObjectKey(key);

    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  /**
   * Whether an object exists — added for M-11's upload-complete step, which
   * must confirm a client actually used its presigned URL before the database
   * is updated (a presigned URL merely *authorizes* a PUT; issuing one is not
   * proof one happened). `HeadObjectCommand` fetches no body, only metadata.
   *
   * Distinguishes a genuine 404 (`NotFound`, the SDK's typed exception for
   * exactly this) from every other failure — a transient network error or a
   * credentials problem must not be reported as "the object doesn't exist,"
   * since a caller here treats `false` as license to reject the request.
   */
  async exists(key: string): Promise<boolean> {
    assertSafeObjectKey(key);

    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return true;
    } catch (error) {
      if (error instanceof NotFound) return false;
      throw error;
    }
  }

  /**
   * The public URL for a public object (restaurant covers are public catalog
   * assets — never for a private key such as a future delivery-proof photo).
   *
   * `R2_PUBLIC_URL + '/' + key`, both sides normalised of stray slashes so a
   * trailing slash on the configured base or a leading slash on the key can
   * never produce a doubled or missing separator.
   */
  getPublicUrl(key: string): string {
    assertSafeObjectKey(key);
    return `${this.publicUrl}/${key}`;
  }

  /**
   * A presigned `PUT` URL scoped to exactly one object, one operation, and one
   * `Content-Type` — the client uploads straight to R2 and the credentials
   * that produced the URL are never sent to it (Step 8/17). Short expiry
   * (default 5 minutes) matches "authorization for a specific object and
   * operation," not a standing credential.
   */
  async getSignedUploadUrl(
    key: string,
    contentType: string,
    expiresInSeconds: number = DEFAULT_SIGNED_UPLOAD_EXPIRY_SECONDS,
  ): Promise<string> {
    assertSafeObjectKey(key);

    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: contentType,
    });

    return getSignedUrl(this.client, command, { expiresIn: expiresInSeconds });
  }
}
