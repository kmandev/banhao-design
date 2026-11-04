/** @type {import('jest').Config} */
module.exports = {
  // jest-expo replaces the previous plain ts-jest setup: this app now has
  // React components to render, and the G6.3/G6.4 repository suites keep
  // running unchanged under it (babel transpiles their TypeScript the same
  // way ts-jest did).
  preset: 'jest-expo',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  roots: ['<rootDir>/src'],
  // See packages/ui/jest.config.js — pnpm's .pnpm layout defeats the standard
  // pattern, so match on the store path and transform RN/Expo packages.
  transformIgnorePatterns: [
    'node_modules/\\.pnpm/(?!.*(react-native|@react-native|expo|@expo|@react-navigation|@banhao))',
  ],
  collectCoverageFrom: ['src/**/*.{ts,tsx}'],
  /**
   * 60 s, not Jest's 5 s default (and no longer the 20 s this was first set
   * to).
   *
   * React Native suites render whole component trees under `jest-expo`, and a
   * few drive long timer sequences deliberately. Alone each is comfortably
   * under a second; run alongside the rest of the monorepo by Turborepo they
   * have been observed past 5 s and failing as timeouts rather than as failed
   * expectations. This changes no assertion — only how long a loaded machine
   * is given to reach one.
   *
   * 20 s proved too tight on GitHub's runners: with every package's tests
   * running at once, a cold suite takes 40-60 s wall time there against about
   * 11 s on a developer machine, and the first test of a suite pays for the
   * lazy module loading. On 2026-11-02 and 2026-11-03 the same three suites
   * (OfferInbox, ActiveDelivery, Home) timed out on their first test on the
   * first attempt and passed on a re-run, with no code change.
   */
  testTimeout: 60_000,
};
