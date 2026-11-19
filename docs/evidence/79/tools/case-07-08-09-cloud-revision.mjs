// #7 / #8 / #9 云端副本 revision 复核：真实账号 + 真实端点，不走浏览器 UI。
// 目的：补 deployment gap 修好后的 revision 前后对照与旧 baseRevision 冲突读数。
import fs from 'node:fs';
import { cloudFetch, outdoorPlanReadings, readEnv, BASE } from './harness.mjs';

const sessionPath = process.argv[2] || '.temp/real-session.json';
let session = JSON.parse(fs.readFileSync(sessionPath, 'utf8'));
const now = Math.floor(Date.now() / 1000);
if (!session.expires_at || session.expires_at < now + 60) {
  const env = readEnv();
  const r = await fetch(`${BASE}/auth/v1/token?grant_type=refresh_token`, {
    method: 'POST',
    headers: { apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: session.refresh_token }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`refresh ${r.status}`);
  session = { ...session, ...j, user: j.user ?? session.user };
}

const readings = await outdoorPlanReadings(session.user.id);
if (!readings.available) throw new Error(readings.reason);
const row = (readings.list || []).find((r) => r.local_activity_id === 'house-3ik2jdf2') || (readings.list || [])[0];
if (!row) throw new Error('no outdoor_plans row to probe');

const got = await cloudFetch(session, `/outdoor-plans/${row.activity_id}`);
if (got.status !== 200 || !got.body?.found) throw new Error(`get ${got.status} ${JSON.stringify(got.body)}`);
const beforeRevision = got.body.revision;
const plan = got.body.plan;

const applied = await cloudFetch(session, '/outdoor-plans', {
  method: 'PUT',
  body: JSON.stringify({ activityId: row.activity_id, baseRevision: beforeRevision, name: row.name, plan }),
});
const stale = await cloudFetch(session, '/outdoor-plans', {
  method: 'PUT',
  body: JSON.stringify({ activityId: row.activity_id, baseRevision: beforeRevision, name: row.name, plan }),
});
const after = await outdoorPlanReadings(session.user.id);

const out = {
  ranAt: new Date().toISOString(),
  account: session.user.email,
  actor: session.user.id,
  activityId: row.activity_id,
  localActivityId: row.local_activity_id,
  before: { revision: beforeRevision, planLen: JSON.stringify(plan).length },
  applied: { status: applied.status, body: applied.body },
  stale: { status: stale.status, body: stale.body },
  after: { revision: after.list?.find((r) => r.activity_id === row.activity_id)?.revision ?? null },
  note: 'applied 用当前 revision 写入，成功则 revision+1；stale 再用旧 revision 写，必须返回 conflict 且 revision 不再增加。',
};
fs.mkdirSync('docs/evidence/79/08', { recursive: true });
fs.writeFileSync('docs/evidence/79/08/2026-11-19-cloud-revision.json', JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
