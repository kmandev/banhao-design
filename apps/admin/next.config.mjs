/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Workspace packages ship TypeScript source, so Next must compile them.
  transpilePackages: ['@banhao/api-client', '@banhao/types', '@banhao/ui', '@banhao/validation'],
  // Static export for Cloudflare Pages (docs/DEPLOYMENT-ARCHITECTURE-V1.md).
  // Admin has no route handlers, middleware, or server-only APIs today —
  // verified before this was added. If a future screen genuinely needs SSR,
  // that is an architecture decision (a new DEC-APP entry), not a silent
  // revert of this line.
  output: 'export',
};

export default nextConfig;
