// pages/index/index.js
// 封面：只做入口，不放营销内容。首访带引导，复访直达取景。
const recon = require('../../services/recon');
const glass = require('../../utils/glass');
const pay = require('../../utils/pay');
const WELCOME_KEY = 'welcomeDone';

function welcomeDone() {
  try {
    return Boolean(wx.getStorageSync(WELCOME_KEY));
  } catch (error) {
    return false;
  }
}

Page({
  data: {
    topPad: 72,
    resumeLabel: '',
    resumeJobId: '',
    infoOpen: false,
    glassClass: glass.glassClass(),
    // 付款口径统一走 utils/pay.js，换 A/B 案只改那边的 FREE_PLAN。
    payQuote: pay.copy.quote,
    paySheet: pay.copy.sheet,
  },

  onShow() {
    const record = recon.resume();
    this.setData({
      resumeLabel: record ? (record.done ? '查看上次结果' : '继续上次重建') : '',
      resumeJobId: record ? record.jobId : '',
    });
  },

  onResume() {
    if (!this.data.resumeJobId) return;
    wx.navigateTo({
      url: `/pages/result/index?jobId=${encodeURIComponent(this.data.resumeJobId)}`,
    });
  },

  onLoad() {
    let topPad = 72;
    try {
      const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
      const width = info.windowWidth || 375;
      topPad = (info.statusBarHeight || 20) + Math.round((48 * width) / 750);
    } catch (error) {
      topPad = 72;
    }
    this.setData({ topPad });
  },

  onStart() {
    if (this.starting) return;
    this.starting = true;
    const seen = welcomeDone();
    wx.navigateTo({
      url: seen ? '/pages/capture/index' : '/pages/capture/index?guide=1',
      complete: () => {
        this.starting = false;
      },
    });
  },

  onInfo() {
    this.setData({ infoOpen: true });
  },

  onInfoClose() {
    this.setData({ infoOpen: false });
  },

  onInfoVisibleChange(event) {
    this.setData({ infoOpen: Boolean(event.detail && event.detail.visible) });
  },
});
