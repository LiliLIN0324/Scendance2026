import fs from 'node:fs';
import { cloudFetch, cloudSql } from './harness-proxy.mjs';
const session = JSON.parse(fs.readFileSync(process.argv[2] || '.temp/real-session.json', 'utf8'));
console.log('email', session.user?.email, 'expires_at', session.expires_at, 'has_refresh', !!session.refresh_token, 'expired', Date.now() / 1000 > session.expires_at);
try {
  const r = await cloudFetch(session, '/outdoor-plans');
  console.log('outdoor-plans', r.status, JSON.stringify(r.body).slice(0, 200));
} catch (e) {
  console.log('outdoor-plans error', String(e).slice(0, 200));
}
try {
  const r = await cloudSql("select to_regclass('scene_private.outdoor_plans')::text as tbl");
  console.log('sql', r.status, JSON.stringify(r.rows).slice(0, 200));
} catch (e) {
  console.log('sql error', String(e).slice(0, 200));
}
