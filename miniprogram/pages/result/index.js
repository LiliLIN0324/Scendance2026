// pages/result/index.js
// 结果页三态：处理中（进度 + 约 X 分）/ 成功（4 张预览 + 尺寸 + 两个产物）/ 失败（原因 + 一个动作）。
// 所有网络调用只走 services/recon.js；jobId 落 storage，切后台或杀进程回来可续上。
const recon = require('../../services/recon');
const history = require('../../services/history');
const glass = require('../../utils/glass');

const STATE_LABELS = {
  queued: '排队中',
  processing: '重建中',
  done: '已完成',
  failed: '失败',
};

Page({
  data: {
    jobId: '',
    state: 'queued',
    stateLabel: '排队中',
    progress: 0,
    etaMinutes: 1,
    message: '',
    code: '',
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
    if (!jobId) {
      const record = recon.resume();
      if (record) jobId = record.jobId;
    }
    this.polling = false;
    this.timer = null;
    if (!jobId) {
      this.setData({
        state: 'failed',
        stateLabel: '失败',
        message: '没有找到重建任务，回去重新提交一次。',
      });
      return;
    }
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
        this.timer = setTimeout(() => this.tick(), 1500);
      })
      .catch(() => {
        this.polling = false;
        this.setData({
          state: 'failed',
          stateLabel: '失败',
          message: '网络异常，稍后重新打开本页查询。',
        });
      });
  },

  apply(result) {
    if (result.status === 'done') {
      this.setData({
        state: 'done',
        stateLabel: '已完成',
        progress: 100,
        message: '',
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
      this.setData({
        state: 'failed',
        stateLabel: '失败',
        progress: typeof result.progress === 'number' ? result.progress : this.data.progress,
        message: result.message || '重建失败，请重试。',
        code: result.code || '',
      });
      history.add({
        jobId: this.data.jobId,
        state: 'failed',
        code: result.code || '',
        message: result.message || '',
      });
      return;
    }
    this.setData({
      state: result.status === 'queued' ? 'queued' : 'processing',
      stateLabel: STATE_LABELS[result.status] || '重建中',
      progress: typeof result.progress === 'number' ? result.progress : this.data.progress,
      etaMinutes: result.etaMinutes || 1,
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

  // —— 导出：预览图存相册（远程图先下载；需 scope.writePhotosAlbum 授权） ——
  onSavePreviews() {
    const urls = (this.data.previewUrls || []).filter(url => /^https?:\/\//.test(url));
    if (!urls.length) {
      wx.showToast({ title: '后端接入后即可保存预览图', icon: 'none' });
      return;
    }
    const savedPath = url =>
      new Promise((resolve, reject) => {
        wx.downloadFile({
          url,
          success: res => wx.saveImageToPhotosAlbum({ filePath: res.tempFilePath, success: resolve, fail: reject }),
          fail: reject,
        });
      });
    savedPath(urls[0])
      .then(() => wx.showToast({ title: '已存到相册', icon: 'success' }))
      .catch(res => {
        const msg = (res && res.errMsg) || '';
        if (msg.indexOf('auth den') >= 0 || msg.indexOf('authorize') >= 0) {
          wx.showModal({
            title: '需要相册权限',
            content: '去设置里打开「添加到相册」，回来再存。',
            confirmText: '去设置',
            success: res2 => {
              if (res2.confirm) wx.openSetting();
            },
          });
          return;
        }
        if (msg.indexOf('cancel') >= 0) return;
        wx.showToast({ title: '保存失败', icon: 'none' });
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

  // —— 失败态：只给一个动作 ——
  onFailAction() {
    const pages = getCurrentPages();
    if (pages.length > 1) {
      wx.navigateBack();
    } else {
      wx.redirectTo({ url: '/pages/capture/index' });
    }
  },

  // 调试：长按处理中卡片，手动触发三类失败；真机验收用，平时不可见。
  onDebugFail() {
    if (this.data.state === 'done' || this.data.state === 'failed') return;
    const codes = ['LOW_COVERAGE', 'LOW_LIGHT', 'TIMEOUT'];
    wx.showActionSheet({
      itemList: ['覆盖不足 LOW_COVERAGE', '太暗 LOW_LIGHT', '超时 TIMEOUT'],
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
