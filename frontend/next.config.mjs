import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** 读 .env 文件里的 KEY=VALUE（只给下面的本机免登录用，不参与线上构建）。 */
function readEnvFile(file) {
  if (!existsSync(file)) return {};
  const values = {};
  for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (value.length > 1 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) value = value.slice(1, -1);
    if (key && value) values[key] = value;
  }
  return values;
}

/**
 * 本机开发免登录：把 .env.local 里已有的账号密码带进 dev 构建，登录卡不再要求手填。
 * 只在 `next dev`（NODE_ENV=development）注入——`next build` 的静态产物里没有这段，
 * 线上不会拿任何账号自动登录。
 *
 * 顺序即尝试顺序：local_account_*（本机 Supabase 用）→ Account_*（云端账号）→ NEXT_PUBLIC_DEMO_*。
 * `scope` 用来区分：后端是云端项目时不拿本机账号去撞一次必然失败的密码。
 */
function localAutoLoginEnv() {
  if (process.env.NODE_ENV !== 'development') return '';
  const fromFiles = {
    ...readEnvFile(path.resolve(__dirname, '..', '.env.local')),
    ...readEnvFile(path.resolve(__dirname, '.env.local')),
  };
  const lookup = key => (process.env[key] ?? fromFiles[key] ?? '').trim();
  const pairs = [
    ['local_account_id', 'local_account_pw', 'local'],
    ['Account_id', 'Account_pw', 'cloud'],
    ['NEXT_PUBLIC_DEMO_EMAIL', 'NEXT_PUBLIC_DEMO_PASSWORD', 'cloud'],
  ];
  const accounts = [];
  for (const [idKey, passwordKey, scope] of pairs) {
    const email = lookup(idKey), password = lookup(passwordKey);
    if (!email || !password) continue;
    if (accounts.some(account => account.email.toLowerCase() === email.toLowerCase())) continue;
    accounts.push({ email, password, scope });
  }
  return accounts.length ? JSON.stringify(accounts) : '';
}

/** 关于页要抄真实版本和提交。缺了就留空，界面说明「这次构建没写入」，不编一个假号。 */
function buildIdentity() {
  let version = '';
  try {
    version = String(JSON.parse(readFileSync(path.resolve(__dirname, 'package.json'), 'utf8')).version ?? '').trim();
  } catch { version = ''; }
  const fromCi = (process.env.CF_PAGES_COMMIT_SHA || process.env.GITHUB_SHA || '').trim();
  let commit = fromCi ? fromCi.slice(0, 12) : '';
  if (!commit) {
    try {
      commit = execFileSync('git', ['rev-parse', '--short=12', 'HEAD'], {
        cwd: path.resolve(__dirname, '..'),
        stdio: ['ignore', 'pipe', 'ignore'],
      }).toString().trim();
    } catch { commit = ''; }
  }
  return { version, commit };
}

const buildIdentityEnv = buildIdentity();

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // 同一份源码开两个 dev 时，共用一个 .next 会让 webpack 清单互相覆盖，
  // 页面报「reading 'call'」的 chunk 错。后启动的那个用 NEXT_DIST_DIR 单独起目录。
  distDir: process.env.NEXT_DIST_DIR || '.next',
  output: 'export',
  // 本机 dev 免登录：把 .env.local 的账号注入开发构建，登录卡不再要求手填。
  // 生产构建 localAutoLoginEnv 返回空串，产物里没有这段凭据。
  // 版本和提交给「关于」复制，来自 package.json 与这次构建能读到的 git / CI。
  env: (() => {
    const injected = localAutoLoginEnv();
    return {
      NEXT_PUBLIC_SCENDANCE_VERSION: buildIdentityEnv.version,
      NEXT_PUBLIC_SCENDANCE_COMMIT: buildIdentityEnv.commit,
      ...(injected ? { NEXT_PUBLIC_SCENDANCE_LOCAL_LOGIN: injected } : {}),
    };
  })(),
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
      // 天地图瓦片：线上由 Cloudflare Pages Functions（functions/api/tdt-tiles.ts）处理；
      // 本机 next dev 没有 Functions，转发到 3199 本机代理，见 tools/aholo/lux3d-dev-proxy.mjs。
      // 云端资产（R2 桶）同理：R2 的 CORS 白名单只放行线上站点，浏览器从 localhost 直取会被拦，
      // dev 下改走这个同源重写，不需要改桶的跨域配置，也不用把开发机加进白名单。
      ...(process.env.NODE_ENV === 'development'
        ? [
          ...['tdt-tiles', 'tdt-search', 'tdt-area', 'carto-tiles', 'place-shape', 'place-shape-hints', 'road-network', 'site-context'].map(name => ({ source: `/api/${name}`, destination: `http://127.0.0.1:3199/api/${name}` })),
          { source: '/api/amap-place', destination: 'http://127.0.0.1:3199/amap-place' },
          { source: '/cloud-assets/:path*', destination: 'https://pub-048147e4c4ad482d95df092dc8098e1d.r2.dev/:path*' },
        ]
        : []),
    ];
  },
};
export default nextConfig;
