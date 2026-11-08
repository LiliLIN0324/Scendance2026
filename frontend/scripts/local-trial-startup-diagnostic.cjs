const stages = new Set(['准备隔离副本', '检查隔离配置', '分配本地端口', '启动本地数据服务', '启动本地工作台', '监听试用端口']);
const codes = new Set(['EADDRINUSE', 'EACCES', 'ENOENT', 'ENOSPC', 'EMFILE', 'EPERM']);
function startupDiagnostic(stage, error) {
  const safeStage = stages.has(stage) ? stage : '未知阶段';
  const code = codes.has(error?.code) ? `（${error.code}）` : '';
  return `独立对话试用启动失败：${safeStage}${code}。未确认请求状态。`;
}
module.exports = { startupDiagnostic };
