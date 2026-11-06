import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // 同一份源码开两个 dev 时，共用一个 .next 会让 webpack 清单互相覆盖，
  // 页面报「reading 'call'」的 chunk 错。后启动的那个用 NEXT_DIST_DIR 单独起目录。
  distDir: process.env.NEXT_DIST_DIR || '.next',
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
