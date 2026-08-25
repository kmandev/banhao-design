/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/*.test.ts'],
  // apps/driver/tsconfig.json sets module/moduleResolution to esnext/bundler
  // for Metro (Expo's bundler) — that file is left untouched, and ts-jest is
  // told to compile CommonJS for the test run instead, the same way every
  // other ts-jest package in this monorepo already gets CommonJS from its own
  // (unoverridden) tsconfig.
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      { tsconfig: { module: 'commonjs', moduleResolution: 'node', types: ['react', 'jest'] } },
    ],
  },
};
