import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const KEY = (await readFile(path.join(root, '.env.local'), 'utf8')).split('\n').find(l => l.startsWith('LUX3D_API_KEY=')).split('=').slice(1).join('=').trim();
const BASE = 'https://api.aholo3d.cn';
const q = await (await fetch(`${BASE}/lux3d/v1/generate/task/get?taskid=4425274`, { headers: { Authorization: KEY } })).json();
const glbUrl = (q.d?.outputs ?? []).map(o => o?.content).filter(u => typeof u === 'string').find(u => u.toLowerCase().endsWith('.glb'));
const bytes = new Uint8Array(await (await fetch(glbUrl)).arrayBuffer());
const { repairGlb, validateModel } = await import(pathToFileURL(path.join(root, 'supabase', 'functions', '_shared', 'models.ts')));
try { await validateModel(bytes); console.log('原始产物：直接过校验（？不应该）'); }
catch (e) { console.log('原始产物 FAIL:', e.code, JSON.stringify(e.details)); }
const repaired = repairGlb(bytes);
const dv = (b) => { const v = new DataView(b.buffer, b.byteOffset, b.byteLength); return { magic: v.getUint32(0, true), ver: v.getUint32(4, true), total: v.getUint32(8, true), jsonLen: v.getUint32(12, true), jsonType: v.getUint32(16, true), binLen: v.getUint32(20 + v.getUint32(12, true), true), binType: v.getUint32(24 + v.getUint32(12, true), true) }; };
console.log('原始 header:', JSON.stringify(dv(bytes)), '实际长度', bytes.length);
console.log('修复 header:', JSON.stringify(dv(repaired)), '实际长度', repaired.length);
const pJson = JSON.parse(new TextDecoder().decode(repaired.subarray(20, 20 + dv(repaired).jsonLen)));
console.log('repaired JSON 解析 OK,bufferViews[0..3]:', JSON.stringify(pJson.bufferViews.slice(0, 4)));
try {
  const meta = await validateModel(repaired);
  console.log('✅ 修复后通过 validateModel:', JSON.stringify(meta).slice(0, 260));
} catch (e) {
  console.log('❌ 修复后仍 FAIL:', e.code);
  const { validateBytes } = await import(pathToFileURL(path.join(root, 'node_modules', 'gltf-validator', 'module.mjs')));
  const report = await validateBytes(repaired, { maxIssues: 10 });
  for (const m of report.issues.messages ?? []) console.log(' -', m.severity, m.code, m.pointer ?? '', m.message ?? '');
}
