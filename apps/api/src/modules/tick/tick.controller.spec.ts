import { TickController } from './tick.controller';
import type { PaymentEventProcessingService } from '../payments/payment-event-processing.service';
import type { PaymentAttemptExpiryService } from '../payments/payment-attempt-expiry.service';
import type { DispatchService } from '../rider/dispatch.service';

/**
 * F-2b: `POST /internal/tick` invokes `PaymentEventProcessingService`. Now
 * also invokes `PaymentAttemptExpiryService` (payment-attempt/QR expiry,
 * DEC-029) and `DispatchService` (G-2 broadcast dispatch, DEC-020/DEC-037).
 * All three services are plain stubs here — their own logic is each one's own
 * `*.spec.ts` file's job. This file proves only the wiring: the tick handler
 * calls every processor and reports what each did, additively to the original
 * `{ accepted: true }` shape.
 */
describe('TickController', () => {
  function build(
    paymentEventsResult = { processed: 2, skipped: 1 },
    expiryResult = { expired: 1, skipped: 0 },
    dispatchResult = { deliveries: 3, offers: 7, expiredOffers: 2 },
  ) {
    const processPendingEvents = jest.fn().mockResolvedValue(paymentEventsResult);
    const processExpiredAttempts = jest.fn().mockResolvedValue(expiryResult);
    const paymentEvents = { processPendingEvents } as unknown as PaymentEventProcessingService;
    const paymentAttemptExpiry = { processExpiredAttempts } as unknown as PaymentAttemptExpiryService;
    const runDispatchRound = jest.fn().mockResolvedValue(dispatchResult);
    const dispatch = { runDispatchRound } as unknown as DispatchService;
    const controller = new TickController(paymentEvents, paymentAttemptExpiry, dispatch);
    return { controller, processPendingEvents, processExpiredAttempts, runDispatchRound };
  }

  it('invokes payment-event processing and reports the outcome, additive to the original shape', async () => {
    const { controller, processPendingEvents } = build();

    const result = await controller.handle();

    expect(processPendingEvents).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      accepted: true,
      paymentEvents: { processed: 2, skipped: 1 },
      paymentAttemptExpiry: { expired: 1, skipped: 0 },
      dispatch: { deliveries: 3, offers: 7, expiredOffers: 2 },
    });
  });

  it('still reports accepted: true even when nothing was pending', async () => {
    const { controller } = build(
      { processed: 0, skipped: 0 },
      { expired: 0, skipped: 0 },
      { deliveries: 0, offers: 0, expiredOffers: 0 },
    );

    const result = await controller.handle();

    expect(result.accepted).toBe(true);
    expect(result.paymentEvents).toEqual({ processed: 0, skipped: 0 });
    expect(result.paymentAttemptExpiry).toEqual({ expired: 0, skipped: 0 });
    expect(result.dispatch).toEqual({ deliveries: 0, offers: 0, expiredOffers: 0 });
  });

  it('invokes payment-attempt expiry and reports the outcome, additive to the original shape', async () => {
    const { controller, processExpiredAttempts } = build();

    const result = await controller.handle();

    expect(processExpiredAttempts).toHaveBeenCalledTimes(1);
    expect(result.paymentAttemptExpiry).toEqual({ expired: 1, skipped: 0 });
  });

  it('the TickHmacGuard-protected route wiring is unchanged — handle() still requires no arguments and returns the additive shape', async () => {
    const { controller } = build();

    const result = await controller.handle();

    expect(result.accepted).toBe(true);
    expect(Object.keys(result)).toEqual([
      'accepted',
      'paymentEvents',
      'paymentAttemptExpiry',
      'dispatch',
    ]);
  });

  it('runs exactly one dispatch round per tick — DEC-037 aligns the 60-second round to the 60-second tick', async () => {
    const { controller, runDispatchRound } = build();

    const result = await controller.handle();

    expect(runDispatchRound).toHaveBeenCalledTimes(1);
    expect(runDispatchRound).toHaveBeenCalledWith();
    expect(result.dispatch).toEqual({ deliveries: 3, offers: 7, expiredOffers: 2 });
  });
});
