// pages/capture/index.js
// 全屏取景 + 零文字浮层：快门外环即进度，判定只出短胶囊，方向只出箭头。
const scoring = require('../../utils/scoring');
const analysis = require('../../utils/analysis');
const recon = require('../../services/recon');
const account = require('../../services/account');
const glass = require('../../utils/glass');
const T = require('../../lib/thresholds');

const GATE_COVERAGE_DEG = 300;
const TOTAL_GATE = T.targets.perLayer * scoring.CAPTURE_LAYERS.length;
const LAYER_SHORT = { low: '低', eye: '视线', high: '高' };
const WELCOME_KEY = 'welcomeDone';
const ARROW_IDLE_MS = 1600;
const ARROW_COVERAGE_LIMIT = 0.85;
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
      { id: 'low', label: LAYER_SHORT.low, on: false },
      { id: 'eye', label: LAYER_SHORT.eye, on: true },
      { id: 'high', label: LAYER_SHORT.high, on: false },
    ],
    ringTicks: buildRingTicks(0),
    ringPulse: false,
    arrowShow: false,
    arrowSide: 'right',
    verdictText: '',
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
    this.startedAt = Date.now();
    this.lastFrameAt = Date.now();
    this.heading = null;
    this.gpsFix = null;
    this.arrowFrames = 0;
    this.arrowHeading = null;
    this.verdictTimer = null;
    this.pulseTimer = null;

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

  nextIncompleteLayer() {
    const counts = this.lastScore ? this.lastScore.metrics.layerCounts : { low: 0, eye: 0, high: 0 };
    const incomplete = scoring.CAPTURE_LAYERS.filter(layer => counts[layer] < T.targets.perLayer);
    if (incomplete.length === 0) {
      return scoring.CAPTURE_LAYERS[(this.data.layerIndex + 1) % scoring.CAPTURE_LAYERS.length];
    }
    const preferred = ['low', 'high', 'eye'].filter(layer => incomplete.indexOf(layer) !== -1);
    return preferred[0];
  },

  onLayerTap() {
    const layer = this.nextIncompleteLayer();
    this.setData({ layerIndex: scoring.CAPTURE_LAYERS.indexOf(layer) });
    this.recompute();
    buzz('light');
  },

  // —— 快门 / 相册 ——
  onShutter() {
    buzz('light');
    if (this.data.canSubmit) {
      this.onSubmit();
      return;
    }
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
        this.showVerdict('失败');
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
    this.showVerdict(duration >= 15 ? '可以了' : '太短');
    if (duration >= 15) {
      if (this.lastConfirmAt === undefined || Date.now() - this.lastConfirmAt >= 400) {
        this.lastConfirmAt = Date.now();
        buzz('light');
        setTimeout(() => buzz('light'), 40);
      }
      this.setData({ ringPulse: true });
      if (this.pulseTimer) clearTimeout(this.pulseTimer);
      this.pulseTimer = setTimeout(() => this.setData({ ringPulse: false }), 180);
    }
  },

  addFrame(path) {
    this.refreshGps();
    const previous = this.frames.length ? this.frames[this.frames.length - 1] : null;
    const meta = {
      layer: this.currentLayer(),
      gps: this.gpsFix,
      heading: this.heading,
      at: Date.now(),
    };
    analysis
      .analyseImagePath(path, meta)
      .then(sample => {
        sample.thumb = path;
        this.frames.push(sample);
        this.lastFrameAt = Date.now();
        if (this.data.arrowShow && this.frames.length - this.arrowFrames >= 2) this.hideArrow();
        this.recompute();
        this.judge(sample, previous);
      })
      .catch(() => {
        this.showVerdict('失败');
      });
  },

  /** 不合格只出 ≤4 字胶囊，不震动；合格双轻 tick + 环脉冲。 */
  judge(sample, previous) {
    if (sample.meanLuma < T.exposure.meanLumaMin || sample.darkRatio > T.exposure.darkRatioMax) {
      this.showVerdict('太暗');
      return;
    }
    if (sample.meanLuma > T.exposure.meanLumaMax || sample.brightRatio > T.exposure.brightRatioMax) {
      this.showVerdict('太亮');
      return;
    }
    // 256×256 拉普拉斯方差；阈值来自 shot-rules.ts，实测见 README。
    if (typeof sample.sharpness === 'number' && sample.sharpness < T.blur.varianceMin) {
      this.showVerdict('糊了');
      return;
    }
    if (Math.min(sample.width, sample.height) < T.resolution.minShortEdge) {
      this.showVerdict('太远');
      return;
    }
    if (previous && scoring.hammingDistanceHex(previous.hash, sample.hash) <= T.distinct.hammingThreshold) {
      this.showVerdict('重复');
      return;
    }
    const now = Date.now();
    if (now - (this.lastConfirmAt || 0) >= 400) {
      this.lastConfirmAt = now;
      buzz('light');
      setTimeout(() => buzz('light'), 40);
    }
    this.setData({ ringPulse: true });
    if (this.pulseTimer) clearTimeout(this.pulseTimer);
    this.pulseTimer = setTimeout(() => this.setData({ ringPulse: false }), 180);
  },

  showVerdict(text) {
    if (this.verdictTimer) clearTimeout(this.verdictTimer);
    this.setData({ verdictText: text });
    this.verdictTimer = setTimeout(() => this.setData({ verdictText: '' }), 1200);
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
    this.setData({
      hintOpen: !this.data.hintOpen,
      hintBody: HINTS.base + '\n\n' + HINTS.gate + (this.data.devtools ? '\n\n' + HINTS.sim : ''),
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
    if (scoring.isValidScale(scoring.parseScaleMeters(this.data.scaleText))) {
      wx.showToast({ title: '已记录', icon: 'none' });
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
    const gatePass =
      videoOk || (this.frames.length >= TOTAL_GATE && layersOk && coverageOk && scaleOk);

    this.coverageRatio = Math.min(1, metrics.coverageDeg / 360);
    if (this.coverageRatio >= ARROW_COVERAGE_LIMIT) this.hideArrow();

    this.setData({
      layerBars: scoring.CAPTURE_LAYERS.map((layer, index) => ({
        id: layer,
        label: LAYER_SHORT[layer],
        on: index === this.data.layerIndex,
      })),
      ringTicks: buildRingTicks(
        metrics.coverageDeg,
        this.frames.map(frame => frame.heading).filter(heading => typeof heading === 'number')
      ),
      frameCount: this.frames.length,
      shutterActive: this.frames.length > 0,
      canSubmit: gatePass,
    });
    this.lastScore = score;
    this.gatePass = gatePass;
    this.gateShort = videoOk ? '' : this.buildGateShort(scaleOk, counts, metrics);
  },

  buildGateShort(scaleOk, counts, metrics) {
    if (this.frames.length < TOTAL_GATE) return '还差张数';
    const short = scoring.CAPTURE_LAYERS.find(layer => counts[layer] < T.targets.perLayer);
    if (short) return `${LAYER_SHORT[short]}层不够`;
    if (metrics.coverageDeg < GATE_COVERAGE_DEG) return '环没转满';
    if (!scaleOk) return '填个长度';
    return '';
  },

  // —— 提交 ——
  onSubmit() {
    if (!this.data.canSubmit || this.data.submitting) {
      wx.showToast({ title: this.gateShort || '还差一点', icon: 'none' });
      return;
    }
    this.startSubmit();
  },

  async startSubmit() {
    this.setData({ submitting: true });
    try {
      // 额度预扣（docs/45/46）：后端未接时 account 全部 no-op，行为不变。
      // 402 INSUFFICIENT_CREDITS 时提示免费额度用完（广告加量/次数包 UI 待后端就绪后接）。
      const reservation = await account.reserveJob();
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
        durationMinutes: Math.round((Date.now() - this.startedAt) / 60000),
        score: this.lastScore ? this.lastScore.total : null,
      });
      this.setData({ submitting: false, reservationId: reservation ? reservation.reservationId || jobId : '' });
      wx.navigateTo({
        url: `/pages/result/index?jobId=${encodeURIComponent(jobId)}&count=${this.frames.length}`,
      });
    } catch (error) {
      this.setData({ submitting: false });
      if (error && error.code === 'INSUFFICIENT_CREDITS') {
        wx.showToast({ title: '今天的免费次数用完了，明天再来或换设备前先完成提交', icon: 'none', duration: 2500 });
        return;
      }
      wx.showToast({ title: (error && error.message) || '提交失败', icon: 'none' });
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
