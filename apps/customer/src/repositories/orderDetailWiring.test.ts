import { repositories, supabaseOrderDetailRepository, mockOrderDetailRepository } from './index';

/**
 * Phase E-3B.1 — proves the real order-detail path is bound to the real
 * Supabase-backed repository, not the mock. Same reasoning and same
 * deliberately-separate-file shape as `orderCreationWiring.test.ts`.
 */
describe('repositories.orderDetail wiring', () => {
  it('the app-wide repositories singleton binds orderDetail to the real Supabase repository, not the mock', () => {
    expect(repositories.orderDetail).toBe(supabaseOrderDetailRepository);
    expect(repositories.orderDetail).not.toBe(mockOrderDetailRepository);
  });
});
