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
};
