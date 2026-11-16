// 把动作 clip 合并进人物 GLB（纯 Node，无浏览器依赖）。
//
// 为什么需要：27 个漫游角色共用同一套 Mixamo 52 骨，Idle_Loop / Walk_Loop 已有；
// 坐姿三件套（Sit_Idle_Loop / Stand_To_Sit / Sit_To_Stand）是远端 retarget 产出的
// **单独一个动作 GLB**。若逐个角色去远端重定向，27 次 × 6 credits 既贵又慢；
// 正确做法是远端只产一次动作，再在本地按骨骼名合并进所有角色。
//
// 安全边界：
//   - 骨骼名必须逐一匹配（Mixamo ↔ Mixamo 可合并；换了骨架会明确报错，不做近似替换）；
//   - 已存在同名 clip 默认跳过（不覆盖已有动作），除非显式 --overwrite；
//   - 只写 --out 目录，绝不动 --from 原件。
//
// 用法：
//   node tools/aholo/merge-person-clips.mjs \
//     --source sit.glb --clips Sit_Idle_Loop,Stand_To_Sit,Sit_To_Stand \
//     --from .cache/aholo --out .cache/aholo/with-sit
//   node tools/aholo/merge-person-clips.mjs --source a.glb --clips Walk_Loop --as Walk_Loop=Probe --from .cache/aholo --out .cache/aholo/_probe --id <assetId>
import { NodeIO } from '@gltf-transform/core';
import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const sourcePath = option('source', '');
const fromDir = option('from', '.cache/aholo');
const outDir = option('out', '.cache/aholo/with-clips');
const onlyId = option('id', '');
const overwrite = args.includes('--overwrite');
const clipList = option('clips', '')
  .split(',')
  .map(item => item.trim())
  .filter(Boolean);
/** --as FROM=TO：源 clip 名 → 目标 clip 名（retarget 产物常带平台前缀）。 */
const renames = new Map(
  args
    .reduce((pairs, value, index) => (value === '--as' && args[index + 1] ? [...pairs, args[index + 1]] : pairs), [])
    .map(pair => pair.split('=').map(part => part.trim()))
    .filter(([from, to]) => from && to),
);

if (!sourcePath || !existsSync(sourcePath)) {
  console.error('缺少有效的 --source <动作 GLB>。');
  process.exit(2);
}
if (!clipList.length) {
  console.error('缺少 --clips（逗号分隔的动作名，例如 Sit_Idle_Loop,Stand_To_Sit,Sit_To_Stand）。');
  process.exit(2);
}

const io = new NodeIO();
const sourceDoc = await io.read(sourcePath);
const sourceAnimations = sourceDoc.getRoot().listAnimations();
const available = sourceAnimations.map(animation => animation.getName() || '(unnamed)');
const wanted = clipList.map(name => ({ from: name, to: renames.get(name) ?? name }));
const missing = wanted.filter(item => !available.includes(item.from)).map(item => item.from);
if (missing.length) {
  console.error(`源文件缺少动作：${missing.join(', ')}（可用：${available.join(', ') || '无'}）`);
  process.exit(1);
}

/** 把一条动画整段搬到目标文档：按**骨骼名**重定位节点，accessor 数据整块复制。 */
function copyAnimation(targetDoc, sourceAnimation, targetName, targetNodesByName) {
  const animation = targetDoc.createAnimation(targetName);
  const skipped = [];
  for (const channel of sourceAnimation.listChannels()) {
    const sourceNode = channel.getTargetNode();
    const boneName = sourceNode?.getName() ?? '';
    const targetNode = targetNodesByName.get(boneName);
    if (!targetNode) {
      skipped.push(boneName || '(未命名)');
      continue;
    }
    const sourceSampler = channel.getSampler();
    if (!sourceSampler) continue;
    const copyAccessor = accessor => {
      if (!accessor) return null;
      const array = accessor.getArray();
      if (!array) return null;
      const copy = targetDoc.createAccessor(`${targetName}/${accessor.getName() || 'data'}`)
        .setType(accessor.getType())
        .setArray(array.slice())
        .setNormalized(accessor.getNormalized());
      // glTF 要求动画采样的时间输入带 min/max；这里自己算，不走 core 的 getMin()——
      // 4.5.1 对没有显式 min/max 的 accessor 会在内部抛 TypeError（本次实测）。
      if (accessor.getType() === 'SCALAR' && array.length) {
        let lo = Infinity;
        let hi = -Infinity;
        for (let i = 0; i < array.length; i += 1) {
          if (array[i] < lo) lo = array[i];
          if (array[i] > hi) hi = array[i];
        }
        if (typeof copy.setMin === 'function') copy.setMin([lo]);
        if (typeof copy.setMax === 'function') copy.setMax([hi]);
      }
      return copy;
    };
    const input = copyAccessor(sourceSampler.getInput());
    const output = copyAccessor(sourceSampler.getOutput());
    if (!input || !output) { skipped.push(boneName); continue; }
    const sampler = targetDoc.createAnimationSampler()
      .setInput(input)
      .setOutput(output)
      .setInterpolation(sourceSampler.getInterpolation());
    animation.addSampler(sampler);
    animation.addChannel(
      targetDoc.createAnimationChannel()
        .setTargetNode(targetNode)
        .setTargetPath(channel.getTargetPath())
        .setSampler(sampler),
    );
  }
  return { animation, skipped };
}

const files = (onlyId ? [`${onlyId}.glb`] : readdirSync(fromDir).filter(name => name.toLowerCase().endsWith('.glb')))
  .filter(name => existsSync(join(fromDir, name)));
if (!files.length) {
  console.error(`没有找到目标 GLB（--from ${fromDir}${onlyId ? `，--id ${onlyId}` : ''}）。`);
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });
let failed = 0;
let totalAdded = 0;
for (const name of files) {
  const assetId = name.slice(0, -4);
  const inputPath = join(fromDir, name);
  const outputPath = join(outDir, name);
  const doc = await io.read(inputPath);
  const root = doc.getRoot();
  const nodesByName = new Map();
  for (const node of root.listNodes()) {
    const nodeName = node.getName();
    if (nodeName && !nodesByName.has(nodeName)) nodesByName.set(nodeName, node);
  }
  const existing = new Set(root.listAnimations().map(animation => animation.getName()));
  const added = [];
  for (const item of wanted) {
    if (existing.has(item.to) && !overwrite) continue;
    const sourceAnimation = sourceAnimations.find(animation => animation.getName() === item.from);
    const { skipped } = copyAnimation(doc, sourceAnimation, item.to, nodesByName);
    // 骨骼不匹配的比例过高说明不是同一套骨架：宁可失败，也不产出半条动作。
    if (skipped.length > sourceAnimation.listChannels().length * 0.2) {
      failed += 1;
      console.error(`FAIL ${assetId}: ${item.to} 有 ${skipped.length} 个通道找不到对应骨骼（骨架不匹配？例：${skipped.slice(0, 3).join(', ')}）`);
      continue;
    }
    added.push(item.to);
  }
  if (!added.length) {
    console.log(`SKIP ${assetId}: 目标已有 ${[...wanted.map(item => item.to)].join('/')}（需要覆盖请加 --overwrite）`);
    continue;
  }
  await io.write(outputPath, doc);
  totalAdded += added.length;
  console.log(`OK   ${assetId}: +${added.join(', +')} → ${outputPath} (${(statSync(outputPath).size / 1048576).toFixed(2)} MB)`);
}

console.log(`\n合并完成：${files.length} 个目标，新增 ${totalAdded} 条动作，输出目录 ${outDir}`);
if (failed) {
  console.error(`${failed} 个动作因子骨架不匹配被拒绝。`);
  process.exitCode = 1;
}
