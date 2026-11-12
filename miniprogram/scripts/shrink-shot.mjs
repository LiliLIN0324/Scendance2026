/**
 * 截图缩放器（给「人眼看图」用，不参与业务）。
 *
 * 开发者工具 automator 出来的 PNG 很大，直接读会超上下文上限；
 * 这里等比缩到 --width（默认 560）再落一份 -small.jpg，方便肉眼看画面。
 *
 * 用法：node miniprogram/scripts/shrink-shot.mjs [--width 560] [文件...]
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

function parseArgs(argv) {
  const out = { width: 560, files: [] };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--width') {
      out.width = Number(argv[i + 1]);
      i += 1;
    } else {
      out.files.push(argv[i]);
    }
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.files.length) {
    console.error('用法：node shrink-shot.mjs [--width 560] <png...>');
    process.exit(1);
  }
  const Jimp = require('jimp');
  for (const file of args.files) {
    const image = await Jimp.read(file);
    const out = path.join(
      path.dirname(file),
      `${path.basename(file, path.extname(file))}-small.jpg`,
    );
    await image.resize(Jimp.AUTO, args.width).quality(82).writeAsync(out);
    console.log(`${path.basename(file)} ${image.getWidth()}x${image.getHeight()} → ${out}`);
  }
}

main().catch(error => {
  console.error('shrink-shot 失败：', error && error.message ? error.message : error);
  process.exit(1);
});
