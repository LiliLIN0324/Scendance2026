import { describe, expect, it } from 'vitest';
import { isGlbUrl, isPackagedGlbUrl } from './glb-url';

describe('glb-url（可加载资产引用校验）', () => {
  describe('isGlbUrl', () => {
    it('https 任意主机可加载，同源相对路径可加载', () => {
      expect(isGlbUrl('https://example.com/models/a.glb')).toBe(true);
      expect(isGlbUrl('/models/a.glb')).toBe(true);
      expect(isGlbUrl('./models/a.glb')).toBe(true);
    });

    it('http 仅回环主机放行，公网 http 拒绝', () => {
      expect(isGlbUrl('http://localhost:8080/a.glb')).toBe(true);
      expect(isGlbUrl('http://127.0.0.1/a.glb')).toBe(true);
      expect(isGlbUrl('http://[::1]/a.glb')).toBe(true);
      expect(isGlbUrl('http://example.com/a.glb')).toBe(false);
    });

    it('带凭证 / 片段锚点的 URL 拒绝', () => {
      expect(isGlbUrl('https://user:pass@example.com/a.glb')).toBe(false);
      expect(isGlbUrl('https://example.com/a.glb#scene')).toBe(false);
    });

    it('含空格或反斜杠、非字符串、超长引用拒绝', () => {
      expect(isGlbUrl('https://example.com/a b.glb')).toBe(false);
      expect(isGlbUrl('https://example.com/a\\b.glb')).toBe(false);
      expect(isGlbUrl(null)).toBe(false);
      expect(isGlbUrl(123)).toBe(false);
      expect(isGlbUrl('x'.repeat(4097))).toBe(false);
    });

    it('协议相对双斜杠路径与非 URL 文本拒绝', () => {
      expect(isGlbUrl('//example.com/a.glb')).toBe(false);
      expect(isGlbUrl('not a url')).toBe(false);
    });
  });

  describe('isPackagedGlbUrl', () => {
    it('仅同源站点内相对路径算打包资产，远程 / 双斜杠 / 空值不算', () => {
      expect(isPackagedGlbUrl('/models/a.glb')).toBe(true);
      expect(isPackagedGlbUrl('./models/a.glb')).toBe(true);
      expect(isPackagedGlbUrl('https://example.com/a.glb')).toBe(false);
      expect(isPackagedGlbUrl('//example.com/a.glb')).toBe(false);
      expect(isPackagedGlbUrl(undefined)).toBe(false);
    });
  });
});
