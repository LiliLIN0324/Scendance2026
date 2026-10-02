import { startLocalServer, testAccounts, testPublicKey } from '../tests/local-server.ts';
import { owner, studio, scene } from '../tests/fixtures.ts';
import { tetrahedron } from '../tests/model-fixture.ts';
import { assetRecord } from '../supabase/functions/_shared/assets.ts';
import { packGltf, validateModel } from '../supabase/functions/_shared/models.ts';

const server = await startLocalServer(54329);
const { json, resources } = tetrahedron(), bytes = packGltf(json, resources);
const record = await assetRecord(owner, bytes, {
  name: '四面体 · 已校验联调 GLB', source: 'upload', license: { id: 'test-fixture' }, metadata: await validateModel(bytes),
});
await server.backend.upload(record.storagePath, bytes, 'model/gltf-binary');
await server.rpc(owner, 'assets.register', record);
const sample = scene();
sample.objects.push({ id: crypto.randomUUID(), materialId: 'asset', assetId: record.id, position: { x: 6, z: 5 }, rotation: 30,
  size: { width: 1.8, depth: 0.9, height: 0.75 }, color: '#ffffff', locked: false, notes: '私有备注，不应出现在分享数据中' });
await server.rpc(owner, 'projects.create', { studioId: studio, name: 'GLB 跨账号联调项目', scene: sample });
console.log('LOCAL TEST FIXTURE ONLY: real API + migrated PGlite; simulated Auth/Storage. Data resets on exit.');
console.log(`NEXT_PUBLIC_SUPABASE_URL=${server.url}\nNEXT_PUBLIC_SUPABASE_ANON_KEY=${testPublicKey}`);
console.log('Explicit test logins:', testAccounts.map(({ email, password }) => ({ email, password })));
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { void server.close().then(() => process.exit()); });
