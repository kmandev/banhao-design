// eslint-disable-next-line @typescript-eslint/no-unused-vars
import type {} from 'express';

/**
 * `rawBody: true` in `NestFactory.create` (main.ts) populates `req.rawBody`
 * with a `Buffer` of the original request bytes, but neither `express` nor
 * `@nestjs/platform-express` ships a type for it — this is the documented
 * runtime behaviour with no corresponding ambient declaration.
 */
declare module 'express' {
  interface Request {
    rawBody?: Buffer;
  }
}
