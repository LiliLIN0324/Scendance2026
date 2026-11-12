#!/usr/bin/env node
/**
 * 微信开发者工具 · 冒烟验收（第一次真正把小程序跑起来的那道门）。
 *
 * 背景：README「未验证项」里写着「未在微信开发者工具中打开过，WXML/WXSS 未经工具编译校验」。
 * 本脚本用开发者工具自带的自动化端口（cli auto）把三个页面真跑一遍，验三件事：
 *   ① 页面能编译（进得去，不是白屏）
 *   ② 关键结构真的渲染出来了（选择器存在 + 有非零尺寸，不只是「没报错」）
 *   ③ 没有未捕获异常 / console.error
 * 截图尽力而为：模拟器走 WebGL 渲染时 IDE 截出来的是原始缓冲（VBO）不是图片，
 * 这种情况只记录、不落地垃圾文件（详见 captureShot）。
 *
 * 用法：
 *   1) 起自动化端口（另开一个终端）：
 *      "C:\Program Files (x86)\Tencent\微信web开发者工具\cli.bat" auto \
 *        --project "<repo>/miniprogram" --auto-port 9420 --trust-project
 *      注意：实际端口可能不是 9420（被占用会顺延），以命令输出的 autoPort 为准。
 *   2) 跑本脚本：
 *      node miniprogram/scripts/verify-devtools.mjs --port 9421
 *      不传 --port 时会依次试 9420..9430。
 *
 * 退出码：0 = 全过；1 = 有页面进不去 / 关键结构缺失 / 有未捕获异常。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const MINI_ROOT = path.resolve(HERE, '..');
const REPO_ROOT = path.resolve(MINI_ROOT, '..');
const OUT_DIR = path.join(REPO_ROOT, '.verify', 'miniprogram');

/**
 * 每页必查的关键结构。
 * `visible` = 必须有非零尺寸（真的画出来了）；只列 `sel` 的 = 存在即可。
 */
const PAGES = [
  {
    route: '/pages/index/index',
    name: 'index',
    required: ['.page', '.cover', '.brand', '.tagline', '.cta-wrap', '.quote', '.foot'],
    visible: ['.cover', '.brand', '.tagline', '.cta-wrap', '.quote'],
    data: ['payQuote'],
  },
  {
    route: '/pages/capture/index',
    name: 'capture',
    required: ['.screen', '.dim', '.b-vig-mid', '.overlay', '.cross'],
    visible: ['.overlay', '.cross', '.dim'],
    data: [],
  },
  {
    route: '/pages/result/index',
    name: 'result',
    required: ['.page'],
    visible: ['.page'],
    data: ['state'],
  },
];

function parseArgs(argv) {
  const out = { port: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--port') {
      out.port = Number(argv[i + 1]);
      i += 1;
    }
  }
  return out;
}

function candidatePorts(explicit) {
  if (explicit) return [explicit];
  return [9420, 9421, 9422, 9423, 9424, 9425, 9426, 9427, 9428, 9429, 9430];
}

async function connectFirst(ports) {
  const automator = require('miniprogram-automator');
  const tried = [];
  for (const port of ports) {
    try {
      const miniProgram = await automator.connect({
        wsEndpoint: `ws://127.0.0.1:${port}`,
        timeout: 5000,
      });
      return { miniProgram, port };
    } catch (error) {
      tried.push(`${port}: ${error && error.message ? error.message : error}`);
    }
  }
  throw new Error(`连不上自动化端口。试过：\n${tried.join('\n')}`);
}

/**
 * IDE 截图：automator 有时回 Buffer、有时回 base64 字符串（`iVBORw0…` 就是 base64 PNG）。
 * 两种都要归一成 Buffer 再判魔数；都不是图片就别落盘。
 */
function toBuffer(shot) {
  if (Buffer.isBuffer(shot)) return shot;
  if (typeof shot === 'string' && shot.length > 32) {
    try {
      return Buffer.from(shot, 'base64');
    } catch (error) {
      return Buffer.alloc(0);
    }
  }
  return Buffer.alloc(0);
}

/** IDE 截图在 WebGL 模拟器下可能返回原始缓冲，不是图片。识别出来就丢弃，别落垃圾文件。 */
function looksLikeImage(buffer) {
  if (!buffer || buffer.length < 4) return false;
  const magic = buffer.slice(0, 4);
  const isPng = magic[0] === 0x89 && magic[1] === 0x50 && magic[2] === 0x4e && magic[3] === 0x47;
  const isJpeg = magic[0] === 0xff && magic[1] === 0xd8 && magic[2] === 0xff;
  return isPng || isJpeg;
}

async function captureShot(miniProgram, name) {
  try {
    const raw = await miniProgram.screenshot();
    const shot = toBuffer(raw);
    if (!looksLikeImage(shot)) {
      const tag = shot && shot.length >= 3 ? shot.slice(0, 3).toString('latin1') : '?';
      return { ok: false, issue: `IDE 返回的不是图片（魔数 "${tag}"）` };
    }
    const file = path.join(OUT_DIR, `${name}.png`);
    fs.writeFileSync(file, shot);
    return { ok: true, file: path.relative(REPO_ROOT, file) };
  } catch (error) {
    return { ok: false, issue: String((error && error.message) || error) };
  }
}

/** 选择器存在性 + 尺寸断言：结构真的渲染出来了，而不是「没报错就算过」。 */
async function assertStructure(page, spec) {
  const missing = [];
  const invisible = [];
  for (const selector of spec.required) {
    const element = await page.$(selector);
    if (!element) {
      missing.push(selector);
      continue;
    }
    if (spec.visible.includes(selector)) {
      let size = null;
      try {
        size = await element.size();
      } catch (error) {
        size = null;
      }
      if (!size || !size.width || !size.height) {
        invisible.push(`${selector}(${size ? `${size.width}x${size.height}` : 'no-size'})`);
      }
    }
  }
  return { missing, invisible };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const { miniProgram, port } = await connectFirst(candidatePorts(args.port));
  console.log(`[verify] 已连上开发者工具自动化端口 ${port}`);

  const exceptions = [];
  const consoleErrors = [];
  miniProgram.on('exception', err => {
    exceptions.push(String((err && (err.message || err)) || err));
  });
  miniProgram.on('console', res => {
    const level = res && res.type ? String(res.type) : '';
    const text = (res && res.args ? res.args : [])
      .map(a => (a && a.value !== undefined ? String(a.value) : JSON.stringify(a)))
      .join(' ');
    if (level === 'error' || level === 'assert') consoleErrors.push(`${level}: ${text}`);
  });

  const report = { port, pages: [], exceptions, consoleErrors };

  for (const target of PAGES) {
    const entry = {
      route: target.route,
      name: target.name,
      ok: false,
      error: null,
      missing: [],
      invisible: [],
      emptyData: [],
      screenshot: null,
      screenshotIssue: null,
    };
    try {
      const page = await miniProgram.reLaunch(target.route);
      await page.waitFor(1200);

      const structure = await assertStructure(page, target);
      entry.missing = structure.missing;
      entry.invisible = structure.invisible;

      const data = (await page.data()) || {};
      entry.dataKeys = Object.keys(data);
      for (const key of target.data) {
        const value = data[key];
        if (value === undefined || value === null || value === '') entry.emptyData.push(key);
      }

      const shot = await captureShot(miniProgram, target.name);
      if (shot.ok) entry.screenshot = shot.file;
      else entry.screenshotIssue = shot.issue;

      entry.ok = entry.missing.length === 0 && entry.invisible.length === 0 && entry.emptyData.length === 0;
      const note = entry.ok ? 'OK' : `缺 ${entry.missing.join(',') || '-'} / 不可见 ${entry.invisible.join(',') || '-'} / 空值 ${entry.emptyData.join(',') || '-'}`;
      console.log(`[verify] ${target.route} → ${note}${entry.screenshot ? ` · 截图 ${entry.screenshot}` : ` · 无截图（${entry.screenshotIssue}）`}`);
    } catch (error) {
      entry.error = String((error && error.message) || error);
      console.error(`[verify] ${target.route} 失败：${entry.error}`);
    }
    report.pages.push(entry);
  }

  const failed = report.pages.filter(p => !p.ok);
  if (exceptions.length) console.error(`[verify] 未捕获异常 ${exceptions.length} 条：\n${exceptions.join('\n')}`);
  if (consoleErrors.length) console.error(`[verify] console.error ${consoleErrors.length} 条：\n${consoleErrors.join('\n')}`);

  report.summary = {
    pagesOk: report.pages.length - failed.length,
    pagesTotal: report.pages.length,
    exceptions: exceptions.length,
    consoleErrors: consoleErrors.length,
    screenshots: report.pages.filter(p => p.screenshot).length,
  };
  fs.writeFileSync(path.join(OUT_DIR, 'report.json'), JSON.stringify(report, null, 2));

  await miniProgram.disconnect();

  const pass = failed.length === 0 && exceptions.length === 0;
  console.log(`[verify] 结论：${pass ? 'PASS' : 'FAIL'} ${JSON.stringify(report.summary)}`);
  console.log(`[verify] 报告：${path.relative(REPO_ROOT, path.join(OUT_DIR, 'report.json'))}`);
  process.exit(pass ? 0 : 1);
}

main().catch(error => {
  console.error('[verify] 致命错误：', error && error.message ? error.message : error);
  process.exit(1);
});
