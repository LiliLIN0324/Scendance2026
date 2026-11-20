/**
 * 属性卡版式回归（2026-11-17）。
 *
 * 用真实浏览器量真实布局，断言三件事：
 *   1) 属性卡的宽度不超过宿主列（也不超过视口）—— 候选再多也不能把卡撑出屏幕；
 *   2) 「文字生成 / 图片生成 / 导入 GLB」三颗按钮的矩形完整落在卡片矩形内；
 *   3) 按钮中心的命中栈顶就是按钮自己 —— 这一条才是「点不动」的真实判据，
 *      截图永远验不出来（按钮看得见，但点下去命中的是底图 canvas）。
 *
 * 用法：node scripts/inspector-fit/run.mjs   （失败时退出码非 0）
 */
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const frontendRoot = resolve(here, '../..');

/**
 * 本机的 playwright 版本与 ms-playwright 缓存里的 Chromium 版本不一定对得上
 * （缓存里是 1252/1254，playwright 1.64.1 想要 1248）。
 * 默认启动失败时，从缓存里挑版本号最大的那个 chromium.exe 直接用。
 */
function cachedChromium() {
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH || join(process.env.LOCALAPPDATA || '', 'ms-playwright');
  if (!existsSync(root)) return undefined;
  const candidates = readdirSync(root)
    .filter((name) => name.startsWith('chromium-'))
    .sort((a, b) => Number(b.split('-')[1] ?? 0) - Number(a.split('-')[1] ?? 0));
  for (const name of candidates) {
    for (const relative of ['chrome-win64/chrome.exe', 'chrome-win/chrome.exe', 'chrome-linux/chrome']) {
      const executable = join(root, name, relative);
      if (existsSync(executable)) return executable;
    }
  }
  return undefined;
}

async function launchBrowser() {
  try {
    return await chromium.launch();
  } catch (error) {
    const executablePath = cachedChromium();
    if (!executablePath) throw error;
    return chromium.launch({ executablePath });
  }
}

const bundle = await build({
  entryPoints: [resolve(here, 'fixture.tsx')],
  bundle: true,
  write: false,
  format: 'iife',
  globalName: 'InspectorFit',
  platform: 'browser',
  target: 'chrome110',
  jsx: 'automatic',
  alias: { '@': frontendRoot },
  loader: { '.css': 'text' },
  logLevel: 'warning',
});
const code = bundle.outputFiles[0].text;

const viewport = { width: 1280, height: 800 };
const browser = await launchBrowser();
let failures = [];
try {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
  // 真实样式表：.sc-model-action（三格按钮）的尺寸来自这里，不能省。
  await page.setContent(`<!doctype html><html><head><meta charset="utf-8"></head>
<body style="margin:0;position:relative;width:${viewport.width}px;height:${viewport.height}px;overflow:hidden">
  <canvas id="basemap" style="position:absolute;inset:0;width:100%;height:100%"></canvas>
  <div id="outdoor-inspector-host" style="position:absolute;inset:0;z-index:31;pointer-events:none"></div>
</body></html>`, { waitUntil: 'load' });
  await page.addStyleTag({ path: resolve(frontendRoot, 'app/globals.css') });
  await page.addScriptTag({ content: code });
  await page.evaluate(() => {
    const canvas = document.getElementById('basemap');
    const ctx = canvas.getContext('2d');
    canvas.width = 1280;
    canvas.height = 800;
    ctx.fillStyle = '#dfe6ec';
    ctx.fillRect(0, 0, 1280, 800);
  });
  await page.evaluate(() => window.InspectorFit.mountInspectorFit());
  await page.waitForTimeout(300);

  const measured = await page.evaluate(() => {
    const card = document.querySelector('[data-testid="outdoor-inspector-selection"]');
    const host = document.getElementById('outdoor-inspector-host');
    const strip = document.querySelector('[data-testid="facility-model-strip"]');
    const buttons = [...document.querySelectorAll('[role="group"][aria-label="生成或导入模型"] button')];
    const rect = (el) => {
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom };
    };
    // 不变量：候选条是横向滚动条，它的宽度不能进卡片的内容宽度。
    // 量法：把候选条那一行从 DOM 里摘掉再量一次卡片宽度 —— 两次必须一样。
    const wrapper = strip?.parentElement;
    const anchor = wrapper?.nextSibling;
    const widthWithStrip = card.getBoundingClientRect().width;
    let widthWithoutStrip = widthWithStrip;
    if (wrapper && anchor) {
      wrapper.remove();
      widthWithoutStrip = card.getBoundingClientRect().width;
      anchor.parentElement.insertBefore(wrapper, anchor);
    }
    return {
      card: rect(card),
      host: rect(host),
      widthWithStrip,
      widthWithoutStrip,
      strip: strip ? { clientWidth: strip.clientWidth, scrollWidth: strip.scrollWidth } : null,
      buttons: buttons.map((button) => {
        const r = rect(button);
        const top = document.elementsFromPoint(r.x + r.width / 2, r.y + r.height / 2)[0];
        // 命中栈顶是按钮自己或它的子元素都算「点得到」（事件会冒泡到按钮）；
        // 栈顶是别的层（底图 canvas、相邻面板）才算点不动。
        const reachable = top === button || (top ? button.contains(top) : false);
        return { label: button.textContent, rect: r, hit: reachable ? 'self' : (top?.tagName ?? 'none') };
      }),
    };
  });

  // 2026-11-20 用户：「这个标注为什么搞那么宽」——标注浮卡定宽，长文本在卡内省略。
  const annotate = await page.evaluate(() => {
    const card = document.querySelector('[data-testid="outdoor-inspector-annotate"]');
    const label = document.querySelector('[data-testid="annotate-row-label"]');
    if (!card || !label) return null;
    const r = card.getBoundingClientRect();
    // 对照组：把定宽摘掉（等同 2026-11-20 之前的卡片），量它按内容会撑到多宽。
    const inlineWidth = card.style.width;
    card.style.width = 'auto';
    const autoWidth = card.getBoundingClientRect().width;
    card.style.width = inlineWidth;
    return {
      cardWidth: r.width,
      autoWidth,
      cardLeft: r.left,
      cardRight: r.right,
      labelClient: label.clientWidth,
      labelScroll: label.scrollWidth,
    };
  });
  if (!annotate) {
    failures.push('标注卡没有渲染出来');
  } else {
    if (annotate.cardWidth > 288) {
      failures.push(`标注卡宽 ${annotate.cardWidth.toFixed(1)}px 超过定宽 286px（长文本把卡撑开了）`);
    }
    if (annotate.labelScroll <= annotate.labelClient) {
      failures.push('标注长文本没有被省略号截断——说明它仍在给卡片贡献宽度');
    }
    if (annotate.cardLeft < -1 || annotate.cardRight > viewport.width + 1) {
      failures.push(`标注卡越出视口：left ${annotate.cardLeft.toFixed(1)} / right ${annotate.cardRight.toFixed(1)}`);
    }
  }

  const cardWidth = measured.card.width;
  if (cardWidth > measured.host.width + 1) {
    failures.push(`属性卡宽 ${cardWidth.toFixed(1)}px 超出宿主 ${measured.host.width.toFixed(1)}px`);
  }
  if (cardWidth > viewport.width - 32 + 1) {
    failures.push(`属性卡宽 ${cardWidth.toFixed(1)}px 超出视口上限 ${viewport.width - 32}px`);
  }
  // 核心不变量：摘掉候选条，卡片宽度不许变。变了就说明候选条的固有宽度
  // 漏进了卡片的内容宽度（真实故障：卡片被撑到上千像素宽，按钮落在可视区外）。
  const stripLeak = Math.abs(measured.widthWithStrip - measured.widthWithoutStrip);
  if (stripLeak > 2) {
    failures.push(`候选条的宽度漏进了卡片：有候选条 ${measured.widthWithStrip.toFixed(1)}px，去掉后 ${measured.widthWithoutStrip.toFixed(1)}px（差 ${stripLeak.toFixed(1)}px）`);
  }
  if (!measured.strip || measured.strip.scrollWidth <= measured.strip.clientWidth) {
    failures.push('候选条没有横向滚动（说明它把宽度摊给了整张卡，而不是自己滚）');
  }
  for (const button of measured.buttons) {
    const r = button.rect;
    if (r.x < measured.card.x - 1 || r.right > measured.card.right + 1) {
      failures.push(`「${button.label}」的矩形越出卡片：${JSON.stringify(r)} vs card ${JSON.stringify(measured.card)}`);
    }
    if (button.hit !== 'self') {
      failures.push(`「${button.label}」点不动：命中栈顶是 ${button.hit}，不是按钮自己`);
    }
  }

  console.log(JSON.stringify({
    viewport,
    cardWidth: Number(cardWidth.toFixed(1)),
    card: measured.card,
    strip: measured.strip,
    buttons: measured.buttons.map((b) => ({ label: b.label, hit: b.hit, width: Number(b.rect.width.toFixed(1)), top: Number(b.rect.y.toFixed(1)) })),
    annotate: annotate ? {
      cardWidth: Number(annotate.cardWidth.toFixed(1)),
      widthWithoutFixed: Number(annotate.autoWidth.toFixed(1)),
      labelClient: annotate.labelClient,
      labelScroll: annotate.labelScroll,
    } : null,
    failures,
  }, null, 1));

  if (failures.length) {
    console.error(`\nINSPECTOR_FIT_FAIL\n- ${failures.join('\n- ')}`);
    process.exitCode = 1;
  } else {
    console.log('\nINSPECTOR_FIT_OK');
  }
  await page.close();
} finally {
  await browser.close();
}
