import { describe, expect, it } from 'vitest';
import { SCOPE_FROST_BLUR_PX, scopeFrostClipPath } from './outdoor-scope-frost';

/** 从 `polygon(...)` 里取出内圈（外圈固定 4 个点在前）并算有向面积。 */
function holeArea(clip: string): number {
  const pairs = [...clip.matchAll(/(-?[\d.]+)% (-?[\d.]+)%/g)].map(match => ({ x: Number(match[1]), y: Number(match[2]) }));
  const hole = pairs.slice(4);
  let area = 0;
  for (let index = 0; index < hole.length; index += 1) {
    const current = hole[index]!;
    const next = hole[(index + 1) % hole.length]!;
    area += current.x * next.y - next.x * current.y;
  }
  return area / 2;
}

describe('3D 框外毛玻璃：设计范围投影 → clip-path 挖洞', () => {
  it('模糊当量与 2D 的 blur(7px) 同档', () => {
    expect(SCOPE_FROST_BLUR_PX).toBe(7);
  });

  it('外圈是整屏，内圈挖空（屏幕系里内圈必须与外圈反向）', () => {
    // 顺时针（屏幕 y 向下）的一圈：左上 → 右上 → 右下 → 左下。
    const clip = scopeFrostClipPath([
      { x: 30, y: 30 },
      { x: 70, y: 30 },
      { x: 70, y: 70 },
      { x: 30, y: 70 },
    ]);
    expect(clip).toBeTruthy();
    expect(clip!).toMatch(/^polygon\(0% 0%, 100% 0%, 100% 100%, 0% 100%, /);
    expect(clip!).toContain('30% 30%');
    expect(clip!).toContain('70% 70%');
    // 非零环绕：外圈面积为正，洞必须为负，否则中间那块会被一起糊掉。
    expect(holeArea(clip!)).toBeLessThan(0);
  });

  it('绕向反过来也照样挖洞（投影会按镜头方向翻面，不赌数据怎么写）', () => {
    const clip = scopeFrostClipPath([
      { x: 30, y: 70 },
      { x: 70, y: 70 },
      { x: 70, y: 30 },
      { x: 30, y: 30 },
    ]);
    expect(holeArea(clip!)).toBeLessThan(0);
  });

  it('框内退缩成一点 / 非有限值一律不画，宁可没有也不糊框内', () => {
    expect(scopeFrostClipPath([])).toBeNull();
    expect(scopeFrostClipPath([{ x: 50, y: 50 }, { x: 50, y: 50 }])).toBeNull();
    expect(scopeFrostClipPath([
      { x: 50, y: 50 },
      { x: 50, y: 50 },
      { x: 50, y: 50 },
    ])).toBeNull();
    expect(scopeFrostClipPath([
      { x: 10, y: 10 },
      { x: Number.NaN, y: 10 },
      { x: 30, y: 30 },
    ])).toBeNull();
  });

  it('镜头拉近时顶点冲出视口也不报错：夹到 ±160% 再交给 clip-path', () => {
    const clip = scopeFrostClipPath([
      { x: -400, y: -20 },
      { x: 500, y: -20 },
      { x: 500, y: 300 },
      { x: -400, y: 300 },
    ]);
    expect(clip).toBeTruthy();
    expect(clip!).toContain('-160% -20%');
    expect(clip!).toContain('160% 160%');
    expect(clip!).not.toContain('500%');
  });
});
