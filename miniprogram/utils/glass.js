// 毛玻璃能力探测。
// 小程序没有 CSS.supports / getComputedStyle，只能按运行环境判断：
// iOS（WKWebView）支持 -webkit-backdrop-filter；开发者工具（Chromium）支持；
// Android 微信 X5/系统 WebView 版本差异大，一律走降级（.62 黑底 + 顶部亮边）。
function detectGlass() {
  try {
    const info = wx.getDeviceInfo ? wx.getDeviceInfo() : wx.getSystemInfoSync();
    const platform = String((info && info.platform) || '').toLowerCase();
    return platform === 'ios' || platform === 'devtools' || platform === 'mac';
  } catch (error) {
    return false;
  }
}

function glassClass() {
  return detectGlass() ? 'glass-on' : '';
}

module.exports = { detectGlass, glassClass };
