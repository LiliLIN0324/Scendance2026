/**
 * 本机开发免登录：登录卡不再要求手填账号。
 *
 * 凭据只来自 `next dev` 期间由 next.config 注入的
 * `NEXT_PUBLIC_SCENDANCE_LOCAL_LOGIN`（见 frontend/next.config.mjs 的
 * localAutoLoginEnv）。`next build` 的静态产物里没有这个值，因此线上永远不会
 * 自动登录；这里所有函数在拿不到候选时都只是安静地返回空。
 */

export type LocalAutoLoginScope = 'local' | 'cloud';

export interface LocalAutoLoginCredential {
  email: string;
  password: string;
  /** local = 本机 Supabase 账号；cloud = 云端项目账号。后端不是本机时不用 local 这枚。 */
  scope: LocalAutoLoginScope;
}

/** 记住上一枚登录成功的邮箱，下次直接先试它（省掉一次错密码请求）。跨标签页/重启都有效。 */
const MEMORY_EMAIL_KEY = 'scendance.local-auto-login.email';
/** 全候选都失败的时间戳：冷却期内不再重试，避免每次刷新都打两次认证（只在本次标签页生效）。 */
const MEMORY_FAILED_AT_KEY = 'scendance.local-auto-login.failed-at';
const FAIL_COOLDOWN_MS = 5 * 60 * 1000;

/** 只有本机域名才自动登录；局域网 IP / 线上域名一律不代填。 */
export function isLocalDevHostname(hostname: string): boolean {
  const host = hostname.trim().toLowerCase().replace(/^\[|\]$/g, '');
  return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '0.0.0.0';
}

/** 解析注入的 JSON 数组；任何形状问题都退化成空数组，绝不抛错。 */
export function parseLocalAutoLogin(raw: string | null | undefined): LocalAutoLoginCredential[] {
  if (!raw) return [];
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return []; }
  if (!Array.isArray(parsed)) return [];
  const accounts: LocalAutoLoginCredential[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== 'object') continue;
    const email = typeof (item as { email?: unknown }).email === 'string' ? (item as { email: string }).email.trim() : '';
    const password = typeof (item as { password?: unknown }).password === 'string' ? (item as { password: string }).password : '';
    const scope: LocalAutoLoginScope = (item as { scope?: unknown }).scope === 'local' ? 'local' : 'cloud';
    if (!email || !password) continue;
    if (accounts.some(account => account.email.toLowerCase() === email.toLowerCase())) continue;
    accounts.push({ email, password, scope });
  }
  return accounts;
}

function sessionStore(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

/** 成功过的邮箱放 localStorage：新标签页/重启浏览器也不用再试错。 */
function preferredStore(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** 候选列表，已登录成功过的那枚排在最前；`localBackend: false` 时剔除本机账号。 */
export function localAutoLoginCredentials(options?: { localBackend?: boolean }): LocalAutoLoginCredential[] {
  const parsed = parseLocalAutoLogin(process.env.NEXT_PUBLIC_SCENDANCE_LOCAL_LOGIN);
  const candidates = options?.localBackend === false ? parsed.filter(account => account.scope !== 'local') : parsed;
  if (candidates.length < 2) return candidates;
  const known = preferredStore()?.getItem(MEMORY_EMAIL_KEY)?.trim().toLowerCase() ?? sessionStore()?.getItem(MEMORY_EMAIL_KEY)?.trim().toLowerCase();
  if (!known) return candidates;
  const index = candidates.findIndex(account => account.email.toLowerCase() === known);
  if (index <= 0) return candidates;
  const preferred = candidates[index];
  if (!preferred) return candidates;
  return [preferred, ...candidates.filter((_, position) => position !== index)];
}

/** 全候选失败后的冷却判断；没有失败记录就可以试。 */
export function shouldAttemptLocalAutoLogin(now = Date.now()): boolean {
  const raw = sessionStore()?.getItem(MEMORY_FAILED_AT_KEY);
  const failedAt = raw ? Number.parseInt(raw, 10) : Number.NaN;
  return !Number.isFinite(failedAt) || now - failedAt >= FAIL_COOLDOWN_MS;
}

/** 记一笔结果：成功记住邮箱并清掉冷却，失败只记时间戳。 */
export function rememberLocalAutoLogin(email: string | null, outcome: 'ok' | 'failed', now = Date.now()): void {
  const storage = sessionStore();
  if (!storage) return;
  try {
    if (outcome === 'ok') {
      if (email) {
        preferredStore()?.setItem(MEMORY_EMAIL_KEY, email);
        storage.removeItem(MEMORY_EMAIL_KEY);
      }
      storage.removeItem(MEMORY_FAILED_AT_KEY);
      return;
    }
    storage.setItem(MEMORY_FAILED_AT_KEY, String(now));
  } catch {
    // 无痕模式/存储被禁：当作没记住，不影响登录本身。
  }
}
