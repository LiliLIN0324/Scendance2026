#!/usr/bin/env node
// PEOPLE-02 古风样板人物链：多模态生参考图 → 审图 → 单图四视图 → G1 图生 3D。
// 分步执行（每步独立子命令），参考图要过人审再进下一步，所以不做成一条龙。
//
// 用法：
//   node tools/aholo/people02-chain.mjs refimage  --out <dir> [--prompt "..."]
//   node tools/aholo/people02-chain.mjs fourview  --out <dir> --img <本地文件或URL> [--prompt "..."]
//   node tools/aholo/people02-chain.mjs img3d     --out <dir> (--img <文件或URL> | --imgs <逗号分隔>) [--version G1|G1-Turbo] [--face-count N]
//   node tools/aholo/people02-chain.mjs get       --out <dir> --taskid <id>
//
// 凭据读 .env.local 的 LUX3D_API_KEY（或环境变量），不落盘、不打印。每步写 <dir>/chain-report.json。
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const BASE = (process.env.LUX3D_BASE_URL ?? 'https://api.aholo3d.cn').replace(/\/+$/, '');

function loadKey() {
  if (process.env.LUX3D_API_KEY) return process.env.LUX3D_API_KEY;
  try {
    const text = readFileSync('.env.local', 'utf8');
    const line = text.split(/\r?\n/).find(l => l.trim().startsWith('LUX3D_API_KEY='));
    return line ? line.split('=').slice(1).join('=').trim() : '';
  } catch { return ''; }
}

const KEY = loadKey();
if (!KEY) { console.error('缺少 LUX3D_API_KEY'); process.exit(2); }
const redact = s => String(s).replaceAll(KEY, '[REDACTED]');

const args = process.argv.slice(2);
const cmd = args[0];
const getArg = (name, fallback = null) => {
  const at = args.indexOf(name);
  return at >= 0 && args[at + 1] ? args[at + 1] : fallback;
};
const OUT = getArg('--out');
if (!OUT) { console.error('缺少 --out <dir>'); process.exit(2); }

const log = [];
const t0 = Date.now();
const stamp = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;
function note(op, data) {
  const entry = { at: stamp(), iso: new Date().toISOString(), op, ...data };
  log.push(entry);
  console.log(`[${entry.at}] ${op} ${JSON.stringify(data).slice(0, 700)}`);
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
function unwrap(body) { return body?.d ?? body?.data ?? body; }

async function api(op, urlPath, body) {
  const res = await fetch(`${BASE}${urlPath}`, {
    method: 'POST',
    headers: { Authorization: KEY, 'Content-Type': 'application/json', 'x-source': 'openapi' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120000),
  });
  const text = await res.text();
  let parsed; try { parsed = JSON.parse(text); } catch { parsed = text; }
  note(op, { http: res.status, response: redact(text).slice(0, 1200) });
  if (!res.ok) throw new Error(`${op} HTTP ${res.status}: ${redact(text).slice(0, 500)}`);
  return parsed;
}

/** 本地文件 → Asset 入库拿 URL；http(s) 原样返回。 */
async function toAssetUrl(src) {
  if (/^https?:\/\//.test(src)) return src;
  const bytes = await readFile(src);
  const name = path.basename(src);
  const md5 = createHash('md5').update(bytes).digest('hex');
  note('asset.token', { file: name, bytes: bytes.length, md5 });
  const res = await fetch(`${BASE}/asset/v1/token`, { headers: { Authorization: KEY }, signal: AbortSignal.timeout(30000) });
  const text = await res.text();
  if (!res.ok) throw new Error(`asset token HTTP ${res.status}`);
  const d = unwrap(JSON.parse(text));
  if (!d?.ousToken || !d?.globalDomain) throw new Error('asset token 响应缺少 ousToken/globalDomain');
  const domain = String(d.globalDomain).replace(/\/+$/, '');
  const form = new FormData();
  form.append('md5', md5);
  form.append('file', new Blob([bytes]), name);
  const upRes = await fetch(`${domain}/ous/api/v2/single/upload`, {
    method: 'POST', headers: { 'ous-token-v2': d.ousToken }, body: form, signal: AbortSignal.timeout(600000),
  });
  const upText = await upRes.text();
  note('asset.single', { http: upRes.status, response: redact(upText).slice(0, 400) });
  if (!upRes.ok) throw new Error(`single upload HTTP ${upRes.status}`);
  let asset = unwrap(JSON.parse(upText));
  for (let attempt = 1; attempt <= 40; attempt++) {
    const stRes = await fetch(`${domain}/ous/api/v2/upload/status?md5=${md5}`, { headers: { 'ous-token-v2': d.ousToken }, signal: AbortSignal.timeout(30000) });
    const stBody = unwrap(JSON.parse(await stRes.text()));
    if (stBody?.url) { asset = stBody; break; }
    await sleep(2000);
  }
  if (!asset?.url) throw new Error('入库后 40 次轮询仍未拿到地址');
  return asset.url;
}

const TERMINAL = new Set([3, 4, 6]);
const STATUS_LABEL = { 0: '初始化', 1: '运行中', 3: '成功', 4: '失败', 6: '已取消' };

async function pollTask(taskId, maxMinutes = 30) {
  const deadline = Date.now() + maxMinutes * 60000;
  let polls = 0;
  let detail = null;
  while (Date.now() < deadline) {
    polls += 1;
    const res = await fetch(`${BASE}/lux3d/v1/generate/task/get?taskid=${taskId}`, {
      headers: { Authorization: KEY, 'x-source': 'openapi' }, signal: AbortSignal.timeout(30000),
    });
    const text = await res.text();
    let body; try { body = JSON.parse(text); } catch { body = text; }
    detail = unwrap(body);
    const status = Number(detail?.status);
    if (polls === 1 || TERMINAL.has(status) || polls % 6 === 0) {
      note('poll', { polls, http: res.status, status, label: STATUS_LABEL[status] ?? '未知', progress: detail?.progress ?? null });
    }
    if (TERMINAL.has(status)) return detail;
    await sleep(5000);
  }
  throw new Error(`超过 ${maxMinutes} 分钟未到终态`);
}

/** 下载 outputs[].content 的 http(s) 资源到 dir，返回落盘清单。
 * content 可能是单个 URL，也可能是字符串化的 URL 数组（four-view 实测），两种都接。 */
async function downloadOutputs(detail, dir, tag) {
  const outputs = Array.isArray(detail?.outputs) ? detail.outputs : [];
  const urls = [];
  for (const o of outputs) {
    const raw = o?.content;
    if (typeof raw !== 'string' || !raw.trim()) continue;
    const trimmed = raw.trim();
    if (trimmed.startsWith('[')) {
      try {
        for (const item of JSON.parse(trimmed)) {
          if (typeof item === 'string' && /^https?:\/\//.test(item)) urls.push(item);
        }
        continue;
      } catch { /* 不是数组就按单个 URL 处理 */ }
    }
    if (/^https?:\/\//.test(trimmed)) urls.push(trimmed);
  }
  const saved = [];
  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    const ext = (url.match(/\.(png|jpe?g|glb|zip|ply|spz)(?:\?|$)/i)?.[1] ?? 'bin').toLowerCase();
    const file = path.join(dir, `${tag}-${i + 1}.${ext}`);
    const res = await fetch(url, { signal: AbortSignal.timeout(600000) });
    if (!res.ok) { note('download.fail', { url: url.slice(0, 120), http: res.status }); continue; }
    const buf = Buffer.from(await res.arrayBuffer());
    await writeFile(file, buf);
    saved.push({ file, bytes: buf.length });
    note('download', { file, bytes: buf.length });
  }
  return saved;
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const report = { cmd, startedAt: new Date().toISOString(), base: BASE };
  try {
    if (cmd === 'refimage') {
      const prompt = getArg('--prompt') ??
        '一位年轻女性的全身立绘，中国古风汉服旅拍风格：浅色对襟长衫上衣，青绿色及踝长裙，裙摆离地约五厘米不拖地，窄袖，轻便盘发，发饰简洁；中性站姿（A 字站姿），双臂自然下垂并微微离开身体，两腿可分辨，双脚分开与肩同宽穿布鞋；全身完整入画，正面视角，纯白背景，均匀柔光，写实插画风格，人物居中，单人，无道具，无文字水印。';
      const body = await api('refimage.create', '/lux3d/v1/generate/multimodal-to-image/task/create', { prompt });
      const taskId = unwrap(body)?.taskId ?? unwrap(body);
      report.taskId = taskId;
      const detail = await pollTask(taskId);
      report.finalStatus = Number(detail?.status);
      report.outputs = await downloadOutputs(detail, OUT, 'ref');
    } else if (cmd === 'fourview') {
      const img = getArg('--img');
      if (!img) throw new Error('缺少 --img');
      const url = await toAssetUrl(img);
      report.inputUrl = url;
      const promptText = getArg('--prompt') ?? '保持这位人物的服装、发型与配色完全一致，生成同一角色的正面、侧面、背面四视图，全身，中性站姿，纯白背景。';
      const body = await api('fourview.create', '/lux3d/v1/generate/image-to-four-view/task/create', { img: url, prompt: promptText });
      const taskId = unwrap(body)?.taskId ?? unwrap(body);
      report.taskId = taskId;
      const detail = await pollTask(taskId);
      report.finalStatus = Number(detail?.status);
      report.outputs = await downloadOutputs(detail, OUT, 'fourview');
    } else if (cmd === 'img3d') {
      const single = getArg('--img');
      const multi = getArg('--imgs');
      const version = getArg('--version', 'G1');
      const faceCount = Number(getArg('--face-count', '0')) || undefined;
      const payload = { version, outputFormat: ['zip', 'glb'] };
      if (multi) {
        const list = [];
        for (const part of multi.split(',')) list.push(await toAssetUrl(part.trim()));
        payload.imgs = list;
        payload.version = version; // imgs 必须显式传 version
      } else if (single) {
        payload.img = await toAssetUrl(single);
      } else {
        throw new Error('--img 与 --imgs 必须提供一个');
      }
      if (faceCount) payload.faceCount = faceCount;
      report.request = { ...payload, img: payload.img, imgs: payload.imgs?.length };
      const body = await api('img3d.create', '/lux3d/v1/generate/img-to-3d/task/create', payload);
      const taskId = unwrap(body)?.taskId ?? unwrap(body);
      report.taskId = taskId;
      const detail = await pollTask(taskId, 60);
      report.finalStatus = Number(detail?.status);
      report.outputs = await downloadOutputs(detail, OUT, 'model');
    } else if (cmd === 'get') {
      const taskId = getArg('--taskid');
      if (!taskId) throw new Error('缺少 --taskid');
      report.taskId = taskId;
      const detail = await pollTask(taskId, 1);
      report.finalStatus = Number(detail?.status);
      report.detail = redact(JSON.stringify(detail)).slice(0, 4000);
      report.outputs = await downloadOutputs(detail, OUT, 'model');
    } else {
      throw new Error(`未知子命令 ${cmd}`);
    }
  } catch (error) {
    report.error = String(error instanceof Error ? error.message : error);
    console.error(`[chain] 失败: ${report.error}`);
  }
  report.log = log;
  await writeFile(path.join(OUT, 'chain-report.json'), JSON.stringify(report, null, 2));
  console.log(`[chain] 终态=${report.finalStatus ?? '未到'} taskId=${report.taskId ?? '-'} 报告=${path.join(OUT, 'chain-report.json')}`);
  if (report.error) process.exit(1);
}

// existsSync 只为确认 cwd 是仓库根（.env.local 相对路径），防呆不阻断。
if (!existsSync('.env.local') && !process.env.LUX3D_API_KEY) {
  console.error('请在仓库根目录运行（找不到 .env.local），或设 LUX3D_API_KEY');
  process.exit(2);
}
await main();
