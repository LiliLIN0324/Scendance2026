import { describe, expect, it } from 'vitest';
import { aholoChatStep, planGenerationLine, understandingLine } from './cloud-tool-connection';

describe('cloud plan connection copy', () => {
  it('keeps model readiness and plan generation on separate lines', () => {
    expect(understandingLine(false)).toBe('文字识别按本机规则处理。');
    expect(understandingLine(true)).toBe('输入文字可能发送至模型服务。');
    expect(planGenerationLine('离线引导')).toBe('当前用本机规则出预览；连接云项目后可云端生成。');
    expect(planGenerationLine(undefined)).toBe('当前用本机规则出预览；连接云项目后可云端生成。');
  });

  it('names the real next step instead of a blanket disconnect', () => {
    expect(planGenerationLine('正在准备工作台')).toContain('正在连接云端方案生成');
    expect(planGenerationLine('正在准备工作台')).toContain('本机规则出预览');
    expect(planGenerationLine('功能已开放')).toContain('登录并取得编辑权');
    expect(planGenerationLine('项目已连接')).toBe('云端生成会发送当前场景及部分对话上下文。');
    for (const line of [planGenerationLine('离线引导'), planGenerationLine('功能已开放'), planGenerationLine('正在准备工作台')]) {
      expect(line).not.toContain('未连接云端方案生成');
    }
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
