#!/usr/bin/env node
// Aholo web-scan v1 公共客户端：鉴权、重试、日志脱敏、产物下载。
// 只从环境变量 AHOLO_SCAN_KEY 读 key；日志只打前 6 位，响应体一律脱敏。
// 参考规格：https://studio.aholo3d.cn/api/web-scan/v1/openapi.json
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export const BASE = (process.env.AHOLO_SCAN_BASE_URL ?? 'https://studio.aholo3d.cn/api/web-scan/v1').replace(/\/+$/, '');
/** 产物 href 是站内绝对路径（/api/...），需要补上站点 origin。 */
const artifactUrl = href => (href.startsWith('http') ? href : new URL(href, new URL(BASE).origin).toString());

export function scanKey() {
  const key = process.env.AHOLO_SCAN_KEY;
  if (!key) {
    console.error('[scan] 缺少 AHOLO_SCAN_KEY 环境变量');
    process.exit(2);
  }
  return key;
}

export const keyPrefix = key => `${key.slice(0, 6)}…(${key.length})`;
const redact = (key, value) => String(value).replaceAll(key, '[REDACTED]');

export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/** 32 位小写 hex 的 fid；重试必须复用同一个。 */
export const fid = () => randomBytes(16).toString('hex');
export const md5 = bytes => createHash('md5').update(bytes).digest('hex');

export function createClient({ key, log = console.log, timeoutMs = 600_000 } = {}) {
  const token = key;
  const started = Date.now();
  const steps = [];
  const elapsed = () => ((Date.now() - started) / 1000).toFixed(1);

  function logStep(step) {
    steps.push({ at: new Date().toISOString(), elapsedSeconds: (Date.now() - started) / 1000, ...step });
    const note = step.note ? ` ${step.note}` : '';
    log(`[${elapsed()}s] ${step.op} http=${step.http ?? '-'}${note}`);
  }

  async function call(op, path, init = {}) {
    const url = path.startsWith('http') ? path : `${BASE}${path}`;
    const res = await fetch(url, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, ...(init.headers || {}) },
      signal: AbortSignal.timeout(init.timeoutMs ?? timeoutMs),
    });
    const text = await res.text();
    let body;
    try { body = JSON.parse(text); } catch { body = text; }
    const safe = redact(token, typeof body === 'string' ? body : JSON.stringify(body)).slice(0, 3000);
    logStep({ op, http: res.status, note: `${redact(token, url).replace(BASE, '')}`, response: safe });
    if (!res.ok) {
      const error = new Error(`${op} HTTP ${res.status}: ${redact(token, text).slice(0, 1200)}`);
      error.http = res.status;
      error.body = body;
      error.retryAfter = Number(res.headers.get('retry-after')) || null;
      throw error;
    }
    return { body, status: res.status, headers: res.headers };
  }

  /** 幂等操作（查状态/建重建/建任务）的退避重试；上传重试在外层用同一个 fid 处理。 */
  async function retry(op, fn, { attempts = 4, baseDelayMs = 1500 } = {}) {
    let lastError;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try { return await fn(); } catch (error) {
        lastError = error;
        const retryable = !error.http || error.http === 429 || error.http >= 500 || error.http === 408;
        if (!retryable || attempt === attempts) throw error;
        const delay = (error.retryAfter ? error.retryAfter * 1000 : baseDelayMs * 2 ** (attempt - 1));
        logStep({ op: `${op}.retry`, http: error.http ?? '-', note: `第 ${attempt}/${attempts - 1} 次失败，${Math.round(delay / 1000)}s 后重试: ${redact(token, error.message).slice(0, 200)}` });
        await sleep(delay);
      }
    }
    throw lastError;
  }

  return {
    steps,
    elapsedSeconds: () => (Date.now() - started) / 1000,
    logStep,
    async probe() {
      return (await call('scan.probe', '/reconstructions?limit=1')).body;
    },
    async createReconstruction(name) {
      const { body } = await retry('scan.create', () => call('scan.create', '/reconstructions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, pose_units: 'metres', remove_people: true }),
      }));
      if (!body?.id) throw new Error('create 响应缺少 id');
      return body.id;
    },
    async uploadImage(pid, fileId, bytes, sequence, mime) {
      const { body } = await call('scan.image', `/reconstructions/${pid}/images/${fileId}?sequence=${sequence}`, {
        method: 'PUT',
        headers: { 'Content-Type': mime },
        body: bytes,
      });
      return body;
    },
    async listImages(pid, { limit = 200, cursor } = {}) {
      const query = new URLSearchParams({ limit: String(limit) });
      if (cursor !== undefined) query.set('cursor', String(cursor));
      return (await call('scan.images', `/reconstructions/${pid}/images?${query}`)).body;
    },
    async waitImages(pid, expect, { maxMinutes = 20, intervalMs = 5000, onTick } = {}) {
      const deadline = Date.now() + maxMinutes * 60_000;
      let items = [];
      while (Date.now() < deadline) {
        const page = await retry('scan.images', () => this.listImages(pid, { limit: 200 }));
        items = (page.items ?? []).sort((a, b) => a.sequence - b.sequence);
        const ready = items.filter(item => item.status === 'ready').length;
        const failed = items.filter(item => item.status === 'failed').length;
        const processing = items.filter(item => item.status === 'processing').length;
        onTick?.({ total: items.length, ready, failed, processing });
        if (items.length >= expect && processing === 0) break;
        if (items.length >= expect && ready + failed === items.length) break;
        await sleep(intervalMs);
      }
      return items;
    },
    async createJob(pid, options) {
      const body = {
        output_formats: options.outputFormats ?? ['ply', 'spz'],
        mode: options.mode ?? 'scene',
        remove_people: true,
        axes: options.axes ?? 'opencv',
      };
      if (options.quality) body.quality = options.quality;
      if (options.maxGaussians) body.max_gaussians = options.maxGaussians;
      if (options.steps) body.steps = options.steps;
      const result = await retry('scan.job', () => call('scan.job', `/reconstructions/${pid}/jobs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }));
      if (!result.body?.id) throw new Error('job 响应缺少 id');
      return result.body;
    },
    async getJob(pid, jobId) {
      const { body, headers } = await retry('scan.job.poll', () => call('scan.job.poll', `/reconstructions/${pid}/jobs/${jobId}`));
      return { job: body, retryAfter: Number(headers.get('retry-after')) || null };
    },
    /**
     * 轮询作业。只认 status，不看 progress（踩过坑）；
     * failed 时把 error 原样抛出，不包装、不吞。
     */
    async waitJob(pid, jobId, { timeoutMinutes = 90, intervalMs = 10_000, onTick } = {}) {
      const deadline = Date.now() + timeoutMinutes * 60_000;
      let last;
      while (Date.now() < deadline) {
        const { job, retryAfter } = await this.getJob(pid, jobId);
        last = job;
        onTick?.(job);
        if (['succeeded', 'failed'].includes(job?.status)) break;
        const wait = retryAfter ? Math.min(retryAfter * 1000, 30_000) : intervalMs;
        await sleep(Math.max(1000, wait));
      }
      if (!last) throw new Error('作业轮询没有拿到任何状态');
      if (last.status === 'failed') {
        const error = new Error(last.error ?? '作业失败，但响应没有 error 字段');
        error.job = last;
        error.stage = last.stage;
        throw error;
      }
      if (last.status !== 'succeeded') throw new Error(`作业超时未完成，最后状态 ${last.status}/${last.stage}`);
      return last;
    },
    async downloadArtifact(artifact, outPath) {
      const res = await fetch(artifactUrl(artifact.href), {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(600_000),
      });
      if (!res.ok) throw new Error(`下载 ${artifact.name} HTTP ${res.status}`);
      const buffer = Buffer.from(await res.arrayBuffer());
      await mkdir(dirname(outPath), { recursive: true });
      await writeFile(outPath, buffer);
      logStep({ op: 'scan.download', http: res.status, note: `${artifact.name} ${buffer.length} bytes` });
      return { bytes: buffer.length, path: outPath };
    },
    async headArtifact(artifact) {
      const res = await fetch(artifactUrl(artifact.href), {
        method: 'HEAD',
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(60_000),
      });
      return { name: artifact.name, format: artifact.format, bytes: Number(res.headers.get('content-length')) || null, http: res.status };
    },
  };
}
