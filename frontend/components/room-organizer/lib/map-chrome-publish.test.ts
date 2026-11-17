import { expect, it, vi } from 'vitest';
import { assignIfChanged, scaleChromeReadout } from './map-chrome-publish';

it('keeps the existing scale ticks and labels', () => {
  expect(scaleChromeReadout(0.5)).toEqual({ width: '100px', text: '50 m' });
  expect(scaleChromeReadout(20)).toEqual({ width: '100px', text: '2 km' });
  expect(scaleChromeReadout(0.01)).toEqual({ width: '100px', text: '1 m' });
  expect(scaleChromeReadout(100)).toEqual({ width: '80px', text: '8 km' });
});

it('does not assign when the chrome string is unchanged', () => {
  const assign = vi.fn();
  expect(assignIfChanged('50 m', '50 m', assign)).toBe('50 m');
  expect(assign).not.toHaveBeenCalled();
  expect(assignIfChanged('50 m', '100 m', assign)).toBe('100 m');
  expect(assign).toHaveBeenCalledTimes(1);
  expect(assign).toHaveBeenCalledWith('100 m');
  expect(assignIfChanged(null, '24px', assign)).toBe('24px');
  expect(assign).toHaveBeenCalledTimes(2);
});
