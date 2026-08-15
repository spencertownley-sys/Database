import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // This app is a subdirectory of a repository that holds another project, so
  // Next has two lockfiles to choose between. Pin the root explicitly.
  outputFileTracingRoot: import.meta.dirname,
  experimental: {
    // The grid pulls in TanStack Table + Virtual + all 14 editors. Keeping it
    // out of the shell bundle is a Step 15 acceptance criterion.
    optimizePackageImports: ['lucide-react', '@tanstack/react-table'],
  },
  serverExternalPackages: ['postgres'],
  eslint: {
    dirs: ['src', 'tests'],
  },
};

export default nextConfig;
