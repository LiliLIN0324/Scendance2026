/**
 * 重建任务 · 小程序唯一网络层。
 *
 * mock，契约见 README，真实服务由 ZCode 提供。
 * 页面不许直接调用 wx.request / wx.uploadFile；接真实服务时只改本文件三个函数：
 *   submit(job)   → 先传帧再建任务，返回 jobId
 *   poll(jobId)   → 返回任务状态与产物
 *   cancel(jobId) → 取消任务
 *
 * 返回契约（real 实现必须逐字满足）：
 *   {
 *     status: 'queued' | 'processing' | 'done' | 'failed',
 *     progress: 0–100 的整数,
 *     etaMinutes?: number,             // 剩余分钟，用于「约 X 分」
 *     code?: 'LOW_COVERAGE' | 'LOW_LIGHT' | 'TIMEOUT' | 'CANCELLED',
 *     message?: string,                // 失败时一句中文原因
 *     modelUrl?: string,               // 成功：GLB
 *     rawUrl?: string,                 // 成功：原始文件
 *     size?: { w, d, h, unit },        // 成功：场地尺寸
 *     upAxis?: string,                 // 成功：'Y'
 *     normalized?: boolean,            // 成功：是否已归一化
 *     previewUrls?: string[4],         // 成功：4 张预览
 *   }
 */
const STORAGE_KEY = 'reconJob';
const MIN_SECONDS = 25;
const MAX_SECONDS = 40;
const QUEUED_SECONDS = 0.8;

const FAIL_REASONS = {
  LOW_COVERAGE: '素材覆盖不足：环向缺口太大，回去把没拍到的扇区补齐再交。',
  LOW_LIGHT: '现场太暗：多数照片缺纹理，换到亮处或开灯后重拍。',
  TIMEOUT: '重建超时：素材过多或服务繁忙，稍后重新提交。',
};

function readRecord() {
  try {
    const record = wx.getStorageSync(STORAGE_KEY);
    return record && record.jobId ? record : null;
  } catch (error) {
    return null;
  }
}

function writeRecord(record) {
  try {
    wx.setStorageSync(STORAGE_KEY, record);
  } catch (error) {
    // 存储写失败不影响当前会话，任务仍按 startedAt 推算。
  }
}

function makeId() {
  return `job-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function hashSeed(text) {
  let seed = 0;
  for (let index = 0; index < text.length; index += 1) {
    seed = (seed * 31 + text.charCodeAt(index)) >>> 0;
  }
  return seed;
}

/**
 * 模拟进度：前 5 秒慢（0→12%），中段快（12→90%），
 * 结束前停 4.5 秒在 90%，最后 1.5 秒冲到 100%。
 */
function progressFor(elapsedSeconds, durationSeconds) {
  if (elapsedSeconds >= durationSeconds) return 100;
  if (elapsedSeconds <= 5) {
    return Math.round((Math.max(0, elapsedSeconds) / 5) * 12);
  }
  const fastEnd = durationSeconds - 6;
  if (elapsedSeconds <= fastEnd) {
    const ratio = (elapsedSeconds - 5) / Math.max(1, fastEnd - 5);
    return Math.round(12 + ratio * 78);
  }
  const finishStart = durationSeconds - 1.5;
  if (elapsedSeconds <= finishStart) return 90;
  return Math.round(90 + ((elapsedSeconds - finishStart) / 1.5) * 10);
}

function buildResult(jobId) {
  const seed = hashSeed(jobId);
  const round1 = value => Math.round(value * 10) / 10;
  return {
    status: 'done',
    progress: 100,
    modelUrl: `https://mock.scendance.example/${jobId}/model.glb`,
    rawUrl: `https://mock.scendance.example/${jobId}/raw.zip`,
    size: {
      w: round1(8 + (seed % 70) / 10),
      d: round1(6 + ((seed >> 4) % 60) / 10),
      h: round1(3 + ((seed >> 8) % 30) / 10),
      unit: 'm',
    },
    upAxis: 'Y',
    normalized: true,
    previewUrls: [
      '/assets/brand/cover.jpg',
      '/assets/guide/bg-a.jpg',
      '/assets/guide/bg-b.jpg',
      '/assets/guide/bg-c.jpg',
    ],
  };
}

/** 提交任务：创建 id 并落 storage，返回 jobId。 */
function submit(job) {
  const jobId = makeId();
  const durationSeconds = MIN_SECONDS + Math.random() * (MAX_SECONDS - MIN_SECONDS);
  writeRecord({
    jobId,
    startedAt: Date.now(),
    durationSeconds,
    failCode: '',
    cancelled: false,
    frameCount: job && job.frames ? job.frames.length : 0,
    video: job && job.video ? job.video : null,
    scaleMeters: job && job.scaleMeters !== undefined ? job.scaleMeters : null,
  });
  return Promise.resolve(jobId);
}

/** 查询任务：进度按 storage 里的 startedAt 推算，切后台/杀进程都不会断。 */
function poll(jobId) {
  const record = readRecord();
  if (!record || record.jobId !== jobId) {
    return Promise.resolve({
      status: 'failed',
      progress: 0,
      code: 'TIMEOUT',
      message: '任务不存在或已过期，回去重新提交。',
    });
  }
  if (record.cancelled) {
    return Promise.resolve({
      status: 'failed',
      progress: 0,
      code: 'CANCELLED',
      message: '任务已取消。',
    });
  }
  if (record.failCode) {
    return Promise.resolve({
      status: 'failed',
      progress: progressFor((Date.now() - record.startedAt) / 1000, record.durationSeconds),
      code: record.failCode,
      message: FAIL_REASONS[record.failCode] || '重建失败，请重试。',
    });
  }
  const elapsedSeconds = (Date.now() - record.startedAt) / 1000;
  if (elapsedSeconds >= record.durationSeconds) {
    const result = buildResult(jobId);
    // 保留 frameCount / scaleMeters / video：结果页重进、首页续跑都要用，
    // 只写 result 会让这仨字段丢失。
    writeRecord({ ...record, result });
    return Promise.resolve(result);
  }
  return Promise.resolve({
    status: elapsedSeconds < QUEUED_SECONDS ? 'queued' : 'processing',
    progress: progressFor(elapsedSeconds, record.durationSeconds),
    etaMinutes: Math.max(1, Math.ceil((record.durationSeconds - elapsedSeconds) / 60)),
  });
}

/** 取消任务：仅清掉当前记录，页面据此可回到拍摄。 */
function cancel(jobId) {
  const record = readRecord();
  if (record && record.jobId === jobId) {
    writeRecord({ ...record, cancelled: true });
  }
  return Promise.resolve(true);
}

/** 供调试：立刻把当前任务标记为某类失败（LOW_COVERAGE / LOW_LIGHT / TIMEOUT）。 */
function forceFail(jobId, code) {
  const record = readRecord();
  if (!record || record.jobId !== jobId) return Promise.resolve(false);
  writeRecord({ ...record, failCode: FAIL_REASONS[code] ? code : 'LOW_COVERAGE' });
  return Promise.resolve(true);
}

/** 恢复：页面冷启动时拿未完成（或刚完成）任务。 */
function resume() {
  const record = readRecord();
  if (!record) return null;
  return {
    jobId: record.jobId,
    startedAt: record.startedAt,
    frameCount: record.frameCount || 0,
    done: Boolean(record.result),
  };
}

module.exports = { submit, poll, cancel, forceFail, resume };
