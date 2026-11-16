import { describe, expect, it } from 'vitest';
import { loginBlockedPlaceholder, loginResumeCaption, loginResumeHeadline } from './outdoor-login-copy';

describe('登录卡文案（范围已确认后不再说「选址」）', () => {
  it('范围没确认时仍然说选址', () => {
    const input = { loginSatisfied: false, rangeConfirmed: false };
    expect(loginResumeHeadline(input)).toBe('登录后继续这次选址');
    expect(loginResumeCaption(input)).toBe('场地草稿已保存；登录只影响写入项目，不改动当前范围。');
    expect(loginBlockedPlaceholder({ rangeConfirmed: false })).toBe('登录后继续这次选址');
  });

  it('范围确认后改说设计，并把「已确认范围」写进正文', () => {
    const input = { loginSatisfied: false, rangeConfirmed: true };
    expect(loginResumeHeadline(input)).toBe('登录后继续这次设计');
    expect(loginResumeCaption(input)).toContain('已确认范围');
    expect(loginResumeCaption(input)).not.toContain('不改动当前范围');
    expect(loginBlockedPlaceholder({ rangeConfirmed: true })).toBe('登录后继续这次设计');
  });

  it('已登录时两处都不再提登录', () => {
    const input = { loginSatisfied: true, rangeConfirmed: false };
    expect(loginResumeHeadline(input)).toBe('已登录 · 可以继续');
    expect(loginResumeCaption(input)).toContain('写入项目');
    expect(loginResumeHeadline({ loginSatisfied: true, rangeConfirmed: true })).toBe('已登录 · 可以继续');
  });

  it('文案里不自造问句，避免让用户以为要重新回答', () => {
    for (const rangeConfirmed of [true, false]) {
      const input = { loginSatisfied: false, rangeConfirmed };
      expect(loginResumeHeadline(input)).not.toMatch(/[？?]/);
      expect(loginResumeCaption(input)).not.toMatch(/[？?]/);
      expect(loginBlockedPlaceholder({ rangeConfirmed })).not.toMatch(/[？?]/);
    }
  });
});
