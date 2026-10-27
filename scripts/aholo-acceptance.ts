/** Aholo 端到端真验收:本地 fixture 后端(真实 provider 代码)+ 真实 Lux3D API。 */
import { startLocalServer } from '../tests/local-server.ts';
import { processGeneration } from '../supabase/functions/_shared/worker.ts';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const OWNER = '10000000-0000-4000-8000-000000000001';
const line = (await readFile('.env.local', 'utf8')).split('\n').find(l => l.startsWith('LUX3D_API_KEY='));
const KEY = line!.split('=').slice(1).join('=').trim();
const env = (key: string) => ({
  LUX3D_API_KEY: KEY,
  LUX3D_TERMS_URL: 'https://www.aholo.ai/agreement/termsofuse',
  LUX3D_TERMS_REVIEWED_AT: '2026-10-28',
  GENERATION_MAX_TASK_CENTS: '100',
  GENERATION_WORKER_SECRET: 'local-acceptance',
  HY3_RETIRED: 'false',
})[key];

const dataDirectory = await mkdtemp(join(tmpdir(), 'scendance-aholo-acceptance-'));
const server = await startLocalServer(0, undefined, { dataDirectory, env });
console.log('[ACCEPT] server at', server.url);

const auth = await (await fetch(`${server.url}/auth/v1/token?grant_type=password`, {
  method: 'POST', headers: { 'content-type': 'application/json', apikey: 'sb_publishable_local_integration_only' },
  body: JSON.stringify({ email: 'owner@scendance.test', password: 'local-integration-only' }),
})).json();
const bearer = { Authorization: `Bearer ${auth.access_token}`, 'content-type': 'application/json' };
console.log('[ACCEPT] logged in as', auth.user?.email);

const capabilities = await (await fetch(`${server.url}/functions/v1/scene-api/generation/capabilities`, { headers: bearer })).json();
console.log('[ACCEPT] capabilities:', JSON.stringify(capabilities));
if (!capabilities.aholoTextToModel) throw new Error('aholo capability not advertised — terms/key gating failed');

const created = await (await fetch(`${server.url}/functions/v1/scene-api/jobs`, {
  method: 'POST', headers: bearer,
  body: JSON.stringify({ requestId: crypto.randomUUID(), prompt: '一张白色圆桌,极简风格,产品级验收', provider: 'aholo' }),
})).json();
console.log('[ACCEPT] job created:', JSON.stringify(created).slice(0, 300));
if (created.provider_model !== 'lux3d') throw new Error('job not pinned to lux3d: ' + created.provider_model);

const snapshot = async () => {
  const rows = await server.db.query('select state,provider_job_id,asset_id,error_code from scene_private.generation_jobs order by created_at desc limit 1');
  return rows.rows[0];
};

console.log('[ACCEPT] worker pass 1 (submit → real Lux3D create)…');
await processGeneration(server.backend, env);
console.log('[ACCEPT] after submit:', JSON.stringify(await snapshot()));

console.log('[ACCEPT] polling real Lux3D task + worker passes…');
let final;
for (let i = 1; i <= 80; i++) {
  await new Promise(r => setTimeout(r, 10_000));
  await processGeneration(server.backend, env);
  final = await snapshot();
  console.log(`[ACCEPT] t+${i * 10}s state=${final.state} error=${final.error_code ?? '-'}`);
  if (['ready', 'failed', 'rejected', 'submit_unknown'].includes(final.state)) break;
}
if (!final || final.state !== 'ready') throw new Error('job did not reach ready: ' + JSON.stringify(final));

const asset = await server.rpc(OWNER, 'assets.get', { assetId: final.asset_id });
console.log('[ACCEPT] asset:', JSON.stringify({ id: asset.id, name: asset.name, source: asset.source, format: asset.format, byteSize: asset.byte_size }));
console.log('[ACCEPT] metadata.generation:', JSON.stringify(asset.metadata?.generation));
console.log('[ACCEPT] ✅ 端到端验收通过:产品请求 → Lux3D 真实生成 → 校验归档 → 可授权资产');
console.log('[ACCEPT] data dir:', dataDirectory);
await server.close();
process.exit(0);
