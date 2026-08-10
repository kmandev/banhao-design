/** @type {import('jest').Config} */
module.exports = {
  preset: 'jest-expo',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  // See packages/ui/jest.config.js — pnpm's .pnpm layout defeats the standard
  // pattern, so match on the store path and transform RN/Expo packages.
  transformIgnorePatterns: [
    'node_modules/\\.pnpm/(?!.*(react-native|@react-native|expo|@expo|@react-navigation|@banhao))',
  ],
  collectCoverageFrom: ['src/**/*.{ts,tsx}'],
};
