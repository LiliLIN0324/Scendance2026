import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'export',
  images: { unoptimized: true },
  devIndicators: false,
  experimental: { externalDir: true },
  outputFileTracingRoot: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'),
  // The 官网 is a standalone static page shipped through public/ (see
  // scripts/package-pages.mjs). Cloudflare Pages resolves /introduction to
  // /introduction.html on its own; this rewrite gives `next dev` the same URL.
  async rewrites() {
    return [{ source: '/introduction', destination: '/introduction.html' }];
  },
};
export default nextConfig;
