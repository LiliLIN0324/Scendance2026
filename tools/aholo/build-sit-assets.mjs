// 坐姿资产总装：合并 → 两档压缩 → 结构校验 → 重生成清单。
//
// 前提：.cache/aholo/sit/ 下已有 retarget 产出的动作 GLB（由 tools/aholo/fetch-sit-clips.mjs 取回）。
// 上游动作库只提供循环态（Sitting_Idle_Loop 存在；坐下/起身过渡 id 不存在），
// 所以这里只补坐姿循环，过渡交给前端交叉淡入。
//
// 用法：
//   node tools/aholo/build-sit-assets.mjs --check     # 只检查输入与工具是否齐备
//   node tools/aholo/build-sit-assets.mjs             # 全量执行
//   node tools/aholo/build-sit-assets.mjs --limit 2   # 先拿 2 个模型试跑
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

// 源文件 / 产物内剪辑名 / 目标剪辑名（前端 people-model.ts 认的目标名）。
const CLIPS = [
  { file: 'Sitting_Idle_Loop.glb', from: 'animation_1', to: 'Sit_Idle_Loop' },
];
// 上游没有的过渡动作：缺失时前端用交叉淡入兜底，这里只提示不报错。
const MISSING_TRANSITIONS = ['Stand_To_Sit', 'Sit_To_Stand'];

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const checkOnly = args.includes('--check');
const limit = Number(option('limit', '0'));
const base = option('base', '.cache/aholo');
const sitDir = option('sit', join(base, 'sit'));
const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
const workDir = option('work', join(base, `with-sit-${stamp}`));
const heroDir = option('hero', join(base, 'hero'));
const farDir = option('far', join(base, 'far'));

const run = (script, argv) => {
  console.log(`\n$ node tools/aholo/${script} ${argv.join(' ')}`);
  execFileSync(process.execPath, [join('tools/aholo', script), ...argv], { stdio: 'inherit' });
};

/** 合并后逐条确认动作真的进去了，避免把没坐姿的模型压进线上两档。 */
const clipsOf = file => {
  const raw = execFileSync(process.execPath, [join('tools/aholo', 'inspect-people-glb.mjs'), '--json', file], { encoding: 'utf8' });
  return JSON.parse(raw)[0].animations.map(entry => entry.name);
};

const problems = [];
for (const clip of CLIPS) {
  if (!existsSync(join(sitDir, clip.file))) problems.push(`缺动作文件：${join(sitDir, clip.file)}`);
}
for (const name of ['merge-person-clips.mjs', 'compress-people.mjs', 'verify-people-lods.mjs', 'people-manifest.mjs', 'inspect-people-glb.mjs']) {
  if (!existsSync(join('tools/aholo', name))) problems.push(`缺工具：tools/aholo/${name}`);
}
const originals = existsSync(base)
  ? readdirSync(base).filter(name => name.toLowerCase().endsWith('.glb'))
  : [];
if (!originals.length) problems.push(`${base} 下没有原始 GLB（先跑下载）`);

if (problems.length) {
  console.error('前置检查未通过：');
  for (const problem of problems) console.error(`  - ${problem}`);
  console.error('\n先取动作：node tools/aholo/fetch-sit-clips.mjs --proxy http://127.0.0.1:3200 --clips Sitting_Idle_Loop');
  process.exit(1);
}
console.log(`前置检查通过：${originals.length} 个原始模型，${CLIPS.length} 条坐姿动作就位。`);
console.log(`上游无过渡动作：${MISSING_TRANSITIONS.join(' / ')}（前端交叉淡入兜底）`);
if (checkOnly) process.exit(0);

const assets = (limit > 0 ? originals.slice(0, limit) : originals).map(name => name.slice(0, -4));

// 1) 复制一份工作副本，逐条动作合并（每个动作是一个独立 GLB，逐个追加）。
mkdirSync(workDir, { recursive: true });
for (const id of assets) cpSync(join(base, `${id}.glb`), join(workDir, `${id}.glb`));
console.log(`\n[1/4] 合并动作到 ${assets.length} 个模型（工作副本 ${workDir}）`);
for (const clip of CLIPS) {
  run('merge-person-clips.mjs', [
    '--source', join(sitDir, clip.file),
    '--clips', clip.from,
    '--as', `${clip.from}=${clip.to}`,
    '--from', workDir,
    '--out', workDir,
  ]);
}
for (const id of assets) {
  const names = clipsOf(join(workDir, `${id}.glb`));
  const missing = CLIPS.map(clip => clip.to).filter(name => !names.includes(name));
  if (missing.length) throw new Error(`${id} 合并后仍缺动作：${missing.join(', ')}（现有：${names.join(', ')}）`);
}
console.log(`合并校验通过：${assets.length} 个模型都含 ${CLIPS.map(clip => clip.to).join(' / ')}`);

// 2) 两档重压（从合并后的副本读，避免把原件压成没有坐姿的版本）。
console.log('\n[2/4] 两档重压');
for (const [preset, out] of [['far', farDir], ['hero', heroDir]]) {
  run('compress-people.mjs', ['--from', workDir, '--out', out, '--preset', preset]);
}

// 3) 结构校验：骨架/clip 一致，hero 零削面。
console.log('\n[3/4] 结构校验');
run('verify-people-lods.mjs', ['--src', workDir, '--hero', heroDir, '--far', farDir]);

// 4) 清单（含新 hash 与体积，前端缓存键随之失效）。
console.log('\n[4/4] 重生成清单');
run('people-manifest.mjs', ['--hero', heroDir, '--far', farDir]);

const total = dir => readdirSync(dir).filter(name => name.endsWith('.glb'))
  .reduce((sum, name) => sum + statSync(join(dir, name)).size, 0);
console.log(`\n完成：hero ${(total(heroDir) / 1048576).toFixed(1)} MB / far ${(total(farDir) / 1048576).toFixed(1)} MB`);
console.log('下一步（R2 凭据就绪后）：node tools/aholo/r2-upload.mjs --hero .cache/aholo/hero --far .cache/aholo/far --env-file .r2.env');
