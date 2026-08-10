/** @type {import('jest').Config} */
module.exports = {
  preset: 'jest-expo',
  // pnpm stores every package under node_modules/.pnpm/<name>@<version>/, so the
  // conventional transformIgnorePatterns (which expect node_modules/<name>/)
  // never match and React Native's untranspiled Flow/ESM source reaches Jest raw.
  // Match on the .pnpm path instead: transform anything RN/Expo-related.
  transformIgnorePatterns: [
    'node_modules/\\.pnpm/(?!.*(react-native|@react-native|expo|@expo|@react-navigation|@banhao))',
  ],
};
