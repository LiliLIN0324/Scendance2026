#!/usr/bin/env node
// 从 Aholo 单文件 spz 派生 2 档低模（1/4、1/8），并写 lod-meta.json。
// 依据公开 SPZ 规范（nianticlabs/spz）：legacy v1–3 为 gzip + 定长点记录。
//   v2: pos(9) + alpha(1) + color(3) + scale(3) + rot(3) + SH
//   v3: pos(9) + alpha(1) + color(3) + scale(3) + rot(4) + SH
// 抽点用等步长采样，保留空间分布；坐标/属性原样搬运，不重新量化。
// 用法：
//   node tools/aholo/make-lod.mjs --spz scene.spz --out frontend/public/scans/tearoom-130
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';

const args = process.argv.slice(2);
const arg = (name, fallback) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] ? args[i + 1] : fallback; };
const SPZ = resolve(arg('--spz', ''));
const OUT = resolve(arg('--out', ''));
/** 第 0 档不必再复制一份：可直接指向代理/远端的原始 spz。 */
const LEVEL0_URL = arg('--level0-url', '');
/** 抽点步长：1 = 全量；4 = 1/4；8 = 1/8。 */
const STEPS = [1, 4, 8];
const SH_BYTES = { 0: 0, 1: 9, 2: 24, 3: 45, 4: 72 };

/** SPZ 是「分段连续」而非逐点交错：pos 全部在前，然后 alpha/color/scale/rot/SH 各成一段。 */
function sectionSizes(version, shDegree) {
  return [9, 1, 3, 3, version >= 3 ? 4 : 3, SH_BYTES[shDegree] ?? NaN];
}

function sectionStarts(sizes, count) {
  const starts = [];
  let offset = 16;
  for (const size of sizes) { starts.push(offset); offset += size * count; }
  return { starts, end: offset };
}

function parseSpz(bytes) {
  let plain;
  try { plain = gunzipSync(bytes); } catch { throw new Error('不是 legacy gzip 包体（可能已是 v4 zstd），本工具只派生 v1–3'); }
  if (plain.subarray(0, 4).toString('ascii') !== 'NGSP') throw new Error('缺少 NGSP 魔数');
  const version = plain.readUInt32LE(4);
  if (version < 1 || version > 3) throw new Error(`只支持 v1–3，拿到 v${version}`);
  const headerPoints = plain.readUInt32LE(8);
  const shDegree = plain[12];
  const fractionalBits = plain[13];
  const sizes = sectionSizes(version, shDegree);
  if (sizes.some(size => !Number.isFinite(size))) throw new Error(`未知 shDegree=${shDegree}`);
  const stride = sizes.reduce((sum, size) => sum + size, 0);
  const actualPoints = (plain.length - 16) / stride;
  if (!Number.isInteger(actualPoints)) throw new Error(`包体长度 ${plain.length} 与步长 ${stride} 对不齐`);
  return { plain, version, headerPoints, shDegree, fractionalBits, stride, actualPoints, sizes, rotationBytes: sizes[4] };
}

function positionBounds(plain, count, fractionalBits) {
  const scale = 2 ** fractionalBits;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  const at = offset => {
    const raw = plain[offset] | (plain[offset + 1] << 8) | (plain[offset + 2] << 16);
    return (raw & 0x800000 ? raw - 0x1000000 : raw) / scale;
  };
  const sampleStep = Math.max(1, Math.floor(count / 200_000));
  for (let index = 0; index < count; index += sampleStep) {
    // 位置段是连续的：第 i 个点在 16 + i*9。
    const base = 16 + index * 9;
    for (let axis = 0; axis < 3; axis += 1) {
      const value = at(base + axis * 3);
      if (value < min[axis]) min[axis] = value;
      if (value > max[axis]) max[axis] = value;
    }
  }
  return { min, max };
}

function decimate(parsed, step) {
  const count = Math.floor(parsed.actualPoints / step);
  const { starts } = sectionStarts(parsed.sizes, parsed.actualPoints);
  const sections = parsed.sizes.map((size, section) => {
    const source = starts[section];
    const out = Buffer.alloc(size * count);
    for (let index = 0; index < count; index += 1) {
      const from = source + index * step * size;
      parsed.plain.copy(out, index * size, from, from + size);
    }
    return out;
  });
  const header = Buffer.alloc(16);
  parsed.plain.copy(header, 0, 0, 8);
  header.writeUInt32LE(count, 8);
  header[12] = parsed.shDegree;
  header[13] = parsed.fractionalBits;
  header[14] = parsed.plain[14];
  header[15] = 0;
  return { count, plain: Buffer.concat([header, ...sections]) };
}

async function main() {
  if (!SPZ || !OUT) throw new Error('用法：node tools/aholo/make-lod.mjs --spz <scene.spz> --out <dir>');
  await mkdir(OUT, { recursive: true });
  const bytes = await readFile(SPZ);
  const parsed = parseSpz(bytes);
  const bounds = positionBounds(parsed.plain, parsed.actualPoints, parsed.fractionalBits);
  console.log(`源 ${basename(SPZ)} ${bytes.length} bytes · v${parsed.version} · ${parsed.actualPoints} pts · stride ${parsed.stride} · SH${parsed.shDegree}`);

  const files = [LEVEL0_URL || basename(SPZ)];
  const counts = [parsed.actualPoints];
  const sizes = [bytes.length];
  // 第 0 档直接复用源文件，不复制重复产物；meta 指向外部地址时连副本都不落。
  if (!LEVEL0_URL) await copyFile(SPZ, join(OUT, basename(SPZ)));
  for (const step of STEPS.slice(1)) {
    const level = decimate(parsed, step);
    const name = `lod-${STEPS.indexOf(step)}.spz`;
    const packed = gzipSync(level.plain, { level: 6 });
    await writeFile(join(OUT, name), packed);
    files.push(name);
    counts.push(level.count);
    sizes.push(packed.length);
    console.log(`  → ${name} ${packed.length} bytes · ${level.count} pts（1/${step}）`);
  }

  const meta = {
    magicCode: 'SCENDANCE-LOD-SPLAT',
    type: 'lod-splat',
    version: '1.0',
    levels: files.length,
    shDegree: parsed.shDegree,
    fractionalBits: parsed.fractionalBits,
    source: basename(SPZ),
    files,
    counts,
    bytes: sizes,
    // 与 Aholo lod-meta 同口径，供现有 loadAholoSceneMeters 复用。
    forwardBox: { min: bounds.min, max: bounds.max },
    tree: [{
      bound: [...bounds.min, ...bounds.max],
      // Aholo 原生 meta 用 file/offset/count；这里每档独立成文件，offset 恒为 0。
      lods: files.map((_, level) => ({ file: level, offset: 0, count: counts[level] })),
    }],
  };
  await writeFile(join(OUT, 'lod-meta.json'), JSON.stringify(meta, null, 2));
  console.log(`lod-meta.json levels=${meta.levels} counts=${counts.join('/')} bytes=${sizes.join('/')}`);
}

main().catch(error => { console.error('[make-lod][FAIL]', error.message); process.exit(1); });
