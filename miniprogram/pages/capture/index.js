// pages/capture/index.js
// 全屏取景 + 零文字浮层：快门外环即进度，判定只出短胶囊，方向只出箭头。
const scoring = require('../../utils/scoring');
const analysis = require('../../utils/analysis');
const recon = require('../../services/recon');
const account = require('../../services/account');
const glass = require('../../utils/glass');
const pay = require('../../utils/pay');
const T = require('../../lib/thresholds');

const GATE_COVERAGE_DEG = 300;
const TOTAL_GATE = T.targets.perLayer * scoring.CAPTURE_LAYERS.length;
const LAYER_SHORT = { low: '低', eye: '视线', high: '高' };
const WELCOME_KEY = 'welcomeDone';
const ARROW_IDLE_MS = 1600;
const ARROW_COVERAGE_LIMIT = 0.85;
const DUPLICATE_LOOKBACK = 10;
const SUBMIT_HINT = pay.copy.submitHint;
const WELCOME_PAGES = [
  { title: '两种拍法', sub: '录视频绕一圈（推荐）· 逐张拍照也可以', bg: '/assets/guide/bg-a.jpg' },
  { title: '视频 20-60 秒', sub: '站中央缓慢转完一整圈 · 别走太快', bg: '/assets/guide/bg-b.jpg' },
  { title: '拍完得到', sub: '3D 模型，可导出', bg: '/assets/guide/bg-c.jpg' },
];
// 门槛分两套：required 是提交硬门槛，recommended 只是建议（只出现在 ⓘ）。
const GATES = {
  required: { perLayer: T.targets.perLayer, total: T.targets.perLayer * 3, coverageDeg: 300 },
  recommended: { perLayerMin: 55, perLayerMax: 65, totalMin: 160, totalMax: 200 },
};
const HINTS = {
  base:
    '步长 0.3–0.5 m，转角 8°–10°，距墙 1.2–1.8 m。\n' +
    '停 1–2 秒再按；每层绕回起点补一张闭合环。\n' +
    '找门框、接缝、转角当地标，别对空墙。',
  gate: `最低：每层 ${GATES.required.perLayer} 张、共 ${GATES.required.total} 张、环向 ${GATES.required.coverageDeg}°。\n推荐：每层 ${GATES.recommended.perLayerMin}–${GATES.recommended.perLayerMax} 张、共 ${GATES.recommended.totalMin}–${GATES.recommended.totalMax} 张，注册率更高。`,
  pay: pay.copy.hint,
  sim: '模拟器没有后置相机，用相册导入，或点右上「预览」用真机拍摄。',
};

function isDevtools() {
  try {
    const info = wx.getDeviceInfo ? wx.getDeviceInfo() : wx.getSystemInfoSync();
    return info.platform === 'devtools';
  } catch (error) {
    return false;
  }
}

// B 覆盖环：固定 24 段（15°），有朝向数据时按空间占用点亮，最大空洞中心 3 段转琥珀。
const RING_BINS = 24;
const RING_STEP = 360 / RING_BINS;

function buildRingTicks(coverageDeg, headings) {
  const occupied = new Array(RING_BINS).fill(false);
  const spatial = Array.isArray(headings) && headings.length > 0;
  let lit = 0;

  if (spatial) {
    headings.forEach(heading => {
      if (typeof heading !== 'number') return;
      const norm = ((heading % 360) + 360) % 360;
      occupied[Math.floor(norm / RING_STEP) % RING_BINS] = true;
    });
  } else {
    lit = Math.min(RING_BINS, Math.round((coverageDeg / 360) * RING_BINS));
    for (let bin = 0; bin < lit; bin += 1) occupied[bin] = true;
  }

  const gap = new Array(RING_BINS).fill(false);
  if (spatial) {
    let bestStart = -1;
    let bestLen = 0;
    for (let start = 0; start < RING_BINS; start += 1) {
      if (occupied[start]) continue;
      let len = 0;
      while (len < RING_BINS && !occupied[(start + len) % RING_BINS]) len += 1;
      if (len > bestLen) {
        bestLen = len;
        bestStart = start;
      }
    }
    // 全空或全满时没有「缺口」，只留 dim / 亮段。
    if (bestLen > 0 && bestLen < RING_BINS) {
      const center = (bestStart + Math.floor(bestLen / 2)) % RING_BINS;
      for (let offset = -1; offset <= 1; offset += 1) {
        gap[(center + offset + RING_BINS) % RING_BINS] = true;
      }
    }
  }

  const ticks = [];
  for (let bin = 0; bin < RING_BINS; bin += 1) {
    ticks.push({
      id: bin,
      deg: bin * RING_STEP,
      on: occupied[bin],
      gap: gap[bin],
    });
  }
  return ticks;
}

function buzz(type) {
  try {
    wx.vibrateShort({ type });
  } catch (error) {
    // 部分机型不支持触觉反馈，静默跳过。
  }
}

/** 权限被拒的统一出口：一句话 + 一个「去设置」按钮，不静默失败。 */
function guideToSetting(content) {
  wx.showModal({
    title: '需要权限',
    content,
    showCancel: false,
    confirmText: '去设置',
    confirmColor: '#35624A',
    success: res => {
      if (res.confirm && wx.openSetting) wx.openSetting({});
    },
  });
}

Page({
  data: {
    devtools: false,
    cameraError: '',
    topPad: 36,
    infoTop: 28,
    brandTop: 28,
    waitHint: true,
    layerBars: [
      { id: 'low', label: LAYER_SHORT.low, on: false, count: 0, target: T.targets.perLayer },
      { id: 'eye', label: LAYER_SHORT.eye, on: true, count: 0, target: T.targets.perLayer },
      { id: 'high', label: LAYER_SHORT.high, on: false, count: 0, target: T.targets.perLayer },
    ],
    ringTicks: buildRingTicks(0),
    ringPulse: false,
    arrowShow: false,
    arrowSide: 'right',
    verdictText: '',
    verdictHint: '',
    verdictBad: false,
    rejectCount: 0,
    gateText: '',
    gateHint: '',
    gateKind: '',
    hintPay: '',
    layerIndex: 1,
    frameCount: 0,
    shutterActive: false,
    canSubmit: false,
    submitting: false,
    hintOpen: false,
    hintBody: '',
    scaleText: '',
    welcomeVisible: false,
    welcomeIndex: 0,
    welcomePage: WELCOME_PAGES[0],
    welcomePages: WELCOME_PAGES,
    skipTop: 88,
    glassClass: glass.glassClass(),
  },

  onLoad(options) {
    this.frames = [];
    this.rejectCount = 0;
    this.startedAt = Date.now();
    this.lastFrameAt = Date.now();
    this.heading = null;
    this.gpsFix = null;
    this.arrowFrames = 0;
    this.arrowHeading = null;
    this.verdictTimer = null;
    this.pulseTimer = null;
    this.gateTimer = null;

    let seen = false;
    try {
      seen = Boolean(wx.getStorageSync(WELCOME_KEY));
    } catch (error) {
      seen = false;
    }
    // 封面首访带 guide=1；直接进入且没看过引导也补看一次。
    const fromCoverGuide = Boolean(options && options.guide === '1');

    let statusBar = 20;
    let skipTop = 88;
    try {
      const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
      statusBar = info.statusBarHeight || 20;
      const menu = wx.getMenuButtonBoundingClientRect ? wx.getMenuButtonBoundingClientRect() : null;
      // 跳过按钮放在胶囊下方，避免和微信胶囊、状态栏打架。
      skipTop = menu && menu.bottom ? menu.bottom + 10 : statusBar + 48;
    } catch (error) {
      statusBar = 20;
      skipTop = 88;
    }

    this.setData({
      devtools: isDevtools(),
      topPad: statusBar + 12,
      infoTop: statusBar + 16,
      brandTop: statusBar + 8,
      skipTop,
      welcomeVisible: fromCoverGuide || !seen,
      welcomeIndex: 0,
      welcomePage: WELCOME_PAGES[0],
    });

    this.compassHandler = res => {
      const next = typeof res.direction === 'number' ? res.direction : null;
      if (this.data.arrowShow && this.arrowHeading !== null && next !== null) {
        const delta = Math.abs(((next - this.arrowHeading + 540) % 360) - 180);
        if (delta >= 30) this.hideArrow();
      }
      this.heading = next;
    };
    if (wx.onCompassChange) wx.onCompassChange(this.compassHandler);

    this.refreshGps();
    this.recompute();
    this.checkCameraPermission();

    this.waitTimer = setTimeout(() => this.setData({ waitHint: false }), 3000);
    this.arrowTimer = setInterval(() => this.tickArrow(), 200);
  },

  onUnload() {
    if (wx.offCompassChange && this.compassHandler) wx.offCompassChange(this.compassHandler);
    if (this.waitTimer) clearTimeout(this.waitTimer);
    if (this.arrowTimer) clearInterval(this.arrowTimer);
    if (this.verdictTimer) clearTimeout(this.verdictTimer);
    if (this.pulseTimer) clearTimeout(this.pulseTimer);
  },

  onCameraError(event) {
    this.setData({ cameraError: (event.detail && event.detail.errMsg) || '相机不可用' });
    this.checkCameraPermission();
  },

  /** 相机权限被拒时只提示一次，避免进入页面和相机报错连弹两次。 */
  guideToSettingOnce(content) {
    const now = Date.now();
    if (now - (this.permissionPromptAt || 0) < 4000) return;
    this.permissionPromptAt = now;
    guideToSetting(content);
  },

  checkCameraPermission() {
    if (!wx.getSetting) return;
    wx.getSetting({
      success: res => {
        if ((res.authSetting || {})['scope.camera'] === false) {
          this.guideToSettingOnce('相机权限没开，取景和拍照都用不了。');
        }
      },
    });
  },

  onCameraReady() {
    this.setData({ cameraError: '' });
  },

  refreshGps() {
    wx.getLocation({
      type: 'gcj02',
      isHighAccuracy: true,
      success: res => {
        this.gpsFix = {
          latitude: res.latitude,
          longitude: res.longitude,
          accuracy: res.accuracy,
          at: Date.now(),
        };
        this.setData({ gpsOn: true });
      },
      fail: () => {
        this.gpsFix = null;
        this.setData({ gpsOn: false });
      },
    });
  },

  // —— 首次 3 屏引导（可跳过，可从 ⓘ 重看） ——
  onWelcomeNext() {
    const next = this.data.welcomeIndex + 1;
    if (next >= WELCOME_PAGES.length) {
      this.finishWelcome();
      return;
    }
    this.setData({ welcomeIndex: next, welcomePage: WELCOME_PAGES[next] });
  },

  onWelcomeSkip() {
    this.finishWelcome();
  },

  finishWelcome() {
    try {
      wx.setStorageSync(WELCOME_KEY, 1);
    } catch (error) {
      // 存储失败不阻塞使用。
    }
    this.setData({ welcomeVisible: false });
  },

  onReplayWelcome() {
    this.setData({ welcomeVisible: true, welcomeIndex: 0, welcomePage: WELCOME_PAGES[0], hintOpen: false });
  },

  // —— 层 ——
  currentLayer() {
    return scoring.CAPTURE_LAYERS[this.data.layerIndex];
  },

  onLayerTap(event) {
    const id = (event && event.currentTarget && event.currentTarget.dataset && event.currentTarget.dataset.id) || '';
    const index = scoring.CAPTURE_LAYERS.indexOf(id);
    if (index < 0 || index === this.data.layerIndex) return;
    this.setData({ layerIndex: index });
    this.recompute();
    buzz('light');
  },

  // —— 快门 / 相册 ——
  // 快门只负责拍。提交是快门上方那颗绿钮，达标才出现，避免「绿了按一下就扣次」。
  onShutter() {
    buzz('light');
    if (this.data.devtools || this.data.cameraError) {
      this.onChooseMedia();
      return;
    }
    const camera = wx.createCameraContext();
    camera.takePhoto({
      quality: 'high',
      success: res => {
        this.addFrame(res.tempImagePath);
      },
      fail: error => {
        this.checkCameraPermission();
        this.showVerdict('失败', '再按一次', false);
      },
    });
  },

  onChooseMedia() {
    // 视频为主线（docs/22 §7）：一段连续绕拍 20-60s 即可出模型；图片降为兜底。
    wx.chooseMedia({
      count: 9,
      mediaType: ['mix'],
      maxDuration: 60,
      sizeType: ['original'],
      sourceType: ['album', 'camera'],
      success: res => {
        (res.tempFiles || []).forEach(file => {
          if (file.fileType === 'video') this.addVideoClip(file);
          else this.addFrame(file.tempFilePath);
        });
      },
      fail: error => {
        const message = (error && error.errMsg) || '';
        // 用户自己点取消不算权限问题。
        if (message.indexOf('cancel') >= 0) return;
        if (!wx.getSetting) {
          this.guideToSettingOnce('没拿到相册权限，去设置里允许后再试。');
          return;
        }
        wx.getSetting({
          success: res => {
            const auth = res.authSetting || {};
            if (auth['scope.camera'] === false) {
              this.guideToSettingOnce('相机权限没开，拍照和选图都用不了。');
            } else {
              this.guideToSettingOnce('没拿到相册权限，去设置里允许后再试。');
            }
          },
          fail: () => this.guideToSettingOnce('没拿到相册权限，去设置里允许后再试。'),
        });
      },
    });
  },

  /** 视频片段：一段连续绕拍 20-60s；>=15s 直接放行提交门（docs/22 §7 实测配方）。 */
  addVideoClip(file) {
    this.refreshGps();
    const duration = Math.round(file.duration || 0);
    this.videoClip = {
      path: file.tempFilePath,
      duration,
      size: file.size || 0,
    };
    this.recompute();
    if (duration >= 15) {
      this.showVerdict('整段收到', '可以交', false);
      if (this.lastConfirmAt === undefined || Date.now() - this.lastConfirmAt >= 400) {
        this.lastConfirmAt = Date.now();
        buzz('light');
        setTimeout(() => buzz('light'), 40);
      }
      this.pulseRing();
      return;
    }
    this.showVerdict('太短', '至少 15 秒', true);
  },

  /**
   * 拍一张 → 快检 → 只有合格才记账。
   * 关键：不合格的片子不进 frames，否则糊片/重复片会虚增张数和覆盖度，
   * 用户看到「环满了」但后端注册不了（实测 130 张只有 26 张进模型，一半是这么来的）。
   */
  addFrame(path) {
    this.refreshGps();
    const meta = {
      layer: this.currentLayer(),
      gps: this.gpsFix,
      heading: this.heading,
      at: Date.now(),
    };
    analysis
      .analyseImagePath(path, meta)
      .then(sample => {
        console.log('[capture] width/height/sharpness =', sample.width, sample.height, sample.sharpness);
        const verdict = this.judge(sample);
        if (!verdict.ok) {
          this.rejectCount += 1;
          this.setData({ rejectCount: this.rejectCount });
          this.showVerdict(verdict.text, verdict.hint, true);
          return;
        }
        sample.thumb = path;
        this.frames.push(sample);
        this.lastFrameAt = Date.now();
        if (this.data.arrowShow && this.frames.length - this.arrowFrames >= 2) this.hideArrow();
        this.recompute();
        this.confirmShot();
        // 软提示不拦：这张已经进 frames、已经推过覆盖环，只是画面上一句 2 秒建议。
        if (verdict.soft) this.showVerdict(verdict.text, verdict.hint, false, 2000);
      })
      .catch(() => {
        this.rejectCount += 1;
        this.setData({ rejectCount: this.rejectCount });
        this.showVerdict('读不出来', '重拍一张试试', true);
      });
  },

  /** 与最近 10 张比哈希：比只和上一张比，能挡住「站原地连按快门」。 */
  isDuplicateOfRecent(sample) {
    const recent = this.frames.slice(-DUPLICATE_LOOKBACK);
    return recent.some(
      frame => scoring.hammingDistanceHex(frame.hash || '', sample.hash || '') <= T.distinct.hammingThreshold,
    );
  },

  /**
   * 逐张判定，分两级：
   * 硬拦截（糊 / 重复）——特征点提不出来、等于同一张拍两遍，不进 frames，不计数。
   * 软提示（暗 / 亮 / 照片偏小）——构图与曝光建议，照常计数、照常推覆盖环，只给一句 2 秒文案。
   */
  judge(sample) {
    const hard = (text, hint) => ({ ok: false, text, hint, soft: false });

    // 256×256 拉普拉斯方差；阈值来自 shot-rules.ts，实测见 README。
    if (typeof sample.sharpness === 'number' && sample.sharpness < T.blur.varianceMin) {
      return hard('糊了', '停稳 1 秒再按');
    }
    if (this.isDuplicateOfRecent(sample)) {
      return hard('重复', '转向下一个角度');
    }

    let softText = '';
    let softHint = '';
    if (sample.meanLuma < T.exposure.meanLumaMin || sample.darkRatio > T.exposure.darkRatioMax) {
      softText = '偏暗';
      softHint = '开灯或转个方向';
    } else if (sample.meanLuma > T.exposure.meanLumaMax || sample.brightRatio > T.exposure.brightRatioMax) {
      softText = '偏亮';
      softHint = '避开灯和反光';
    } else if (this.isFrameTooSmall(sample)) {
      softText = '照片偏小';
      softHint = '走近一点，或换原图';
    }
    return { ok: true, text: softText, hint: softHint, soft: Boolean(softText) };
  },

  /**
   * 「太远」原来是拿照片短边和绝对 1080 比 —— 那是分辨率，不是距离：
   * 真机 takePhoto 常见 1280×720（短边 720），人走近了像素也不会变，所以恒判「太远」。
   * 现在只和「本机第一张的短边」比，低于其 70% 才提示，1080 仅作上限，规避低端机恒定误报。
   */
  isFrameTooSmall(sample) {
    const shortEdge = Math.min(sample.width || 0, sample.height || 0);
    if (!shortEdge) return false;
    if (!this.shortEdgeBase) this.shortEdgeBase = shortEdge;
    return shortEdge < Math.min(T.resolution.minShortEdge, this.shortEdgeBase * 0.7);
  },

  /** 合格：双轻 tick + 覆盖环脉冲，不需要读文字也知道「这张记下了」。 */
  confirmShot() {
    const now = Date.now();
    if (now - (this.lastConfirmAt || 0) >= 400) {
      this.lastConfirmAt = now;
      buzz('light');
      setTimeout(() => buzz('light'), 40);
    }
    this.pulseRing();
  },

  pulseRing() {
    this.setData({ ringPulse: true });
    if (this.pulseTimer) clearTimeout(this.pulseTimer);
    this.pulseTimer = setTimeout(() => this.setData({ ringPulse: false }), 180);
  },

  /** 硬拦截留 1.8 秒、带一句改法；软提示留 2 秒；其余（如「记下了」）1.2 秒不打扰。 */
  showVerdict(text, hint, bad, ms) {
    if (this.verdictTimer) clearTimeout(this.verdictTimer);
    this.setData({ verdictText: text, verdictHint: hint || '', verdictBad: Boolean(bad) });
    this.verdictTimer = setTimeout(
      () => this.setData({ verdictText: '', verdictHint: '', verdictBad: false }),
      ms || (bad ? 1800 : 1200),
    );
  },

  // —— 指路箭头：1.6s 无新帧且覆盖 <85% ——
  tickArrow() {
    if (!this.frames.length) return;
    if (this.data.arrowShow) return;
    if (Date.now() - this.lastFrameAt < ARROW_IDLE_MS) return;
    if (this.coverageRatio >= ARROW_COVERAGE_LIMIT) return;
    const side = this.gapSide();
    if (!side) return;
    this.setData({ arrowShow: true, arrowSide: side });
    this.arrowFrames = this.frames.length;
    this.arrowHeading = this.heading;
  },

  hideArrow() {
    this.setData({ arrowShow: false });
  },

  /** 现有 headingCoverage 分桶 → 最大空洞中间角 → 左/右箭头。 */
  gapSide() {
    const headings = this.frames.map(frame => frame.heading).filter(heading => typeof heading === 'number');
    if (headings.length < 3) return null;
    const compass = scoring.headingCoverage(headings);
    if (compass.samples === 0) return null;
    const bins = T.coverage.bins;
    let bestStart = -1;
    let bestLength = 0;
    let runStart = -1;
    for (let index = 0; index < bins * 2; index += 1) {
      const bin = index % bins;
      if (!compass.occupied[bin]) {
        if (runStart === -1) runStart = index;
        if (index - runStart + 1 > bestLength && index - runStart + 1 <= bins) {
          bestLength = index - runStart + 1;
          bestStart = runStart % bins;
        }
      } else {
        runStart = -1;
      }
    }
    if (bestLength === 0) return null;
    const gapCenter = ((bestStart + Math.floor(bestLength / 2)) % bins) * T.coverage.degPerBin + T.coverage.degPerBin / 2;
    const delta = ((gapCenter - headings[headings.length - 1] + 540) % 360) - 180;
    return delta >= 0 ? 'right' : 'left';
  },

  // —— ⓘ / 尺度 ——
  onHintTap() {
    const rejected = this.data.rejectCount ? `\n\n本次已作废 ${this.data.rejectCount} 张（不计数）。` : '';
    this.setData({
      hintOpen: !this.data.hintOpen,
      hintPay: HINTS.pay,
      hintBody:
        HINTS.base + '\n\n' + HINTS.gate + rejected + (this.data.devtools ? '\n\n' + HINTS.sim : ''),
    });
  },

  onHintClose() {
    this.setData({ hintOpen: false });
  },

  onHintVisibleChange(event) {
    this.setData({ hintOpen: Boolean(event.detail && event.detail.visible) });
  },

  onScaleInput(event) {
    this.setData({ scaleText: event.detail.value });
  },

  onScaleConfirm() {
    this.recompute();
    const meters = scoring.parseScaleMeters(this.data.scaleText);
    if (scoring.isValidScale(meters)) {
      this.showGateFlash(`长度记下：${scoring.formatMeters(meters)}`, 'good');
      this.setData({ hintOpen: false });
    } else {
      this.showGateFlash('长度看不懂，写成「3.5」或「350cm」', 'error');
    }
  },

  // —— 评分与门槛 ——
  recompute() {
    const scaleMeters = scoring.parseScaleMeters(this.data.scaleText);
    const scaleOk = scoring.isValidScale(scaleMeters);
    const score = scoring.scoreCapture({
      mode: 'photo',
      frames: this.frames,
      scaleMeters,
      durationMinutes: (Date.now() - this.startedAt) / 60000,
    });
    const metrics = score.metrics;
    const counts = metrics.layerCounts;
    const layersOk = scoring.CAPTURE_LAYERS.every(layer => counts[layer] >= T.targets.perLayer);
    const coverageOk = metrics.coverageDeg >= GATE_COVERAGE_DEG;
    // 视频模式：>=15s 的片段直接过门（照片门控对视频不适用）。
    const videoOk = Boolean(this.videoClip && this.videoClip.duration >= 15);
    const gatePass = videoOk || (this.frames.length >= TOTAL_GATE && layersOk && coverageOk && scaleOk);

    this.coverageRatio = Math.min(1, metrics.coverageDeg / 360);
    if (this.coverageRatio >= ARROW_COVERAGE_LIMIT) this.hideArrow();

    const started = this.frames.length > 0 || Boolean(this.videoClip);
    this.setData({
      layerBars: scoring.CAPTURE_LAYERS.map((layer, index) => ({
        id: layer,
        label: LAYER_SHORT[layer],
        on: index === this.data.layerIndex,
        count: counts[layer],
        target: T.targets.perLayer,
      })),
      ringTicks: buildRingTicks(
        metrics.coverageDeg,
        this.frames.map(frame => frame.heading).filter(heading => typeof heading === 'number')
      ),
      frameCount: this.frames.length,
      shutterActive: this.frames.length > 0,
      canSubmit: gatePass,
      gateText: gatePass ? pay.copy.gate : started ? this.buildGateMain(metrics, scaleOk) : '',
      gateHint: gatePass ? SUBMIT_HINT : started ? this.buildGateDetail(scaleOk, metrics) : '',
      gateKind: gatePass ? 'ready' : started ? 'need' : '',
    });
    this.lastScore = score;
    this.gatePass = gatePass;
    this.gateShort = videoOk ? '' : this.buildGateMain(metrics, scaleOk);
  },

  /**
   * 不达标时先说最要紧的一件（还差几张 / 环差多少度 / 没填长度），
   * 第二行再说清每层进度，回去补拍时知道该补哪层。
   */
  buildGateMain(metrics, scaleOk) {
    const missing = TOTAL_GATE - this.frames.length;
    if (missing > 0) return `缺 ${missing} 张`;
    const degShort = GATE_COVERAGE_DEG - Math.round(metrics.coverageDeg);
    if (degShort > 0) return `环差 ${Math.round(degShort / 10) * 10}°`;
    if (!scaleOk) return '没填长度';
    return '';
  },

  /** 第二行只说「张数之外还缺什么」：环没转满、长度没填；层数已由右侧计数常驻显示。 */
  buildGateDetail(scaleOk, metrics) {
    const parts = [];
    const degShort = Math.round((GATE_COVERAGE_DEG - metrics.coverageDeg) / 10) * 10;
    if (degShort > 0) parts.push(`环差 ${degShort}°`);
    if (!scaleOk) parts.push('长度未填');
    return parts.join(' · ');
  },

  /** 门槛/提交的临时反馈走取景页内的玻璃条，不用系统 toast（默认组件样子且盖住画面）。 */
  showGateFlash(text, kind) {
    if (this.gateTimer) clearTimeout(this.gateTimer);
    this.setData({ gateText: text, gateHint: '', gateKind: kind || 'error' });
    this.gateTimer = setTimeout(() => this.recompute(), 2600);
  },

  // —— 提交 ——
  onSubmit() {
    if (this.data.submitting) return;
    if (!this.data.canSubmit) {
      this.showGateFlash(this.gateShort || '还差一点', 'need');
      return;
    }
    this.startSubmit();
  },

  async startSubmit() {
    this.setData({ submitting: true });
    try {
      // 额度预扣（docs/45/46）：后端未接时 account 全部 no-op，行为不变。
      // 402 INSUFFICIENT_CREDITS 时明说「今天免费额度用完」，不给假的重试按钮。
      const reservation = await account.reserveJob();
      const reservationId = reservation ? reservation.reservationId || '' : '';
      const scaleMeters = scoring.parseScaleMeters(this.data.scaleText);
      const jobId = await recon.submit({
        frames: this.frames.map(sample => ({
          path: sample.thumb,
          layer: sample.layer,
          at: sample.at,
          width: sample.width,
          height: sample.height,
          meanLuma: sample.meanLuma,
          hash: sample.hash,
        })),
        video: this.videoClip
          ? { path: this.videoClip.path, duration: this.videoClip.duration, size: this.videoClip.size }
          : null,
        scaleMeters,
        reservationId,
        durationMinutes: Math.round((Date.now() - this.startedAt) / 60000),
        score: this.lastScore ? this.lastScore.total : null,
      });
      this.setData({ submitting: false, reservationId });
      wx.navigateTo({
        url: `/pages/result/index?jobId=${encodeURIComponent(jobId)}&count=${this.frames.length}`,
      });
    } catch (error) {
      this.setData({ submitting: false });
      if (error && error.code === 'INSUFFICIENT_CREDITS') {
        this.showGateFlash(pay.copy.exhausted, 'need');
        return;
      }
      this.showGateFlash('提交没成功，检查网络再按一次', 'error');
    }
  },

  // —— 分享：好友 / 朋友圈（单页模式），落在采集页即传播默认入口 ——
  onShareAppMessage() {
    return { title: '现场采集器 · 拍几张照片出 3D', path: '/pages/capture/index' };
  },

  onShareTimeline() {
    return { title: '现场采集器 · 拍几张照片出 3D' };
  },
});
