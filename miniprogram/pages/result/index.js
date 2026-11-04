// pages/result/index.js
// 结果页四态：上传中 / 重建中（进度 + 约 X 分 + 卡住提示）/ 成功（预览 + 尺寸 + 产物）/ 失败。
// 失败必须交代三件事：卡在哪、还要多久、现在能做什么；同时把「不扣次数」写清楚并真的释放预扣。
// 所有网络调用只走 services/recon.js；jobId 落 storage，切后台或杀进程回来可续上。
const recon = require('../../services/recon');
const history = require('../../services/history');
const account = require('../../services/account');
const glass = require('../../utils/glass');

const STATE_LABELS = {
  preparing: '上传中',
  queued: '排队中',
  processing: '重建中',
};
// 进度 40 秒没动 → 给一句「还在重试」，而不是让转圈转到死。
const STALL_MS = 40000;
// 与后端一致的上限：超过 20 分钟本地直接判超时，避免无限等待。
const TIMEOUT_MS = 20 * 60 * 1000;
const POLL_MS = 1200;

Page({
  data: {
    jobId: '',
    state: 'preparing',
    stateLabel: '上传中',
    progress: 0,
    etaText: '',
    runNote: '',
    stalled: false,
    failTitle: '',
    failCause: '',
    failEta: '',
    failAction: '',
    refundText: '',
    canRetry: false,
    modelUrl: '',
    rawUrl: '',
    size: null,
    upAxis: '',
    normalized: false,
    previewUrls: [],
    glassClass: glass.glassClass(),
  },

  onLoad(query) {
    let jobId = (query && query.jobId) || '';
    this.record = recon.resume();
    if (!jobId && this.record) jobId = this.record.jobId;
    if (!jobId) {
      this.showFail({
        code: 'NETWORK',
        progress: 0,
      });
      return;
    }
    this.polling = false;
    this.timer = null;
    this.lastProgress = -1;
    this.lastProgressAt = Date.now();
    this.refundDone = false;
    this.setData({ jobId });
  },

  onShow() {
    this.startPolling();
  },

  onHide() {
    this.stopPolling();
  },

  onUnload() {
    this.stopPolling();
  },

  startPolling() {
    if (!this.data.jobId || this.polling) return;
    if (this.data.state === 'done') return;
    // 带 code 的失败是终态；网络异常（无 code）回到前台后允许再查一次。
    if (this.data.state === 'failed' && this.data.code) return;
    this.polling = true;
    this.tick();
  },

  stopPolling() {
    this.polling = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  },

  tick() {
    const jobId = this.data.jobId;
    recon
      .poll(jobId)
      .then(result => {
        if (!this.polling) return;
        this.apply(result);
        if (result.status === 'done' || result.status === 'failed') {
          this.polling = false;
          return;
        }
        this.timer = setTimeout(() => this.tick(), POLL_MS);
      })
      .catch(() => {
        // 前端只兜底一次网络抖动，不把「查不到」当成「重建失败」。
        this.polling = false;
        this.showFail({ code: 'NETWORK', progress: this.data.progress });
      });
  },

  apply(result) {
    if (result.status === 'done') {
      this.setData({
        state: 'done',
        stateLabel: '已完成',
        progress: 100,
        modelUrl: result.modelUrl || '',
        rawUrl: result.rawUrl || '',
        size: result.size || null,
        upAxis: result.upAxis || '',
        normalized: Boolean(result.normalized),
        previewUrls: result.previewUrls || [],
      });
      history.add({
        jobId: this.data.jobId,
        state: 'done',
        size: result.size || null,
        preview: (result.previewUrls || [])[0] || '',
        modelUrl: result.modelUrl || '',
      });
      return;
    }
    if (result.status === 'failed') {
      history.add({
        jobId: this.data.jobId,
        state: 'failed',
        code: result.code || '',
        message: result.message || '',
      });
      this.showFail(result);
      return;
    }

    // 本地超时兜底：后端不回话也不让转圈转到死。
    const startedAt = this.record && this.record.startedAt;
    if (startedAt && Date.now() - startedAt > TIMEOUT_MS) {
      recon.forceFail(this.data.jobId, 'TIMEOUT');
      this.apply({ status: 'failed', code: 'TIMEOUT', progress: this.data.progress });
      return;
    }

    const progress = typeof result.progress === 'number' ? result.progress : this.data.progress;
    if (progress !== this.lastProgress) {
      this.lastProgress = progress;
      this.lastProgressAt = Date.now();
    }
    const stalled = Date.now() - this.lastProgressAt > STALL_MS;
    const etaMinutes = result.etaMinutes || 1;
    const isUpload = result.status === 'preparing';
    this.setData({
      state: result.status === 'preparing' ? 'preparing' : result.status === 'queued' ? 'queued' : 'processing',
      stateLabel: STATE_LABELS[result.status] || '重建中',
      progress,
      stalled,
      etaText: isUpload ? '约 1 分钟' : `约 ${etaMinutes} 分`,
      runNote: stalled
        ? '进度 40 秒没动 · 仍在重试 · 可先退出，回来接着看'
        : isUpload
          ? '照片上传中 · 失败或超 20 分自动返还'
          : '失败或超 20 分自动返还',
    });
  },

  /**
   * 失败态统一出口：原因三段文案 + 返还结果 + 一个能立刻做的动作。
   * info 缺失时按 code 兜底，保证任何失败都有话说。
   */
  showFail(result) {
    const code = (result && result.code) || 'SERVER_ERROR';
    const info = (result && result.info) || recon.FAIL_INFO[code] || recon.FAIL_INFO.SERVER_ERROR;
    this.setData({
      state: 'failed',
      stateLabel: '没做成',
      stalled: false,
      progress: (result && typeof result.progress === 'number') ? result.progress : this.data.progress,
      code,
      failTitle: info.title,
      failCause: info.cause,
      failEta: info.eta,
      failAction: info.action,
      canRetry: Boolean(info.retryable),
      refundText: '',
    });
    this.applyRefund(code);
  },

  /** 扣了钱必须出货：失败即释放预扣，并把结果如实写在同一张卡上。 */
  applyRefund(code) {
    if (this.refundDone) return;
    this.refundDone = true;
    const reservationId = (this.record && this.record.reservationId) || '';
    if (!reservationId) {
      // 离线 / 未接后端时根本没扣，别写「已返还」假装退过钱。
      this.setData({ refundText: '本次未扣次数' });
      return;
    }
    account.releaseJob(reservationId, code).then(ok => {
      this.setData({ refundText: ok ? '本次不计次，已自动返还' : '返还提交中，稍后自动到账' });
    });
  },

  // —— 分享：转发给好友 / 朋友圈（单页模式）。模型可读性由后端 URL 鉴权决定，前端不设门禁 ——
  onShareAppMessage() {
    if (this.data.state === 'done' && this.data.size) {
      const { w, d, h, unit } = this.data.size;
      return {
        title: `现场 3D 模型 · ${w}×${d}×${h} ${unit}`,
        path: `/pages/result/index?jobId=${encodeURIComponent(this.data.jobId)}`,
      };
    }
    return {
      title: '现场采集器 · 拍几张照片出 3D',
      path: '/pages/capture/index',
    };
  },

  // —— 导出：模型文件发到微信聊天（文件传输助手即中转站） ——
  onShareModelFile() {
    const url = this.data.modelUrl;
    if (!url) return;
    if (!wx.shareFileMessage) {
      this.onCopyModel();
      return;
    }
    wx.showLoading({ title: '准备文件' });
    wx.downloadFile({
      url,
      success: res => {
        wx.hideLoading();
        wx.shareFileMessage({
          filePath: res.tempFilePath,
          fileName: `scendance-${this.data.jobId}.glb`,
          fail: res2 => {
            if (res2 && res2.errMsg && res2.errMsg.indexOf('cancel') >= 0) return;
            wx.showToast({ title: '导出失败，可复制链接到浏览器下载', icon: 'none' });
          },
        });
      },
      fail: () => {
        wx.hideLoading();
        wx.showToast({ title: '下载失败，可复制链接到浏览器下载', icon: 'none' });
      },
    });
  },

  // —— 成功态：复制链接 / 两个产物 ——
  onCopyLink() {
    if (!this.data.modelUrl) return;
    wx.setClipboardData({
      data: this.data.modelUrl,
      success: () => wx.showToast({ title: '已复制', icon: 'none' }),
    });
  },

  onCopyModel() {
    if (!this.data.modelUrl) return;
    wx.setClipboardData({
      data: this.data.modelUrl,
      success: () => wx.showToast({ title: '已复制模型链接', icon: 'none' }),
    });
  },

  onCopyRaw() {
    if (!this.data.rawUrl) return;
    wx.setClipboardData({
      data: this.data.rawUrl,
      success: () => wx.showToast({ title: '已复制原始文件链接', icon: 'none' }),
    });
  },

  // —— 失败态动作：重试回拍摄页（素材还在内存里，不用重拍）；退出回封面 ——
  onRetry() {
    this.stopPolling();
    recon.clear();
    const pages = getCurrentPages();
    if (pages.length > 1) {
      wx.navigateBack();
    } else {
      wx.redirectTo({ url: '/pages/capture/index' });
    }
  },

  onExit() {
    this.stopPolling();
    wx.reLaunch({ url: '/pages/index/index' });
  },

  // 调试：长按处理中卡片，手动触发各类失败；真机验收用，平时不可见。
  onDebugFail() {
    if (this.data.state === 'done' || this.data.state === 'failed') return;
    const codes = ['LOW_COVERAGE', 'LOW_LIGHT', 'UPLOAD_FAILED', 'REJECTED', 'SERVER_ERROR', 'TIMEOUT'];
    wx.showActionSheet({
      itemList: ['覆盖不足', '太暗', '上传失败', '素材不合格', '服务端出错', '超时'],
      success: res => {
        const code = codes[res.tapIndex];
        if (!code) return;
        recon.forceFail(this.data.jobId, code).then(() => {
          this.stopPolling();
          this.startPolling();
        });
      },
    });
  },
});
