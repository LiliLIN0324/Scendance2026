// 用 Chrome DevTools Protocol 打开页面、等真实时间、读页面内文字、截图。
// 无第三方依赖：Node 18+ 自带 fetch，Node 22+ 自带 WebSocket。
// 用法: node tools/aholo/cdp-shot.mjs <url> <输出png> [等待毫秒] [调试端口]
import { writeFileSync } from 'node:fs';

const [, , url, out, waitMsArg = '9000', portArg = '9333'] = process.argv;
if (!url || !out) {
  console.error('用法: node tools/aholo/cdp-shot.mjs <url> <out.png> [waitMs] [port]');
  process.exit(2);
}

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

  const probe = await send('Runtime.evaluate', {
    expression: `JSON.stringify({
      info: document.getElementById('info')?.textContent ?? '',
      error: document.getElementById('error')?.style.display === 'block' ? document.getElementById('error').textContent : '',
      canvas: !!document.querySelector('canvas'),
    })`,
    returnByValue: true,
  });
  const state = JSON.parse(probe.result.value);
  console.log('页面文字:', state.info.replace(/\n/g, ' | '));
  if (state.error) console.log('页面报错:', state.error);
  console.log('canvas:', state.canvas);

  const shot = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(out, Buffer.from(shot.data, 'base64'));
  console.log('截图已写入', out);
  ws.close();
}

main().catch(err => {
  console.error('失败:', err.message);
  process.exit(1);
});
