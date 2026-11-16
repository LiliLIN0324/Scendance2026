import { describe, expect, it } from 'vitest';
import { metersFromForwardBox } from './splat-meters';

describe('splat-meters（forwardBox → 布置场地宽深高）', () => {
  it('合法三轴跨度换算成宽深高，保留一位小数', () => {
    const result = metersFromForwardBox({ min: [0, 0, 0], max: [10, 6, 3] });
    expect(result).toEqual({ width: 10, depth: 6, height: 3 });
  });

  it('非对象 / 缺 min 或 max / 不是数组时回落 null', () => {
    expect(metersFromForwardBox(null)).toBeNull();
    expect(metersFromForwardBox('box')).toBeNull();
    expect(metersFromForwardBox({ min: [0, 0, 0] })).toBeNull();
    expect(metersFromForwardBox({ min: 'x', max: [1, 1, 1] })).toBeNull();
  });

  it('某维非有限数回落 null', () => {
    expect(metersFromForwardBox({ min: [0, 0, 0], max: [Number.NaN, 6, 3] })).toBeNull();
    expect(metersFromForwardBox({ min: [0, 0, 0], max: [10, Number.POSITIVE_INFINITY, 3] })).toBeNull();
  });

  it('跨度小于 0.5 m 或大于 120 m（坏档）回落 null', () => {
    expect(metersFromForwardBox({ min: [0, 0, 0], max: [0.2, 6, 3] })).toBeNull();
    expect(metersFromForwardBox({ min: [0, 0, 0], max: [300, 6, 3] })).toBeNull();
  });

  it('轴向上跨度按绝对值取，负向 max 也能算', () => {
    const result = metersFromForwardBox({ min: [10, 6, 3], max: [0, 0, 0] });
    expect(result).toEqual({ width: 10, depth: 6, height: 3 });
  });
});
