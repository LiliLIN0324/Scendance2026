import { describe, expect, it } from 'vitest';
import { parseCheckinQuantity } from './material-checkin-ui';

describe('human-entered countable material quantities', () => {
  it('keeps unknown distinct from an explicitly recorded zero', () => {
    expect(parseCheckinQuantity('')).toBeNull();expect(parseCheckinQuantity('  ')).toBeNull();
    expect(parseCheckinQuantity('0')).toBe(0);expect(parseCheckinQuantity('000')).toBe(0);
  });
  it('reads exact integer quantities without taking them from titles or model counts', () => {
    expect(parseCheckinQuantity(' 18 ')).toBe(18);expect(parseCheckinQuantity('00020')).toBe(20);
    expect(parseCheckinQuantity(String(Number.MAX_SAFE_INTEGER))).toBe(Number.MAX_SAFE_INTEGER);
  });
  it.each(['-1','+1','1.5','1e3','1,000','租20','NaN','Infinity'])('rejects unsupported quantity input %s', input => {
    expect(()=>parseCheckinQuantity(input)).toThrow('整数');
  });
  it('rejects an integer that cannot be represented safely', () => {
    expect(()=>parseCheckinQuantity('9007199254740992')).toThrow('安全');
  });
});
