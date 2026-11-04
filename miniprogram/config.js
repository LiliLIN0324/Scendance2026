/**
 * 运行时配置（需用户本人填写）。
 *
 * API_BASE：小程序 request / uploadFile / downloadFile 合法域名，必须是
 *   已 ICP 备案 + 境内接入的反代地址（例如 https://api.your-domain.cn）。
 *   不能填 Supabase 的境外域名，也不能填 Cloudflare Pages 的 *.space 域名。
 * VIEW_BASE：重建完成后的只读查看页前缀，同属上述已备案域名。
 */
module.exports = {
  API_BASE: '',
  VIEW_BASE: '',
};
