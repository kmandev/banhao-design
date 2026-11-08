import { z } from 'zod';

/** `POST /api/v1/me/push-tokens` — the device's Expo push token, which app it belongs to, and its platform. */
export const registerPushTokenSchema = z
  .object({
    token: z.string().regex(/^Expo(nent)?PushToken\[[^\]]+\]$/, 'not an Expo push token'),
    platform: z.enum(['ios', 'android']),
    app: z.enum(['customer', 'driver']),
  })
  .strict();

export type RegisterPushTokenRequest = z.infer<typeof registerPushTokenSchema>;

/** `DELETE /api/v1/me/push-tokens` — revoke this device's token (sign-out). */
export const revokePushTokenSchema = z.object({ token: registerPushTokenSchema.shape.token }).strict();

export type RevokePushTokenRequest = z.infer<typeof revokePushTokenSchema>;
