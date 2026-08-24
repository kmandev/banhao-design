import { TickController } from './tick.controller';
import type { PaymentEventProcessingService } from '../payments/payment-event-processing.service';

/**
 * F-2b: `POST /internal/tick` now invokes `PaymentEventProcessingService`.
 * The service is a plain stub here — its own logic is
 * `payment-event-processing.service.spec.ts`'s job. This file proves only
 * the wiring: the tick handler calls the processor and reports what it did,
 * additively to the original `{ accepted: true }` shape.
 */
describe('TickController', () => {
  it('invokes payment-event processing and reports the outcome, additive to the original shape', async () => {
    const processPendingEvents = jest.fn().mockResolvedValue({ processed: 2, skipped: 1 });
    const paymentEvents = { processPendingEvents } as unknown as PaymentEventProcessingService;
    const controller = new TickController(paymentEvents);

    const result = await controller.handle();

    expect(processPendingEvents).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ accepted: true, paymentEvents: { processed: 2, skipped: 1 } });
  });

  it('still reports accepted: true even when nothing was pending', async () => {
    const processPendingEvents = jest.fn().mockResolvedValue({ processed: 0, skipped: 0 });
    const paymentEvents = { processPendingEvents } as unknown as PaymentEventProcessingService;
    const controller = new TickController(paymentEvents);

    const result = await controller.handle();

    expect(result.accepted).toBe(true);
    expect(result.paymentEvents).toEqual({ processed: 0, skipped: 0 });
  });
});
