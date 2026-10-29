import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const KEY = (await readFile(path.join(root, '.env.local'), 'utf8')).split('\n').find(l => l.startsWith('LUX3D_API_KEY=')).split('=').slice(1).join('=').trim();
const BASE = process.env.LUX3D_BASE_URL ?? 'https://api.aholo3d.cn';
const taskid = process.argv[2] ?? '4425274';
const q = await (await fetch(`${BASE}/lux3d/v1/generate/task/get?taskid=${taskid}`, { headers: { Authorization: KEY } })).json();
const urls = (q.d?.outputs ?? []).map(o => o?.content).filter(u => typeof u === 'string');
console.log('outputs:', urls);
const glbUrl = urls.find(u => u.toLowerCase().endsWith('.glb'));
if (!glbUrl) { console.log('NO GLB in outputs'); process.exit(1); }
const bytes = new Uint8Array(await (await fetch(glbUrl)).arrayBuffer());
console.log('glb bytes:', bytes.length);
const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
const jsonLen = dv.getUint32(12, true);
const json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLen)));
console.log('extensionsUsed:', json.extensionsUsed);
console.log('extensionsRequired:', json.extensionsRequired);
console.log('meshes:', json.meshes?.length, 'prims:', json.meshes?.[0]?.primitives?.length);
console.log('accessors:', json.accessors?.length, 'bufferViews:', json.bufferViews?.length, 'buffers:', json.buffers?.length);
const { validateModel } = await import(pathToFileURL(path.join(root, 'supabase', 'functions', '_shared', 'models.ts')));
try {
  const meta = await validateModel(bytes);
  console.log('validateModel OK:', JSON.stringify(meta).slice(0, 300));
} catch (e) {
  console.log('validateModel FAIL:', e.name, e.code ?? '');
  console.log('details raw:', JSON.stringify(e.details).slice(0, 2000));
}
