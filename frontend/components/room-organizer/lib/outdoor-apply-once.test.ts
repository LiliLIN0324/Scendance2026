import { describe, expect, it } from 'vitest';
import { ApplyOnce, applyTicketKey } from './outdoor-apply-once';

describe('ApplyOnce（一版预览只落一次）', () => {
  it('第一次放行，同一张票第二次不再放行', () => {
    const once = new ApplyOnce();
    expect(once.take('e1::v1')).toBe(true);
    expect(once.take('e1::v1')).toBe(false);
    expect(once.size).toBe(1);
  });

  it('换一版预览（另一个 key）仍然放行', () => {
    const once = new ApplyOnce();
    expect(once.take('e1::v1')).toBe(true);
    expect(once.take('e1::v2')).toBe(true);
    expect(once.take('e2::v1')).toBe(true);
  });

  it('票号不完整时一律不放行，不拿空 key 当一次写入', () => {
    const once = new ApplyOnce();
    expect(once.take(null)).toBe(false);
    expect(once.take('')).toBe(false);
    expect(once.size).toBe(0);
  });

  it('撤销/回退后可以重新投同一张票', () => {
    const once = new ApplyOnce();
    expect(once.take('e1::v1')).toBe(true);
    once.release('e1::v1');
    expect(once.take('e1::v1')).toBe(true);
  });

  it('长时间会话不会无界增长，只留最近若干张', () => {
    const once = new ApplyOnce();
    for (let i = 0; i < 100; i += 1) once.take(`e::v${i}`, 8);
    expect(once.size).toBeLessThanOrEqual(9);
  });

  it('票号由任务 epoch 与基准版本组成，缺一不可', () => {
    expect(applyTicketKey('e1', 'v1')).toBe('e1::v1');
    expect(applyTicketKey(null, 'v1')).toBeNull();
    expect(applyTicketKey('e1', '')).toBeNull();
  });
});
