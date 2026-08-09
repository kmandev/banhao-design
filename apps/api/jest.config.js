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
};
