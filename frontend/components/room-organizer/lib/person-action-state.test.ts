import { describe, expect, it } from 'vitest';
import {
  isLoopAction,
  isOneShotAction,
  personActionHasClip,
  resolvePersonAction,
} from './person-action-state';

const clips = (overrides: Partial<Record<'idle' | 'talk' | 'walk' | 'sit', unknown>>) => overrides;

describe('resolvePersonAction（动作缺片段回退 idle）', () => {
  it('各动作都有片段时解析到自身', () => {
    const all = clips({ idle: {}, talk: {}, walk: {}, sit: {} });
    expect(resolvePersonAction('idle', all)).toBe('idle');
    expect(resolvePersonAction('talk', all)).toBe('talk');
    expect(resolvePersonAction('walk', all)).toBe('walk');
    expect(resolvePersonAction('sit', all)).toBe('sit');
  });

  it('请求坐姿但无 sit 片段时回退 idle', () => {
    const standingOnly = clips({ idle: {}, walk: {} });
    expect(resolvePersonAction('sit', standingOnly)).toBe('idle');
    expect(personActionHasClip('sit', standingOnly)).toBe(false);
  });

  it('交谈片段缺失时回退 idle，不播空动作', () => {
    const idleOnly = clips({ idle: {} });
    expect(resolvePersonAction('talk', idleOnly)).toBe('idle');
  });

  it('idle 也缺失时返回 null（保持当前姿态，不切低模）', () => {
    const empty = clips({});
    expect(resolvePersonAction('sit', empty)).toBeNull();
    expect(resolvePersonAction('walk', empty)).toBeNull();
  });

  it('一次性动作预留位无片段时同样回退', () => {
    const idleOnly = clips({ idle: {} });
    expect(resolvePersonAction('wave', idleOnly)).toBe('idle');
    expect(resolvePersonAction('emote', idleOnly)).toBe('idle');
  });
});

describe('动作分类', () => {
  it('循环态与一次性动作分组正确', () => {
    for (const action of ['idle', 'talk', 'walk', 'sit'] as const) {
      expect(isLoopAction(action)).toBe(true);
      expect(isOneShotAction(action)).toBe(false);
    }
    for (const action of ['wave', 'emote'] as const) {
      expect(isOneShotAction(action)).toBe(true);
      expect(isLoopAction(action)).toBe(false);
    }
  });
});
