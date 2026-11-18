import { describe, expect, it } from 'vitest';
import { GENERIC_WORKER_LINE, workerPresetLine } from './outdoor-worker-lines';

describe('workerPresetLine', () => {
  it('maps the on-site roles to one preset line each', () => {
    expect(workerPresetLine('保安')).toContain('通道');
    expect(workerPresetLine('志愿者')).toContain('帮忙');
    expect(workerPresetLine('管理员')).toContain('场地');
    // 归一化后才比较：包含关系已覆盖，不锁死全部文案措辞。
    expect(workerPresetLine('security')).toBe(workerPresetLine('保安'));
  });

  it('is stable for the same role (no random chatter)', () => {
    expect(workerPresetLine('签到岗')).toBe(workerPresetLine('签到岗'));
    expect(workerPresetLine('签到岗')).toContain('签到');
  });

  it('falls back to a neutral line instead of inventing a story', () => {
    expect(workerPresetLine('临时岗位')).toBe(GENERIC_WORKER_LINE);
    expect(workerPresetLine('')).toBe(GENERIC_WORKER_LINE);
    expect(workerPresetLine(undefined)).toBe(GENERIC_WORKER_LINE);
  });
});
