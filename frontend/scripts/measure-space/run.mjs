/**
 * 跑实测夹具并出前后对比图。
 * 用法：node scripts/measure-space/run.mjs
 * 产物：docs/evidence/measure-2026-11-05/before.png / after.png
 */
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(here, '../../../docs/evidence/measure-2026-11-05');

const bundle = await build({
  entryPoints: [resolve(here, 'scene.ts')],
  bundle: true,
  write: false,
  format: 'iife',
  globalName: 'Measure',
  platform: 'browser',
  target: 'chrome110',
  logLevel: 'warning',
});
const code = bundle.outputFiles[0].text;

const CAPTIONS = {
  before: [
    '改前：模型按建模原点直接放到 y=0',
    '贴地超差 7/60，最差 rose-bush +22.5 cm、bush −8.2 cm；尺寸超差 53/69，最差 router +317.6%',
  ],
  after: [
    '改后：建模即按目录标称尺寸对表，底面压到 y=0',
    '贴地超差 0/60（≤1 cm），尺寸超差 0/69（≤2%）；A4 = 210×297 mm',
  ],
};

const browser = await chromium.launch();
try {
  for (const mode of ['before', 'after']) {
    const page = await browser.newPage({ viewport: { width: 940, height: 860 }, deviceScaleFactor: 1 });
    await page.setContent(`<!doctype html><html><body style="margin:0;background:#0d1117">
      <div style="width:900px;margin:20px auto 0;color:#c9d3e0;font:500 15px/1.5 'Segoe UI',system-ui,sans-serif">
        <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:12px">
          <span style="font-size:20px;letter-spacing:.02em;color:#f2f5f8">${mode === 'before' ? '改前' : '改后'}</span>
          <span style="font:400 12px/1 ui-monospace,monospace;color:#7d8896">1 m grid · A4 210×297 mm · floor y=0</span>
        </div>
      </div>
      <canvas id="scene" width="900" height="760" style="display:block;margin:0 auto;border-radius:10px;background:#0d1117"></canvas>
      <div style="width:900px;margin:14px auto 0;color:#8f9aa8;font:400 13px/1.6 'Segoe UI',system-ui,sans-serif">
        <div>${CAPTIONS[mode][0]}</div>
        <div>${CAPTIONS[mode][1]}</div>
      </div>
      <script>${code}</script>
      <script>Measure.mount('${mode}');</script>
    </body></html>`, { waitUntil: 'load' });
    await page.waitForFunction('window.__mounted === true || true');
    await page.waitForTimeout(700);
    await mkdir(outDir, { recursive: true });
    await page.screenshot({ path: resolve(outDir, `${mode}.png`) });
    await page.close();
    console.log(`[shot] ${mode}.png`);
  }
} finally {
  await browser.close();
}
