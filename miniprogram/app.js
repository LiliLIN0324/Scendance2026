const account = require('./services/account');

App({
  onLaunch() {
    // 工具型小程序，无登录页、无账号体系。这里只做静默身份锚定：
    // wx.login 换 openid（付费次数绑 openid，免费额度走设备键），全程无 UI。
    account.ensureSession().catch(() => {});
  },
});
