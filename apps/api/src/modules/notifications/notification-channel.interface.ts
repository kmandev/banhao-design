/**
 * Channel-agnostic notification delivery abstraction — ADR-011.
 *
 * Mirrors `PaymentProvider`'s shape (`../payments/payment-provider.interface.ts`):
 * one interface, one DI token, adapters bound behind it so callers never
 * import a concrete channel directly. Only `IN_APP` is implemented in this
 * slice (H-2) — PUSH/SMS/EMAIL are declared as valid `notification_deliveries.channel`
 * values by the schema but have no adapter here, on purpose (BQ-035 is OPEN).
 */

export interface DeliverInput {
  notificationId: string;
  recipientId: string;
  title: string;
  body: string | null;
  deepLink: string | null;
}

export type DeliverResult = { delivered: true } | { delivered: false; reason: string };

export interface NotificationChannel {
  readonly channel: 'PUSH' | 'SMS' | 'EMAIL' | 'IN_APP';

  deliver(input: DeliverInput): Promise<DeliverResult>;
}

/** DI token for the IN_APP channel adapter — same pattern as `PAYMENT_PROVIDER`. */
export const IN_APP_NOTIFICATION_CHANNEL = Symbol('IN_APP_NOTIFICATION_CHANNEL');
