/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src', '<rootDir>/test'],
  testMatch: ['**/*.spec.ts', '**/*.e2e-spec.ts'],
  moduleNameMapper: {
    '^@banhao/types$': '<rootDir>/../../packages/types/src',
    '^@banhao/validation$': '<rootDir>/../../packages/validation/src',
    '^@banhao/config$': '<rootDir>/../../packages/config/src',
  },
  /**
   * One worker, deliberately.
   *
   * Every HTTP-boundary spec drives a real `http.Server` through supertest on
   * an OS-assigned ephemeral port. Across parallel Jest workers those ports are
   * a shared resource, and a request would occasionally be answered by another
   * worker's application — reliably reproducible as roughly one failure per
   * eight full runs, landing on a different spec each time and always as an
   * unexpected `401` from some other test's anonymous fixture.
   *
   * Serialising removes the shared resource. It costs nothing measurable: this
   * suite runs in ~5.4 s either way, because it is dominated by TypeScript
   * compilation rather than by test execution.
   */
  maxWorkers: 1,
};
