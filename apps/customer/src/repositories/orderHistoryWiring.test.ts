import { repositories, supabaseOrderHistoryRepository, mockOrderRepository } from './index';

/**
 * Phase E-3B.3 — proves C-16 reads real Supabase order history, not the mock.
 *
 * Same deliberately-separate-file reasoning as `orderCreationWiring.test.ts`:
 * the screen suites monkey-patch `repositories`, so a reference-equality
 * assertion in one of those files would depend on execution order. Jest gives
 * this file its own module registry, so it observes `repositories` exactly as
 * `index.ts` constructed it.
 */
describe('repositories.orders wiring', () => {
  it('binds orders to the real Supabase history repository, not the mock', () => {
    expect(repositories.orders).toBe(supabaseOrderHistoryRepository);
    expect(repositories.orders).not.toBe(mockOrderRepository);
  });

  it('the mock history fixture is empty, so no fabricated order can reach a screen', async () => {
    await expect(mockOrderRepository.listOrders()).resolves.toEqual([]);
  });
});
