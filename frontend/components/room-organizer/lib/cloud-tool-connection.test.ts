import { describe, expect, it } from 'vitest';
import { aholoChatStep, understandingLine } from './cloud-tool-connection';

describe('cloud model readiness copy', () => {
  it('keeps model readiness line tied to model availability', () => {
    expect(understandingLine(false)).toBe('文字识别按本机规则处理。');
    expect(understandingLine(true)).toBe('输入文字可能发送至模型服务。');
  });
});

describe('群核 / 场地 / 物件 sentence', () => {
  it('opens the real panel when that entry can run', () => {
    expect(aholoChatStep('world', { spaceEntry: true, materialReady: false })).toEqual({
      start: 'space-world',
      text: '已打开场地生成，并带上你这句话。确认额度后才会提交。',
    });
    expect(aholoChatStep('recon', { spaceEntry: true, materialReady: false }).start).toBe('space-recon');
    expect(aholoChatStep('text', { spaceEntry: false, materialReady: true })).toMatchObject({ start: 'material' });
    expect(aholoChatStep('text', { spaceEntry: false, materialReady: true }, true).text).toContain('照片');
  });

  it('says why it cannot start and what to do next', () => {
    const space = aholoChatStep('world', { spaceEntry: false, materialReady: true });
    expect(space.start).toBeUndefined();
    expect(space.text).toContain('入口未开放');
    const material = aholoChatStep('text', { spaceEntry: true, materialReady: false });
    expect(material.start).toBeUndefined();
    expect(material.text).toContain('登录并连接云项目');
    expect(`${space.text}${material.text}`).not.toMatch(/LUX3D|start_lux3d|NEXT_PUBLIC|API_KEY/);
  });
});
