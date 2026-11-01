import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'export',
  images: { unoptimized: true },
  devIndicators: false,
  experimental: { externalDir: true },
  outputFileTracingRoot: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'),
  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      'zod': path.resolve(__dirname, 'node_modules/zod'),
    };
    return config;
  },
  // The 官网 and 新手指引 are standalone static pages shipped through public/
  // (see scripts/package-pages.mjs). Cloudflare Pages resolves /introduction
  // and /guide to their .html files on its own; these rewrites give `next dev`
  // the same URLs.
  async rewrites() {
    return [
      { source: '/introduction', destination: '/introduction.html' },
      { source: '/guide', destination: '/guide.html' },
    ];
  },
};
export default nextConfig;
