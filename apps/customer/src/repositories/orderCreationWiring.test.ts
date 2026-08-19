import { repositories, apiOrderCreationRepository, mockOrderCreationRepository } from './index';

/**
 * Phase E-3A — proves the real checkout path is bound to the real API
 * repository, not the mock (task item M).
 *
 * Deliberately its own file: `__tests__/order-creation.test.tsx`'s `stub()`
 * monkey-patches `repositories.orderCreation` across many tests in that
 * file, which would make an in-file reference-equality assertion depend on
 * execution order. Jest gives each test file its own fresh module registry,
 * so this file observes `repositories` exactly as `index.ts` constructed
 * it, before anything else could have mutated it.
 */
describe('repositories.orderCreation wiring', () => {
  it('the app-wide repositories singleton binds orderCreation to the real API repository, not the mock', () => {
    expect(repositories.orderCreation).toBe(apiOrderCreationRepository);
    expect(repositories.orderCreation).not.toBe(mockOrderCreationRepository);
  });
});
