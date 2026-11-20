// 单件 GLB → 256×256 webp 缩略图（headless Chrome + three，复用工作台渲染链）。
//
// spike/单件：node tools/aholo/render-thumbs.mjs --slug <slug 片段>
// 批量：      node tools/aholo/render-thumbs.mjs --batch
//
// 走本机静态 http 服务（避开 file:// 的 ESM/CORS 限制）；产物先落 .cache/aholo/thumbs/，
// 人工目检通过后才复制进发布库 thumb/。无第三方依赖：Node 22 自带 fetch / WebSocket / http。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { writeFileSync, mkdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../');
const manifestPath = path.join(ROOT_DIR, 'tools/aholo/aholo-ingest-20261119.json');
const glbDir = path.join(ROOT_DIR, '.cache/aholo/ingest-20261119');
const thumbDir = path.join(ROOT_DIR, '.cache/aholo/thumbs');
const previewRel = 'tools/aholo/thumb-preview.html';

const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const [k, v] = a.split('=');
  return [k.replace(/^--/, ''), v ?? true];
}));

const CHROME = process.env.CHROME || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = Number(args.port || 9333);
const sleep = ms => new Promise(r => setTimeout(r, ms));

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.glb': 'model/gltf-binary',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.wasm': 'application/wasm',
  '.css': 'text/css; charset=utf-8',
};
function mimeFor(abs) {
  if (abs.endsWith('.module.js')) return MIME['.js'];
  return MIME[path.extname(abs)] || 'application/octet-stream';
}

function parseManifest() {
  return JSON.parse(readFileSync(manifestPath, 'utf8')).models;
}

// 极简静态服务：只服务仓库根，防路径越界。
function startStaticServer() {
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    let filePath = path.normalize(decodeURIComponent(url.pathname));
    if (filePath.endsWith('/')) filePath = path.join(filePath, 'index.html');
    const abs = path.join(ROOT_DIR, filePath);
    if (!abs.startsWith(ROOT_DIR) || !existsSync(abs) || !statSync(abs).isFile()) {
      res.writeHead(404); res.end('not found'); return;
    }
    res.writeHead(200, { 'Content-Type': mimeFor(abs), 'Cache-Control': 'no-store' });
    res.end(readFileSync(abs));
  });
  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, origin: `http://127.0.0.1:${port}` });
    });
  });
}

function launchChrome() {
  const profile = path.join(ROOT_DIR, '.cache', 'aholo', 'chrome-profile');
  mkdirSync(profile, { recursive: true });
  return spawn(CHROME, [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    '--allow-file-access-from-files',
    '--enable-unsafe-swiftshader',
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--force-device-scale-factor=1',
    '--window-size=256,256',
    'about:blank',
  ], { stdio: 'ignore', detached: false });
}

async function connect() {
  let list;
  for (let i = 0; i < 30; i += 1) {
    try {
      list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      if (list?.length) break;
    } catch { /* 还没起来 */ }
    await sleep(300);
  }
  if (!list?.length) throw new Error('Chrome 调试端口未就绪');
  const page = list.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  const pending = new Map();
  const pageLogs = [];
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
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
      return;
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      pageLogs.push('exception: ' + (msg.params.exceptionDetails?.exception?.description || msg.params.exceptionDetails?.text));
    } else if (msg.method === 'Runtime.consoleAPICalled') {
      const text = msg.params.args?.map(a => a.value ?? a.description ?? '').join(' ') || '';
      pageLogs.push(`${msg.params.type}: ${text}`);
    }
  });
  return { ws, send, pageLogs };
}

async function evaluate(send, expression, awaitPromise = false) {
  const r = await send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'evaluate 异常');
  return r.result.value;
}

async function renderOne(send, origin, model) {
  const glbRel = `.cache/aholo/ingest-20261119/${model.slug}.glb`;
  const glbAbs = path.join(ROOT_DIR, glbRel);
  if (!existsSync(glbAbs)) throw new Error(`GLB 不存在: ${model.slug}`);
  const pageUrl = `${origin}/${previewRel}?glb=${encodeURIComponent(`${origin}/${glbRel}`)}`;
  await send('Page.navigate', { url: pageUrl });

  let state = null;
  for (let i = 0; i < 60; i += 1) {
    await sleep(250);
    state = JSON.parse(await evaluate(send, `(window.__thumb?JSON.stringify({status:window.__thumb.status,error:window.__thumb.error,meta:window.__thumb.meta,encoded:window.__thumb.encoded}):'{"status":"missing"}')`));
    if (state.status === 'ready' || state.status === 'error') break;
  }
  if (!state) throw new Error('页面无状态');
  if (state.status === 'missing') throw new Error('预览模块未执行（__thumb 缺失）');
  if (state.status === 'error') throw new Error(`模型加载失败: ${state.error}`);

  const dataUrl = await evaluate(send, `window.__thumb.encode()`, true);
  const [, , base64] = /^data:([^;]+);base64,(.*)$/.exec(dataUrl) ?? [];
  if (!base64) throw new Error('encode 未返回 dataURL');
  const buf = Buffer.from(base64, 'base64');
  mkdirSync(thumbDir, { recursive: true });
  const outAbs = path.join(thumbDir, `${model.slug}.webp`);
  writeFileSync(outAbs, buf);

  const riff = buf.toString('ascii', 0, 4);
  const webp = buf.toString('ascii', 8, 12);
  return { slug: model.slug, bytes: buf.length, riff, webp, meta: state.meta, out: outAbs };
}

async function main() {
  const models = args.batch ? parseManifest() : parseManifest().filter(m => m.slug.includes(args.slug));
  if (!models.length) throw new Error('没有匹配的条目');

  const { server, origin } = await startStaticServer();
  const chrome = launchChrome();
  try {
    const { ws, send, pageLogs } = await connect();
    await send('Page.enable');
    await send('Runtime.enable');
    const results = [];
    for (const model of models) {
      try {
        const r = await renderOne(send, origin, model);
        results.push(r);
        console.log(`OK  ${r.slug}  ${r.bytes}B  ${r.riff}/${r.webp}  ${JSON.stringify(r.meta)}`);
      } catch (err) {
        results.push({ slug: model.slug, error: err.message });
        console.log(`ERR ${model.slug}  ${err.message}`);
      }
    }
    if (pageLogs.length) console.log('页面日志:\n' + pageLogs.join('\n'));
    ws.close();
    const failed = results.filter(r => r.error);
    console.log(JSON.stringify({ total: results.length, ok: results.length - failed.length, failed: failed.map(f => f.slug) }, null, 2));
  } finally {
    chrome.kill();
    server.close();
  }
}

main().catch(err => { console.error('失败:', err.message); process.exit(1); });
