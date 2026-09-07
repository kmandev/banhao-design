import {
  DELIVERY_CONTACT_ATTEMPTS_REQUIRED,
  DELIVERY_FAILURE_CAUSES,
  DELIVERY_FAILURE_WAIT_SECONDS,
  deliveryFailureCauseSchema,
  isDeliveryFailureCause,
} from './delivery-failure';
import { failDeliverySchema } from './supervisor';
import { cancelOrderRequestSchema } from './order';

describe('DELIVERY_FAILURE_CAUSES', () => {
  it('is exactly the six causes DEC-053 § 9 recognises, in the decision’s own order', () => {
    expect(DELIVERY_FAILURE_CAUSES).toEqual([
      'CUSTOMER_UNREACHABLE',
      'CUSTOMER_REFUSED',
      'RIDER_CAUSED',
      'MERCHANT_CAUSED',
      'PLATFORM_CAUSED',
      'INDETERMINATE',
    ]);
  });

  it('has exactly six values — no seventh may be added without superseding DEC-053', () => {
    expect(DELIVERY_FAILURE_CAUSES).toHaveLength(6);
  });
});

describe('deliveryFailureCauseSchema', () => {
  it.each(DELIVERY_FAILURE_CAUSES)('accepts %s', (cause) => {
    expect(deliveryFailureCauseSchema.safeParse(cause).success).toBe(true);
  });

  /**
   * `CUSTOMER_CANCELLED` is a real cause code in `docs/ORDER_LIFECYCLE.md` § 6
   * — for `CANCELLED`, not for a post-pickup delivery failure. Admitting it
   * here would let DEC-053's path write a cancellation outcome.
   */
  it('rejects CUSTOMER_CANCELLED — a cancellation is not a post-pickup delivery failure', () => {
    expect(deliveryFailureCauseSchema.safeParse('CUSTOMER_CANCELLED').success).toBe(false);
  });

  it.each([
    'MERCHANT_REJECTED',
    'MERCHANT_TIMEOUT',
    'MERCHANT_CANCELLED_LATE',
    'NO_RIDER_OPERATOR_CANCELLED',
    'OPERATOR_CANCELLED',
    'ITEM_UNAVAILABLE',
    'PAYMENT_EXPIRED',
    'PAYMENT_FAILED',
  ])('rejects %s — the wider PROPOSED taxonomy is not implemented by this slice', (cause) => {
    expect(deliveryFailureCauseSchema.safeParse(cause).success).toBe(false);
  });

  it.each([
    'customer_unreachable',
    'Customer_Unreachable',
    'CUSTOMER UNREACHABLE',
    '',
    'UNKNOWN',
  ])('rejects the unsupported value %p', (cause) => {
    expect(deliveryFailureCauseSchema.safeParse(cause).success).toBe(false);
  });

  it.each([null, undefined, 42, {}, ['RIDER_CAUSED']])('rejects the non-string %p', (value) => {
    expect(deliveryFailureCauseSchema.safeParse(value).success).toBe(false);
  });
});

describe('isDeliveryFailureCause', () => {
  it.each(DELIVERY_FAILURE_CAUSES)('narrows %s', (cause) => {
    expect(isDeliveryFailureCause(cause)).toBe(true);
  });

  it.each(['CUSTOMER_CANCELLED', 'OPERATOR_CANCELLED', '', null, undefined, 7])(
    'refuses %p',
    (value) => {
      expect(isDeliveryFailureCause(value)).toBe(false);
    },
  );
});

/**
 * DEC-053's failure path is its own command. Introducing the cause vocabulary
 * must not widen cancellation — these pin that it did not.
 */
describe('the cancel API is unchanged by the cause vocabulary', () => {
  it('still rejects causeCode', () => {
    expect(
      cancelOrderRequestSchema.safeParse({ reason: 'ok', causeCode: 'CUSTOMER_UNREACHABLE' })
        .success,
    ).toBe(false);
  });

  it('still rejects a DEC-053 cause smuggled in as causeCode', () => {
    expect(
      cancelOrderRequestSchema.safeParse({ causeCode: 'INDETERMINATE' }).success,
    ).toBe(false);
  });

  it('still accepts a bare reason', () => {
    expect(cancelOrderRequestSchema.safeParse({ reason: 'ok' }).success).toBe(true);
  });
});

describe('DEC-053 § 3 constants', () => {
  it('requires exactly 2 contact attempts', () => {
    expect(DELIVERY_CONTACT_ATTEMPTS_REQUIRED).toBe(2);
  });

  /**
   * DEC-053 states explicitly that the 10-minute figure in BQ-017's historical
   * text was an illustration and never policy. This pins the approved value so
   * a future edit cannot quietly restore it.
   */
  it('waits exactly 5 minutes, not the 10 minutes BQ-017 illustrated', () => {
    expect(DELIVERY_FAILURE_WAIT_SECONDS).toBe(300);
    expect(DELIVERY_FAILURE_WAIT_SECONDS).not.toBe(600);
  });
});

describe('failDeliverySchema', () => {
  it.each(DELIVERY_FAILURE_CAUSES)('accepts %s with a reason', (causeCode) => {
    expect(failDeliverySchema.safeParse({ causeCode, reason: 'ok' }).success).toBe(true);
  });

  it('requires a causeCode', () => {
    expect(failDeliverySchema.safeParse({ reason: 'ok' }).success).toBe(false);
  });

  it('rejects a cause outside DEC-053’s six', () => {
    expect(
      failDeliverySchema.safeParse({ causeCode: 'CUSTOMER_CANCELLED', reason: 'ok' }).success,
    ).toBe(false);
  });

  it('requires a reason — audit_logs_operator_reason_check makes it a database invariant', () => {
    expect(failDeliverySchema.safeParse({ causeCode: 'RIDER_CAUSED' }).success).toBe(false);
  });

  it.each(['', '   ', '\t\n'])('rejects the blank reason %p', (reason) => {
    expect(failDeliverySchema.safeParse({ causeCode: 'RIDER_CAUSED', reason }).success).toBe(false);
  });

  it('trims the reason', () => {
    const result = failDeliverySchema.safeParse({ causeCode: 'RIDER_CAUSED', reason: '  ok  ' });
    expect(result.success && result.data.reason).toBe('ok');
  });

  it('accepts a reason of exactly 500 characters and rejects 501', () => {
    expect(
      failDeliverySchema.safeParse({ causeCode: 'RIDER_CAUSED', reason: 'x'.repeat(500) }).success,
    ).toBe(true);
    expect(
      failDeliverySchema.safeParse({ causeCode: 'RIDER_CAUSED', reason: 'x'.repeat(501) }).success,
    ).toBe(false);
  });

  it('is strict — no actor, state, timestamp or amount may be smuggled in', () => {
    for (const extra of [
      { actorId: 'someone-else' },
      { state: 'FAILED' },
      { failedAt: '1999-01-01T00:00:00.000Z' },
      { refundSatang: 10500 },
      { riderCompensationSatang: 1200 },
      { deliveryId: 'another' },
    ]) {
      expect(
        failDeliverySchema.safeParse({ causeCode: 'RIDER_CAUSED', reason: 'ok', ...extra }).success,
      ).toBe(false);
    }
  });
});
