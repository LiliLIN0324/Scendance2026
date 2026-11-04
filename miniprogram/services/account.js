/**
 * 身份与额度 · 小程序变现预接线（docs/46）。
 *
 * 静默登录（wx.login → code2Session）换 openid，付费次数锚在 openid 上，
 * 设备键（ownerKey）只做免费额度的兜底锚点，两者都不需要任何登录 UI。
 *
 * config.API_BASE 为空（后端未接）时本模块全部降级为 no-op：
 *   ensureSession → { offline: true }
 *   getQuota / reserveJob / releaseJob / grantAdBonus / requestVirtualPayment → null / false
 * 页面无需判断，行为与 v0.1.0 骨架完全一致。
 *
 * 契约（与 docs/45 对齐，端点尚未实现，见 README「后端契约」）：
 *   POST {API_BASE}/session               { code } → { openid, token }
 *   GET  {API_BASE}/scan/quota            → { free, adBonus, purchased, dailyLimit }
 *   POST {API_BASE}/scan/consume          { jobId, idempotencyKey } （docs/45 预扣）
 *   POST {API_BASE}/scan/release          { jobId, reason }         （docs/45 返还）
 *   POST {API_BASE}/scan/ad-bonus         { token }                 （激励视频发券）
 *   POST {API_BASE}/pay/virtual/order     { sku } → wx.requestVirtualPayment 签名参数
 */
const config = require('../config');

const SESSION_KEY = 'accountSession';
const SESSION_TTL_MS = 20 * 24 * 60 * 60 * 1000; // 20 天后静默重登，openid 不变。
const OWNER_KEY_STORAGE = 'ownerKey';

function apiBase() {
  return (config && config.API_BASE || '').trim();
}

function online() {
  return apiBase().length > 0;
}

/** 匿名设备键：免费额度的兜底锚点，重装/清缓存会变，付费一律走 openid。 */
function ownerKey() {
  try {
    let key = wx.getStorageSync(OWNER_KEY_STORAGE);
    if (key) return key;
    key = `dev-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    wx.setStorageSync(OWNER_KEY_STORAGE, key);
    return key;
  } catch (error) {
    return 'dev-ephemeral';
  }
}

function readSession() {
  try {
    const session = wx.getStorageSync(SESSION_KEY);
    if (session && session.token && session.at && Date.now() - session.at < SESSION_TTL_MS) {
      return session;
    }
  } catch (error) {
    // 读不到就当无会话。
  }
  return null;
}

function writeSession(session) {
  try {
    wx.setStorageSync(SESSION_KEY, session);
  } catch (error) {
    // 写失败不阻塞，下次再试。
  }
}

function wxLoginCode() {
  return new Promise((resolve, reject) => {
    wx.login({
      success: res => (res.code ? resolve(res.code) : reject(new Error(res.errMsg || 'wx.login 无 code'))),
      fail: res => reject(new Error((res && res.errMsg) || 'wx.login 失败')),
    });
  });
}

function request(method, path, data, extraHeaders) {
  return new Promise((resolve, reject) => {
    wx.request({
      url: `${apiBase()}${path}`,
      method,
      data: data || {},
      timeout: 10000,
      header: {
        'content-type': 'application/json',
        'x-owner-key': ownerKey(),
        ...(extraHeaders || {}),
      },
      success: res => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(res.data);
          return;
        }
        const err = new Error((res.data && res.data.message) || `HTTP ${res.statusCode}`);
        err.code = (res.data && res.data.code) || `HTTP_${res.statusCode}`;
        err.statusCode = res.statusCode;
        reject(err);
      },
      fail: res => {
        const err = new Error((res && res.errMsg) || '网络请求失败');
        err.code = 'NETWORK';
        reject(err);
      },
    });
  });
}

/**
 * 静默登录：wx.login 的 code 换 openid + token。全程无 UI；
 * 失败只打日志不打扰用户，额度查询等后续调用会带 x-owner-key 兜底。
 */
async function ensureSession() {
  if (!online()) return { offline: true };
  const cached = readSession();
  if (cached) return cached;
  try {
    const code = await wxLoginCode();
    const session = await request('POST', '/session', { code });
    if (session && session.token) {
      writeSession({ openid: session.openid, token: session.token, at: Date.now() });
      return session;
    }
    return { offline: true };
  } catch (error) {
    return { offline: true, error: error.message };
  }
}

function authHeaders() {
  const session = readSession();
  return session && session.token ? { Authorization: `Bearer ${session.token}` } : {};
}

/** 额度三栏：free（每日免费）/ adBonus（看广告加量）/ purchased（付费次数包）。 */
async function getQuota() {
  if (!online()) return null;
  try {
    return await request('GET', '/scan/quota', null, authHeaders());
  } catch (error) {
    return null; // 额度拿不到不阻塞提交，后端会在 consume 时做最终裁决。
  }
}

/** 预扣一次重建（docs/45：失败自动返还）。offline 返回 null 表示未计费。 */
async function reserveJob() {
  if (!online()) return null;
  const pendingId = `pending-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  try {
    return await request('POST', '/scan/consume', {
      jobId: pendingId,
      idempotencyKey: `scan:${ownerKey()}:${pendingId}:1`,
    }, authHeaders());
  } catch (error) {
    if (error.code === 'INSUFFICIENT_CREDITS') throw error; // 上层引导看广告/付费。
    return null; // 网络抖动不挡提交，后端 consume 幂等兜底。
  }
}

/** 释放预扣（提交失败 / 重建失败时调用；reason 仅用于流水备注）。 */
async function releaseJob(jobId, reason) {
  if (!online() || !jobId) return false;
  try {
    await request('POST', '/scan/release', { jobId, reason: reason || '' }, authHeaders());
    return true;
  } catch (error) {
    return false;
  }
}

/** 激励视频看完后的加量发券；token 是广告回调票据，后端须向微信侧核验。 */
async function grantAdBonus(token) {
  if (!online() || !token) return false;
  try {
    await request('POST', '/scan/ad-bonus', { token }, authHeaders());
    return true;
  } catch (error) {
    return false;
  }
}

/**
 * 虚拟支付（个人主体已开放，条件见 docs/46）。
 * 后端用 OfferID/AppKey 签单，前端只拿签名参数调 wx.requestVirtualPayment。
 * 未开通 / offline / 基础库不支持时抛 { code: 'VIRTUAL_PAY_UNAVAILABLE' }。
 */
async function requestVirtualPayment(sku) {
  if (!online()) {
    const err = new Error('支付通道未接入');
    err.code = 'VIRTUAL_PAY_UNAVAILABLE';
    throw err;
  }
  if (!wx.requestVirtualPayment) {
    const err = new Error('当前微信版本不支持虚拟支付');
    err.code = 'VIRTUAL_PAY_UNAVAILABLE';
    throw err;
  }
  const order = await request('POST', '/pay/virtual/order', { sku }, authHeaders());
  if (!order || !order.signData) {
    const err = new Error((order && order.message) || '下单失败');
    err.code = (order && order.code) || 'ORDER_FAILED';
    throw err;
  }
  return new Promise((resolve, reject) => {
    wx.requestVirtualPayment({
      signData: order.signData,
      sign: order.sign,
      mode: order.mode || 'short_series_goods',
      success: resolve,
      fail: res => {
        const err = new Error((res && res.errMsg) || '支付未完成');
        err.code = (res && res.errMsg && res.errMsg.indexOf('cancel') >= 0) ? 'USER_CANCEL' : 'PAY_FAILED';
        reject(err);
      },
    });
  });
}

module.exports = {
  ensureSession,
  getQuota,
  reserveJob,
  releaseJob,
  grantAdBonus,
  requestVirtualPayment,
  ownerKey,
};
