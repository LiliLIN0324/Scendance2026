// 打开坐姿验证页，依次切到几个机位各截一张，便于挑最能看清「坐在椅子上」的角度。
// 用法: node tools/aholo/cdp-views.mjs <url> <输出目录前缀> [等待毫秒] [调试端口]
import { writeFileSync } from 'node:fs';

const [, , url, prefix, waitMsArg = '12000', portArg = '9333'] = process.argv;
if (!url || !prefix) {
  console.error('用法: node tools/aholo/cdp-views.mjs <url> <out-prefix> [waitMs] [port]');
  process.exit(2);
}

const views = [
  { name: 'front', cam: [1.15, 1.55, 1.95], target: [0, 0.85, 0] },
  { name: 'side', cam: [2.45, 1.20, 0.25], target: [0, 0.72, -0.05] },
  { name: 'back', cam: [1.75, 1.55, -1.75], target: [0, 0.82, -0.12] },
  { name: 'low', cam: [1.30, 0.80, 1.55], target: [0, 0.62, -0.05] },
];

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function connect(port) {
  const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const page = list.find(t => t.type === 'page');
  if (!page) throw new Error('没有可用的 page target');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  const pending = new Map();
  let id = 0;
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const mid = ++id;
    pending.set(mid, { resolve, reject });
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', () => reject(new Error('WebSocket 连接失败')), { once: true });
  });
  ws.addEventListener('message', event => {
    const msg = JSON.parse(event.data);
    if (!msg.id || !pending.has(msg.id)) return;
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) reject(new Error(msg.error.message));
    else resolve(msg.result);
  });
  return { ws, send };
}

async function main() {
  const { ws, send } = await connect(portArg);
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Page.navigate', { url });
  await sleep(Number(waitMsArg));

  const ready = await send('Runtime.evaluate', {
    expression: `JSON.stringify({
      hasModel: !!window.__proof,
      metrics: window.__proof?.metrics ?? null,
      info: document.getElementById('info')?.textContent ?? '',
      error: document.getElementById('error')?.style.display === 'block' ? document.getElementById('error').textContent : '',
    })`,
    returnByValue: true,
  });
  const state = JSON.parse(ready.result.value);
  if (!state.hasModel) {
    console.log('页面未就绪:', state.error || state.info);
    process.exit(1);
  }
  console.log('实测:', JSON.stringify(state.metrics));

  for (const view of views) {
    await send('Runtime.evaluate', {
      expression: `window.__proof.setView(${view.cam.join(',')},${view.target.join(',')})`,
      returnByValue: true,
    });
    await sleep(600);
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    const file = `${prefix}-${view.name}.png`;
    writeFileSync(file, Buffer.from(shot.data, 'base64'));
    console.log('已写入', file);
  }
  ws.close();
}

main().catch(err => {
  console.error('失败:', err.message);
  process.exit(1);
});
