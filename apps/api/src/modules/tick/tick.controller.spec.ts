import { TickController } from './tick.controller';

describe('TickController', () => {
  it('returns a truthful minimal acceptance payload, never a processing claim', () => {
    const controller = new TickController();

    const result = controller.handle();

    expect(result).toEqual({ accepted: true });
    // Explicitly not "processed" — A-6 does not touch outbox/jobs/payment_events/ledger.
    expect(result).not.toHaveProperty('processed');
  });
});
