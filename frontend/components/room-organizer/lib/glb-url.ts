/** Shared by the downloader and persistence so a loadable local asset also reopens. */
export function isGlbUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 4096 || /[\s\\]/.test(value)) return false;
  if (/^(?:\/(?!\/)|\.\/)[^#]+$/.test(value)) return true;
  try {
    const url = new URL(value);
    if (url.username || url.password || url.hash) return false;
    return url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname));
  } catch { return false; }
}
