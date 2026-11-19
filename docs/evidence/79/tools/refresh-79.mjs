import fs from 'node:fs';
import { BASE, readEnv } from './harness-proxy.mjs';

const input = process.argv[2] || '.temp/real-session.json';
const output = process.argv[3] || '.temp/real-session-v3.json';
const session = JSON.parse(fs.readFileSync(input, 'utf8'));
const env = readEnv();
const key = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!key) throw new Error('缺少 NEXT_PUBLIC_SUPABASE_ANON_KEY');
const response = await fetch(`${BASE}/auth/v1/token?grant_type=refresh_token`, {
  method: 'POST',
  headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ refresh_token: session.refresh_token }),
});
const text = await response.text();
if (!response.ok) throw new Error(`refresh failed ${response.status} ${text.slice(0, 300)}`);
const next = JSON.parse(text);
const merged = { ...session, ...next, user: next.user ?? session.user };
fs.writeFileSync(output, JSON.stringify(merged, null, 2));
console.log(JSON.stringify({ status: response.status, email: merged.user?.email, expires_at: merged.expires_at, has_access: !!merged.access_token, has_refresh: !!merged.refresh_token }, null, 1));
