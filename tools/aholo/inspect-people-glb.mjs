// 人物 GLB 结构速查：不依赖 three / gltf-transform，直接读 GLB 容器与 JSON chunk。
//
// 用途：压缩前后对比「有没有把骨架/动画压坏」——这是体积表看不出来的部分。
// 输出：体积、扩展、网格/三角形数、蒙皮关节数、动画 clip 名与通道数、贴图 mime 与尺寸。
//
// 用法：
//   node tools/aholo/inspect-people-glb.mjs <a.glb> [b.glb ...]
//   node tools/aholo/inspect-people-glb.mjs --json <a.glb>     # 机器可读
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const jsonOnly = args.includes('--json');
const files = args.filter(arg => !arg.startsWith('--'));
if (!files.length) {
  console.error('用法：node tools/aholo/inspect-people-glb.mjs [--json] <a.glb> [b.glb ...]');
  process.exit(2);
}

const GLB_MAGIC = 0x46546c67;
const CHUNK_JSON = 0x4e4f534a;

function readGlb(path) {
  const buffer = readFileSync(path);
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  if (view.getUint32(0, true) !== GLB_MAGIC) throw new Error(`${path} 不是 GLB`);
  const version = view.getUint32(4, true);
  const length = view.getUint32(8, true);
  const jsonLength = view.getUint32(12, true);
  if (view.getUint32(16, true) !== CHUNK_JSON) throw new Error(`${path} 缺少 JSON chunk`);
  const text = new TextDecoder()
    .decode(new Uint8Array(buffer.buffer, buffer.byteOffset + 20, jsonLength))
    .replace(/[\0\s]+$/, '');
  return { bytes: length, version, json: JSON.parse(text) };
}

function summarize(path) {
  const { bytes, version, json } = readGlb(path);
  const accessors = json.accessors ?? [];
  const triangles = (json.meshes ?? []).reduce((sum, mesh) => sum + (mesh.primitives ?? []).reduce((inner, primitive) => {
    const indexAccessor = primitive.indices !== undefined ? accessors[primitive.indices] : undefined;
    if (indexAccessor?.count) return inner + Math.floor(indexAccessor.count / 3);
    const positionAccessor = accessors[primitive.attributes?.POSITION];
    return inner + Math.floor((positionAccessor?.count ?? 0) / 3);
  }, 0), 0);
  const skins = json.skins ?? [];
  const animations = (json.animations ?? []).map(animation => ({
    name: animation.name ?? '(unnamed)',
    channels: (animation.channels ?? []).length,
    // 时长取所有 input accessor 的 max 最大值（与前端 clip.duration 同口径的近似）。
    duration: Math.max(0, ...(animation.samplers ?? []).map(sampler => accessors[sampler.input]?.max?.[0] ?? 0)),
  }));
  return {
    file: path,
    mb: +(bytes / 1048576).toFixed(2),
    version,
    extensionsRequired: json.extensionsRequired ?? [],
    extensionsUsed: json.extensionsUsed ?? [],
    meshes: (json.meshes ?? []).length,
    triangles,
    skins: skins.length,
    joints: skins.length ? (skins[0].joints ?? []).length : 0,
    nodes: (json.nodes ?? []).length,
    images: (json.images ?? []).map(image => image.mimeType ?? '(embedded)'),
    imageCount: (json.images ?? []).length,
    animations,
  };
}

const rows = files.map(summarize);
if (jsonOnly) {
  console.log(JSON.stringify(rows, null, 2));
  process.exit(0);
}
for (const row of rows) {
  console.log(`\n${row.file}`);
  console.log(`  ${row.mb} MB · GLB v${row.version} · ${row.meshes} mesh · ${row.triangles} 三角面 · ${row.skins} skin / ${row.joints} 关节 · ${row.nodes} 节点`);
  console.log(`  extensionsRequired: ${row.extensionsRequired.join(', ') || '(none)'}`);
  console.log(`  images: ${row.imageCount} (${[...new Set(row.images)].join(', ') || 'none'})`);
  for (const animation of row.animations) {
    console.log(`  clip ${animation.name}: ${animation.channels} 通道 · ${animation.duration.toFixed(2)} s`);
  }
}
