import { OrderPricingService } from './order-pricing.service';
import { DomainError } from '../../common/errors/domain-error';

/**
 * DEC-E-01's gate. This is the whole test: `resolveOrderFees` must throw,
 * unconditionally, until BQ-026/BQ-027 are approved and this method's body
 * is deliberately rewritten — never weaken this test to make a caller pass.
 */
describe('OrderPricingService.resolveOrderFees', () => {
  it('always throws NOT_IMPLEMENTED — no fee value exists anywhere in the repository yet', () => {
    const subject = new OrderPricingService();

    expect(() => subject.resolveOrderFees('restaurant-1', 12000)).toThrow(DomainError);

    try {
      subject.resolveOrderFees('restaurant-1', 12000);
      fail('expected resolveOrderFees to throw');
    } catch (cause) {
      expect(cause).toBeInstanceOf(DomainError);
      expect((cause as DomainError).code).toBe('NOT_IMPLEMENTED');
    }
  });

  it('throws regardless of the subtotal or restaurant supplied — proves no hidden default path exists', () => {
    const subject = new OrderPricingService();

    expect(() => subject.resolveOrderFees('', 0)).toThrow(DomainError);
    expect(() => subject.resolveOrderFees('restaurant-2', 999_999)).toThrow(DomainError);
  });
});
