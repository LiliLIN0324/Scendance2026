import { describe, expect, it } from 'vitest';
import {
  averageHashFromGray,
  averageHashFromGrid,
  duplicateIdsFor,
  findDuplicateFrames,
  hashesDifferEnough,
  lumaStatsFromGray,
  lumaStatsFromRgba,
} from './image-analysis';

function rgbaFor(luma: number, placement: 'all' | 'topHalfBright' = 'all'): number[] {
  const pixels: number[] = [];
  for (let index = 0; index < 4 * 64; index += 4) {
    const isBright = placement === 'topHalfBright' && index < 128;
    const value = isBright ? 255 : luma;
    pixels.push(value, value, value, 255);
  }
  return pixels;
}

describe('lumaStatsFromRgba', () => {
  it('全黑帧判成过暗', () => {
    const stats = lumaStatsFromRgba(rgbaFor(8));
    expect(stats.mean).toBeLessThan(45);
    expect(stats.darkRatio).toBe(1);
  });

  it('正常曝光帧落在健康区间', () => {
    const stats = lumaStatsFromRgba(rgbaFor(128));
    expect(stats.mean).toBeGreaterThan(45);
    expect(stats.mean).toBeLessThan(210);
    expect(stats.brightRatio).toBe(0);
    expect(stats.darkRatio).toBe(0);
  });

  it('大面积高光帧被标记为过曝', () => {
    const stats = lumaStatsFromRgba(rgbaFor(20, 'topHalfBright'));
    expect(stats.brightRatio).toBeGreaterThan(0.12);
  });
});

describe('averageHashFromGray', () => {
  it('均匀灰度与半明半暗的哈希稳定且不同', () => {
    const flat = averageHashFromGray(new Array<number>(64).fill(100));
    const split = averageHashFromGray(
      Array.from({ length: 64 }, (_, index) => (index < 32 ? 20 : 220)),
    );
    expect(flat).toHaveLength(16);
    expect(split).toHaveLength(16);
    expect(flat).toBe('0000000000000000');
    expect(split).not.toBe(flat);
    expect(hashesDifferEnough(flat, split)).toBe(true);
  });

  it('灰度不足 64 个时返回安全占位', () => {
    expect(averageHashFromGray([1, 2, 3])).toBe('0000000000000000');
  });
});

describe('lumaStatsFromGray', () => {
  it('64×64 健康灰度帧判为正常曝光', () => {
    const gray = new Array<number>(64 * 64).fill(128);
    const stats = lumaStatsFromGray(gray);
    expect(stats.mean).toBe(128);
    expect(stats.brightRatio).toBe(0);
    expect(stats.darkRatio).toBe(0);
  });
});

describe('averageHashFromGrid', () => {
  const grid = (seed: number): number[] => {
    const gray: number[] = [];
    for (let y = 0; y < 64; y += 1) {
      for (let x = 0; x < 64; x += 1) {
        const cell = Math.floor(y / 8) * 8 + Math.floor(x / 8);
        gray.push((cell * seed) % 200);
      }
    }
    return gray;
  };

  it('不同 64×64 纹理不会被压成同一个哈希', () => {
    const left = averageHashFromGrid(grid(7));
    const right = averageHashFromGrid(grid(31));
    expect(left).toHaveLength(16);
    expect(right).toHaveLength(16);
    expect(left).not.toBe(right);
    expect(hashesDifferEnough(left, right)).toBe(true);
  });

  it('灰度不足 64×64 时返回安全占位', () => {
    expect(averageHashFromGrid([1, 2, 3])).toBe('0000000000000000');
  });
});

describe('重复帧判定', () => {
  it('相同哈希只把后一张标为重复', () => {
    expect(findDuplicateFrames(['ffffffffffffffff', 'ffffffffffffffff', '0000000000000000'])).toEqual([1]);
  });

  it('距离很远的哈希不算重复', () => {
    expect(findDuplicateFrames(['ffffffffffffffff', '0000000000000000'])).toEqual([]);
  });

  it('重复帧集合带上业务 id', () => {
    const ids = duplicateIdsFor([
      { id: 'a', hash: 'ffffffffffffffff' },
      { id: 'b', hash: 'ffffffffffffffff' },
      { id: 'c', hash: '0000000000000000' },
    ]);
    expect([...ids]).toEqual(['b']);
  });
});
