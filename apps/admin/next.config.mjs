/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Workspace packages ship TypeScript source, so Next must compile them.
  transpilePackages: ['@banhao/api-client', '@banhao/types', '@banhao/ui', '@banhao/validation'],
};

export default nextConfig;
