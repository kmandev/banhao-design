/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Workspace packages ship TypeScript source, so Next must compile them.
  // @banhao/ui is included only for its theme tokens (packages/ui/src/theme) —
  // the component tree there is React Native and is not imported here.
  transpilePackages: ['@banhao/api-client', '@banhao/types', '@banhao/ui', '@banhao/validation'],
  // Static export for Cloudflare Pages, same as apps/admin
  // (docs/DEPLOYMENT-ARCHITECTURE-V1.md). Auth is Supabase Auth JS running
  // entirely client-side, so there is no route handler or middleware this app
  // needs to give up by exporting statically.
  output: 'export',
};

export default nextConfig;
