const nextJest = require('next/jest');

const createJestConfig = nextJest({ dir: './' });

/** @type {import('jest').Config} */
const customJestConfig = {
  testEnvironment: 'jest-environment-jsdom',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  roots: ['<rootDir>/src'],
  collectCoverageFrom: ['src/**/*.{ts,tsx}'],
};

// next/jest loads Next's own SWC config and .env files and maps
// @banhao/* the same way the app's own module resolution does, so workspace
// packages resolve in tests without a second, hand-written transform.
module.exports = createJestConfig(customJestConfig);
