/**
 * 采集记录 · 本地历史（不上云）。
 *
 * 结果页每次到终态（done / failed）写一行，最新在前，最多留 20 条。
 * 真实后端接入后，这份本地记录作为离线缓存，云端以 openid 维度另建
 * `GET {API_BASE}/reconstructions?mine=1`（契约见 README「身份与额度契约」），
 * 两边按 jobId 去重合并——本期先只落本地，不给页面加 UI。
 */
const KEY = 'reconHistory';
const MAX = 20;

function read() {
  try {
    const list = wx.getStorageSync(KEY);
    return Array.isArray(list) ? list : [];
  } catch (error) {
    return [];
  }
}

function write(list) {
  try {
    wx.setStorageSync(KEY, list.slice(0, MAX));
  } catch (error) {
    // 存储满不影响当前结果页。
  }
}

/**
 * 记录一行终态。done 必带 size/modelUrl；failed 必带 code。
 * 重复 jobId（重开结果页、resume）直接覆盖旧行并置顶。
 */
function add(record) {
  if (!record || !record.jobId) return;
  const list = read().filter(item => item.jobId !== record.jobId);
  list.unshift({ at: Date.now(), ...record });
  write(list);
}

function list() {
  return read();
}

function latest() {
  return read()[0] || null;
}

function clear() {
  write([]);
}

module.exports = { add, list, latest, clear };
