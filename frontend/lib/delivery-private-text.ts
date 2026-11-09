/** High-confidence literals shared by the local JSON, CSV and HTML exports. */
export function hasDeliveryPrivateLiteral(value: string): boolean {
  // Mask URLs before path detection: a public web path is not a Windows drive.
  const withoutUrls=value.replace(/https?:\/\/[^\s"'<>]+/gi, match=>' '.repeat(match.length));
  return /(?:^|[^a-z0-9_])sk-[a-z0-9_-]{8,}(?![a-z0-9_-])/i.test(value)
    || /(?:^|[^a-z0-9_])[a-z]:[\\/]/i.test(withoutUrls)
    || /(?:^|[\s"'(])\\\\[^\\/\s]+\\[^\\/\s]+/.test(withoutUrls);
}

/** 不将凭据、临时地址或原始内嵌文件写入可分享的交接文件。 */
export function deliveryPrivateText(value: string): string {
  return value.split('\n').map(line => {
    if (hasDeliveryPrivateLiteral(line)
      || /(?:\b(?:access[_-]?token|refresh[_-]?token|token|api[_-]?key|secret|password|authorization|signature)\s*[:=]\s*\S+|\bbearer\s+[a-z0-9._~-]{8,}|(?:密钥|密码|令牌)\s*[:：=]\s*\S+)/i.test(line)
      || /(?:^|[^a-z0-9_])(?:blob|data|file):/i.test(line)
      || /(?:^|[^a-z0-9+/])(?:iVBORw0KGgo|\/9j\/|R0lGOD|UklGR)[a-z0-9+/=]{16,}/i.test(line)
      || /https?%3a%2f%2f/i.test(line) || /(?:^|[^:])\/\/[^\s/]+:[^\s/@]+@/i.test(line)) return '[私密链接或凭据已隐藏]';
    const urls = line.replace(/\\\//g, '/').match(/https?:\/\/[^\s"'<>]+/gi) ?? [];
    for (const raw of urls) {
      try { const url = new URL(raw); if (url.username || url.password || url.search || url.hash || /%(?:3f|23|40)/i.test(raw) || /\/(?:sign|signed)\//i.test(url.pathname)) return '[私密链接或凭据已隐藏]'; }
      catch { return '[私密链接或凭据已隐藏]'; }
    }
    return line;
  }).join('\n');
}
