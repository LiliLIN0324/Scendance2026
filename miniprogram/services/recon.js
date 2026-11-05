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
 *     status: 'preparing' | 'queued' | 'processing' | 'done' | 'failed',
 *     progress: 0–100 的整数,
 *     etaMinutes?: number,             // 剩余分钟，用于「约 X 分」
 *     code?: 'UPLOAD_FAILED' | 'LOW_COVERAGE' | 'LOW_LIGHT' | 'REJECTED'
 *          | 'TIMEOUT' | 'SERVER_ERROR' | 'NETWORK' | 'CANCELLED',
 *     message?: string,                // 失败时一句中文原因
 *     info?: { title, cause, eta, action, retryable },  // 失败态三段文案
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
const QUEUED_SECONDS = 3;
// 预处理（上传 + 校验）阶段：任务已建立但还没开始算，用户必须看到这一段，
// 否则「点了没反应」的三秒就是最容易被当成卡死的地方。
const PREPARE_SECONDS = 1.6;

/**
 * 失败必须交代三件事：卡在哪（cause）、还要多久（eta）、现在能做什么（action）。
 * 八种原因（上传 / 素材 / 服务 / 网络 / 取消），页面不自己拼文案，一律读这张表。
 */
const FAIL_INFO = {
  UPLOAD_FAILED: {
    title: '照片没传完',
    cause: '网络在中途断了，素材没送到服务器。',
    eta: '重传一次约 1 分钟，素材不用重拍。',
    action: '重新提交',
    retryable: true,
  },
  LOW_COVERAGE: {
    title: '素材不合格',
    cause: '一圈没拍满，服务器拼不出完整的场地边界。',
    eta: '补齐缺口约 2–3 分钟，再交一次。',
    action: '去补拍',
    retryable: true,
  },
  LOW_LIGHT: {
    title: '素材不合格',
    cause: '多数照片没有纹理，太暗或逆光，算不出深度。',
    eta: '开灯重拍约 5–8 分钟，再交一次。',
    action: '去补拍',
    retryable: true,
  },
  REJECTED: {
    title: '素材不合格',
    cause: '张数不够或糊片太多，没达到重建门槛。',
    eta: '按覆盖环补齐约 5 分钟，再交一次。',
    action: '去补拍',
    retryable: true,
  },
  TIMEOUT: {
    title: '服务超时',
    cause: '服务器 20 分钟内没算完，任务被回收。',
    eta: '稍后重试通常更快；连续超时换个时段。',
    action: '重新提交',
    retryable: true,
  },
  SERVER_ERROR: {
    title: '服务端出错',
    cause: '重建服务返回错误，不是你素材的问题。',
    eta: '重试即可，本次不扣次数。',
    action: '重新提交',
    retryable: true,
  },
  NETWORK: {
    title: '查不到进度',
    cause: '手机和服务器的连接断了，任务本身可能还在跑。',
    eta: '重新打开本页再查一次。',
    action: '再查一次',
    retryable: true,
  },
  CANCELLED: {
    title: '已取消',
    cause: '这次任务被你取消了，没有产物。',
    eta: '想再出模型就重新提交。',
    action: '重新提交',
    retryable: true,
  },
};

function failPayload(code, extra) {
  const info = FAIL_INFO[code] || FAIL_INFO.SERVER_ERROR;
  return {
    status: 'failed',
    progress: (extra && extra.progress) || 0,
    code,
    message: info.cause,
    info,
    retryable: info.retryable,
    refunded: true,
  };
}

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

/** 提交任务：创建 id 并落 storage，返回 jobId。reservationId 用于失败返还。 */
function submit(job) {
  const jobId = makeId();
  const durationSeconds = MIN_SECONDS + Math.random() * (MAX_SECONDS - MIN_SECONDS);
  writeRecord({
    jobId,
    startedAt: Date.now(),
    durationSeconds,
    failCode: '',
    cancelled: false,
    reservationId: (job && job.reservationId) || '',
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
    return Promise.resolve(failPayload('NETWORK', { progress: 0 }));
  }
  if (record.cancelled) {
    return Promise.resolve(failPayload('CANCELLED'));
  }
  if (record.failCode) {
    return Promise.resolve(
      failPayload(record.failCode, {
        progress: progressFor((Date.now() - record.startedAt) / 1000, record.durationSeconds),
      }),
    );
  }
  const elapsedSeconds = (Date.now() - record.startedAt) / 1000;
  if (elapsedSeconds >= record.durationSeconds) {
    const result = buildResult(jobId);
    // 保留 frameCount / scaleMeters / video / reservationId：结果页重进、首页续跑、失败返还都要用。
    writeRecord({ ...record, result });
    return Promise.resolve(result);
  }
  if (elapsedSeconds < PREPARE_SECONDS) {
    return Promise.resolve({
      status: 'preparing',
      progress: Math.round((elapsedSeconds / PREPARE_SECONDS) * 8),
      etaMinutes: Math.max(1, Math.ceil((record.durationSeconds - elapsedSeconds) / 60)),
    });
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

/** 供调试：立刻把当前任务标记为某类失败（UPLOAD_FAILED / LOW_COVERAGE / TIMEOUT 等）。 */
function forceFail(jobId, code) {
  const record = readRecord();
  if (!record || record.jobId !== jobId) return Promise.resolve(false);
  writeRecord({ ...record, failCode: FAIL_INFO[code] ? code : 'LOW_COVERAGE' });
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
    reservationId: record.reservationId || '',
    done: Boolean(record.result),
  };
}

/** 清掉当前记录：重试前调用，避免封面「继续上次重建」指向已经失败的任务。 */
function clear() {
  try {
    wx.removeStorageSync(STORAGE_KEY);
  } catch (error) {
    // 清不掉也不影响本次重试。
  }
  return Promise.resolve(true);
}

module.exports = { submit, poll, cancel, forceFail, resume, clear, FAIL_INFO };
