import { Injectable, Logger } from '@nestjs/common';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
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
  bucket?: BucketKind;
}

/** One object returned by {@link StorageService.listObjects}. */
export interface ListedObject {
  key: string;
  /** Absent only if R2's response omits it, which the SDK type allows but real listings don't in practice. */
  lastModified: Date | undefined;
}

/**
 * Which of the two R2 buckets an operation targets.
 *
 * `'public'` (the default, `R2_BUCKET`) holds catalog assets — restaurant
 * covers and menu images — and is served through `R2_PUBLIC_URL`, an
 * `*.r2.dev` development domain. Public access in R2 is granted **per
 * bucket**, so every object in it is readable by anyone holding its key.
 *
 * `'private'` (`R2_PRIVATE_BUCKET`) holds delivery proof photos (POD) and
 * nothing else. It has no public base URL, and {@link StorageService.getPublicUrl}
 * refuses to resolve a key against it — a private object is reachable only
 * through {@link StorageService.getSignedDownloadUrl}, minted per request for a
 * caller the API has already authorized.
 *
 * The split is a bucket rather than a key prefix precisely because the public
 * setting is bucket-scoped: a `deliveries/` prefix inside the public bucket
 * would be privacy by obscurity, not by authorization.
 */
export type BucketKind = 'public' | 'private';

/** A short-lived, single-object, single-operation authorization — never a credential. */
const DEFAULT_SIGNED_UPLOAD_EXPIRY_SECONDS = 300;

/**
 * Read authorizations are shorter still than write ones. A download URL is
 * handed to a *viewer* (a customer opening the proof card), so it lives as
 * long as looking at one image takes and no longer — and it is never
 * persisted anywhere, so a fresh one is minted on every open.
 */
const DEFAULT_SIGNED_DOWNLOAD_EXPIRY_SECONDS = 120;

/** Thrown when R2 is used before the configuration values it needs are present. */
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

/**
 * The `listObjects` equivalent of {@link assertSafeObjectKey} — a prefix is
 * not itself a key (it legitimately ends in `/`, e.g. `deliveries/`), so the
 * "no empty segment" rule above would reject every real prefix. Still refuses
 * a leading slash or `..`, for the same reason.
 */
function assertSafeObjectPrefix(prefix: string): void {
  if (prefix.startsWith('/') || prefix.includes('..')) {
    throw new Error(`Refusing unsafe object prefix: ${prefix}`);
  }
}

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly bucket: string;
  /**
   * Undefined until `R2_PRIVATE_BUCKET` is configured. Deliberately NOT
   * validated in the constructor alongside the other five: the public
   * catalog flows (M-11, M-12) predate POD and must keep starting without it,
   * so absence is reported by {@link resolveBucket} at the moment a private
   * operation is actually attempted.
   */
  private readonly privateBucket: string | undefined;
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
    this.privateBucket = resolved.r2PrivateBucket;
    this.publicUrl = (resolved.r2PublicUrl as string).replace(/\/+$/, '');

    if (this.privateBucket && this.privateBucket === this.bucket) {
      // Configuring both names to the same bucket would silently defeat the
      // entire point of the split: proof photos would land in the bucket
      // R2_PUBLIC_URL serves. Fail at startup rather than at the first upload.
      throw new StorageConfigError([
        'R2_PRIVATE_BUCKET must name a DIFFERENT bucket from R2_BUCKET — ' +
          'R2 grants public access per bucket, so sharing one would expose proof photos',
      ]);
    }

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
        Bucket: this.resolveBucket(input.bucket),
        Key: input.key,
        Body: input.body,
        ContentType: input.contentType,
      }),
    );

    return { key: input.key };
  }

  async delete(key: string, bucket: BucketKind = 'public'): Promise<void> {
    assertSafeObjectKey(key);

    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.resolveBucket(bucket), Key: key }),
    );
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
  async exists(key: string, bucket: BucketKind = 'public'): Promise<boolean> {
    assertSafeObjectKey(key);

    try {
      await this.client.send(
        new HeadObjectCommand({ Bucket: this.resolveBucket(bucket), Key: key }),
      );
      return true;
    } catch (error) {
      if (error instanceof NotFound) return false;
      throw error;
    }
  }

  /**
   * The actual size of an object in R2, in bytes — via `ContentLength` on the
   * same `HeadObjectCommand` {@link exists} uses. Added for POD's server-side
   * proof-photo size limit (G7.4, `docs/BANHAO_POD_DRIVER_IMPLEMENTATION_PLAN.md`
   * §7.4): the client's declared file size is never trusted, only what R2
   * itself reports for the object that actually landed.
   *
   * A caller reaching this method has typically already confirmed existence
   * (via {@link exists}) and is asking "how big", not "does it exist" — so
   * unlike `exists`, a genuine `NotFound` here is **not** swallowed into a
   * sentinel return value. It propagates like any other failure, and so does
   * an R2 response that omits `ContentLength` (the SDK types it as optional;
   * a real HeadObject response always carries it, so its absence is treated
   * as a metadata-lookup failure, not as "zero bytes"). Both fail closed —
   * this method never resolves to a size a caller could compare against a
   * limit and get a false "within bounds".
   */
  async getObjectSize(key: string, bucket: BucketKind = 'public'): Promise<number> {
    assertSafeObjectKey(key);

    const result = await this.client.send(
      new HeadObjectCommand({ Bucket: this.resolveBucket(bucket), Key: key }),
    );

    if (result.ContentLength === undefined) {
      throw new Error(`R2 HeadObject for "${key}" returned no ContentLength`);
    }

    return result.ContentLength;
  }

  /**
   * Lists up to one page of objects under a prefix — added for the POD
   * orphan sweep (`ProofPhotoRetentionService`, DEC-039), which has no
   * `deliveries` row to start from and must instead discover candidate
   * objects directly in R2.
   *
   * Deliberately **one page per call, never a fetch-until-exhausted loop** —
   * the caller is a scheduled tick and must do bounded work; if there is more
   * than one page under the prefix, later objects wait for a later tick
   * rather than this call running an unbounded number of R2 requests.
   *
   * Returns each object's key and `LastModified` — the retention sweep uses
   * the latter to decide age without a second `HeadObject` round trip per
   * object.
   */
  async listObjects(
    prefix: string,
    bucket: BucketKind = 'private',
    options: { maxKeys?: number; continuationToken?: string } = {},
  ): Promise<{ objects: ListedObject[]; nextContinuationToken: string | undefined }> {
    assertSafeObjectPrefix(prefix);

    const result = await this.client.send(
      new ListObjectsV2Command({
        Bucket: this.resolveBucket(bucket),
        Prefix: prefix,
        MaxKeys: options.maxKeys,
        ContinuationToken: options.continuationToken,
      }),
    );

    const objects = (result.Contents ?? [])
      .filter((object): object is { Key: string; LastModified?: Date } => Boolean(object.Key))
      .map((object) => ({ key: object.Key, lastModified: object.LastModified }));

    return {
      objects,
      nextContinuationToken: result.IsTruncated ? result.NextContinuationToken : undefined,
    };
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
    bucket: BucketKind = 'public',
  ): Promise<string> {
    assertSafeObjectKey(key);

    const command = new PutObjectCommand({
      Bucket: this.resolveBucket(bucket),
      Key: key,
      ContentType: contentType,
    });

    return getSignedUrl(this.client, command, { expiresIn: expiresInSeconds });
  }

  /**
   * A presigned `GET` URL scoped to exactly one object — the capability this
   * service did not have before POD, because everything it served until now
   * was a public catalog asset resolved through {@link getPublicUrl}.
   *
   * This is the **only** way an object in the private bucket is ever read. The
   * URL is minted per request for a caller the API has already authorized, is
   * short-lived by default (2 minutes — as long as looking at one image
   * takes), and is never persisted: a screen that needs the image again asks
   * for a fresh one rather than caching a stale authorization.
   *
   * The credentials that produced it are never sent to the client, exactly as
   * with {@link getSignedUploadUrl}.
   */
  async getSignedDownloadUrl(
    key: string,
    expiresInSeconds: number = DEFAULT_SIGNED_DOWNLOAD_EXPIRY_SECONDS,
    bucket: BucketKind = 'private',
  ): Promise<string> {
    assertSafeObjectKey(key);

    const command = new GetObjectCommand({
      Bucket: this.resolveBucket(bucket),
      Key: key,
    });

    return getSignedUrl(this.client, command, { expiresIn: expiresInSeconds });
  }

  /**
   * Maps a {@link BucketKind} onto a configured bucket name.
   *
   * `'private'` raises {@link StorageConfigError} when `R2_PRIVATE_BUCKET` is
   * unset rather than silently falling back to the public bucket — a fallback
   * here would put proof photos in the bucket `R2_PUBLIC_URL` serves, which is
   * precisely the outcome the split exists to prevent. Failing loudly is the
   * only safe behaviour.
   */
  private resolveBucket(kind: BucketKind = 'public'): string {
    if (kind === 'public') return this.bucket;

    if (!this.privateBucket) {
      throw new StorageConfigError(['R2_PRIVATE_BUCKET']);
    }

    return this.privateBucket;
  }
}
