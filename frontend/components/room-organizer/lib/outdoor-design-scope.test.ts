import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SCOPE_MARGIN_M,
  MAX_SCOPE_MARGIN_M,
  MIN_SCOPE_SIDE_M,
  expandRect,
  nearestScopeEdgePx,
  rectBigEnough,
  rectRing,
  resizeScopeEdge,
  ringToPath,
  scopeAreaM2,
  scopeContainsPoint,
  scopeEdgeIsHorizontal,
  scopeEdgeLabel,
  scopeForAppliedPlan,
  syncScopeForBoundary,
} from './outdoor-design-scope';

/** 10×10 的正方形场地（米），左下角在原点。 */
const square = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 10, y: 10 },
  { x: 0, y: 10 },
];

describe('设计范围：矩形（2026-11-15 用户拍板，只做矩形）', () => {
  it('外扩结果是 4 个角，包住原场地，面积变大', () => {
    const scope = expandRect(square, DEFAULT_SCOPE_MARGIN_M);
    expect(scope).toHaveLength(4);
    expect(scopeAreaM2(scope)).toBeGreaterThan(scopeAreaM2(square));
    for (const corner of square) expect(scopeContainsPoint(scope, corner)).toBe(true);
  });

  it('四条边各离开 margin 米（不是只在四角拉长）', () => {
    const scope = expandRect(square, 20);
    expect(scope[0]).toEqual({ x: -20, y: -20 });
    expect(scope[2]).toEqual({ x: 30, y: 30 });
    expect(scopeContainsPoint(scope, { x: -15, y: 5 })).toBe(true);
    expect(scopeContainsPoint(scope, { x: -25, y: 5 })).toBe(false);
    expect(scopeContainsPoint(scope, { x: 5, y: 35 })).toBe(false);
  });

  it('多边形场地也只给外接矩形：不会跟着顶点长出多段线', () => {
    const lShape = [
      { x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 6 },
      { x: 6, y: 6 }, { x: 6, y: 20 }, { x: 0, y: 20 },
    ];
    const scope = expandRect(lShape, 10);
    expect(scope).toHaveLength(4);
    expect(scope).toEqual([
      { x: -10, y: -10 },
      { x: 30, y: -10 },
      { x: 30, y: 30 },
      { x: -10, y: 30 },
    ]);
  });

  it('外扩 0 米时对矩形场地等于原样，对多边形取外接矩形', () => {
    expect(expandRect(square, 0)).toEqual(square);
    const slanted = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 6 }, { x: 3, y: 9 }];
    expect(expandRect(slanted, 0)).toEqual([
      { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 9 }, { x: 0, y: 9 },
    ]);
  });

  it('超过上限按上限算，避免把整个地图框进来', () => {
    const huge = expandRect(square, 10_000);
    const capped = expandRect(square, MAX_SCOPE_MARGIN_M);
    expect(scopeAreaM2(huge)).toBeCloseTo(scopeAreaM2(capped), 6);
  });

  it('退化边界（少于 3 点）不给框', () => {
    expect(expandRect([{ x: 0, y: 0 }, { x: 5, y: 5 }], 10)).toEqual([]);
  });
});

describe('拖框：对角点 → 矩形四角', () => {
  it('任意两个对角点都归一成同一组四角（顺时针）', () => {
    const expected = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 6 }, { x: 0, y: 6 }];
    expect(rectRing({ x: 0, y: 0 }, { x: 10, y: 6 })).toEqual(expected);
    expect(rectRing({ x: 10, y: 6 }, { x: 0, y: 0 })).toEqual(expected);
    expect(rectRing({ x: 10, y: 0 }, { x: 0, y: 6 })).toEqual(expected);
  });

  it('最短边判定挡掉手抖单击与细条', () => {
    expect(rectBigEnough(rectRing({ x: 0, y: 0 }, { x: 10, y: 6 }))).toBe(true);
    expect(rectBigEnough(rectRing({ x: 0, y: 0 }, { x: 0.5, y: 0.5 }))).toBe(false);
    expect(rectBigEnough(rectRing({ x: 0, y: 0 }, { x: 20, y: 0.5 }))).toBe(false);
    // 点数不是 4（不是矩形）直接不认。
    expect(rectBigEnough([{ x: 0, y: 0 }, { x: 5, y: 5 }, { x: 0, y: 9 }])).toBe(false);
    expect(MIN_SCOPE_SIDE_M).toBeGreaterThan(0);
  });
});

describe('设计范围：面积与命中', () => {
  it('矩形面积按鞋带公式算，顶点顺序无关', () => {
    expect(scopeAreaM2(square)).toBe(100);
    expect(scopeAreaM2([...square].reverse())).toBe(100);
  });

  it('命中测试分得清框内、框外', () => {
    expect(scopeContainsPoint(square, { x: 5, y: 5 })).toBe(true);
    expect(scopeContainsPoint(square, { x: 15, y: 5 })).toBe(false);
    expect(scopeContainsPoint(square, { x: -0.5, y: 5 })).toBe(false);
  });

  it('空环不崩、不算面积', () => {
    expect(scopeAreaM2([])).toBe(0);
    expect(scopeContainsPoint([], { x: 0, y: 0 })).toBe(false);
  });
});

describe('设计范围：拖边只改一个方向（2026-11-15 用户指令）', () => {
  // 10×10 的框（左 0 / 右 10 / 下 0 / 上 10）。
  it('北边只动上边：x 与下边一律不变', () => {
    const next = resizeScopeEdge(square, 'north', 14)!;
    expect(next).toEqual([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 14 }, { x: 0, y: 14 }]);
    // 往回拖也对：只影响上边。
    expect(resizeScopeEdge(square, 'north', 3)!).toEqual([
      { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 3 }, { x: 0, y: 3 },
    ]);
  });

  it('南边只动下边，东边只动右边，西边只动左边', () => {
    expect(resizeScopeEdge(square, 'south', -4)![0]).toEqual({ x: 0, y: -4 });
    expect(resizeScopeEdge(square, 'south', -4)![2]).toEqual({ x: 10, y: 10 });
    expect(resizeScopeEdge(square, 'east', 16)![1]).toEqual({ x: 16, y: 0 });
    expect(resizeScopeEdge(square, 'east', 16)![3]).toEqual({ x: 0, y: 10 });
    expect(resizeScopeEdge(square, 'west', -6)![0]).toEqual({ x: -6, y: 0 });
    expect(resizeScopeEdge(square, 'west', -6)![2]).toEqual({ x: 10, y: 10 });
  });

  it('拖过头就夹住：对边不动，最短边保留（不会拖成反矩形）', () => {
    const crossedNorth = resizeScopeEdge(square, 'north', -50)!;
    expect(crossedNorth[0]).toEqual({ x: 0, y: 0 });
    expect(crossedNorth[2]).toEqual({ x: 10, y: MIN_SCOPE_SIDE_M });
    const crossedWest = resizeScopeEdge(square, 'west', 50)!;
    expect(crossedWest[0]).toEqual({ x: 10 - MIN_SCOPE_SIDE_M, y: 0 });
    expect(rectBigEnough(crossedWest)).toBe(true);
  });

  it('结果永远是轴对齐矩形：面积按新尺寸算', () => {
    const next = resizeScopeEdge(square, 'east', 25)!;
    expect(scopeAreaM2(next)).toBe(250);
  });

  it('不是 4 点的旧数据不给拖边（与 rectBigEnough 同口径）', () => {
    expect(resizeScopeEdge([{ x: 0, y: 0 }, { x: 5, y: 5 }, { x: 0, y: 9 }], 'north', 10)).toBeNull();
    expect(resizeScopeEdge([], 'east', 10)).toBeNull();
  });

  it('边名与方向：北/南是上下（↕），东/西是左右（↔）', () => {    expect([scopeEdgeLabel('north'), scopeEdgeLabel('south'), scopeEdgeLabel('east'), scopeEdgeLabel('west')])
      .toEqual(['北', '南', '东', '西']);
    expect(scopeEdgeIsHorizontal('north')).toBe(true);
    expect(scopeEdgeIsHorizontal('south')).toBe(true);
    expect(scopeEdgeIsHorizontal('east')).toBe(false);
    expect(scopeEdgeIsHorizontal('west')).toBe(false);
  });
});

describe('设计范围：边与角的命中优先级', () => {
  // 像素口径的四角（100,100)-(300,250)，屏幕坐标。
  const corners = [
    { x: 100, y: 100 },
    { x: 300, y: 100 },
    { x: 300, y: 250 },
    { x: 100, y: 250 },
  ];

  it('四条边各自认得：上=北、下=南、左=西、右=东', () => {
    expect(nearestScopeEdgePx(corners, { x: 200, y: 102 })).toBe('north');
    expect(nearestScopeEdgePx(corners, { x: 200, y: 248 })).toBe('south');
    expect(nearestScopeEdgePx(corners, { x: 101, y: 175 })).toBe('west');
    expect(nearestScopeEdgePx(corners, { x: 299, y: 175 })).toBe('east');
  });

  it('离边超过 8 px 不接管（让画布继续平移/选物件）', () => {
    expect(nearestScopeEdgePx(corners, { x: 200, y: 112 })).toBeNull();
    expect(nearestScopeEdgePx(corners, { x: 200, y: 175 })).toBeNull();
    expect(nearestScopeEdgePx(corners, { x: 288, y: 175 })).toBeNull();
  });

  it('角上 12 px 让给角点：否则拉角会变成单向拖', () => {
    expect(nearestScopeEdgePx(corners, { x: 104, y: 104 })).toBeNull();
    expect(nearestScopeEdgePx(corners, { x: 296, y: 246 })).toBeNull();
    // 离开角圈但仍在边的 8 px 带内 → 按边处理。
    expect(nearestScopeEdgePx(corners, { x: 120, y: 102 })).toBe('north');
  });

  it('不在矩形长边延伸段上的点不算命中（不会无限延长边）', () => {
    expect(nearestScopeEdgePx(corners, { x: 400, y: 102 })).toBeNull();
  });

  it('不是 4 点旧数据一律不接管', () => {
    expect(nearestScopeEdgePx([{ x: 0, y: 0 }], { x: 0, y: 0 })).toBeNull();
  });
});

describe('设计范围：路径串（蒙版与描边共用一份）', () => {
  it('闭合路径，坐标保留两位小数', () => {
    const path = ringToPath([{ x: 0.123, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }]);
    expect(path).toBe('M 0.12 0 L 10 0 L 10 10 Z');
  });

  it('空环给空串，调用方据此跳过蒙版', () => {
    expect(ringToPath([])).toBe('');
  });
});

describe('syncScopeForBoundary（2026-11-17 用户拍板：红线拖拽后白框跟不跟）', () => {
  const scope = expandRect(square, DEFAULT_SCOPE_MARGIN_M); // -20..30，兜住默认红线
  it('红线仍在白框内（往里拖/微调）→ 白框不动', () => {
    const inside = [{ x: 2, y: 2 }, { x: 8, y: 2 }, { x: 8, y: 8 }, { x: 2, y: 8 }];
    expect(syncScopeForBoundary(scope, inside, DEFAULT_SCOPE_MARGIN_M)).toBeNull();
  });
  it('红线顶出白框（向外拖）→ 白框重置为新红线外扩', () => {
    const grown = [{ x: -30, y: -30 }, { x: 10, y: -30 }, { x: 10, y: 10 }, { x: -30, y: 10 }];
    expect(syncScopeForBoundary(scope, grown, DEFAULT_SCOPE_MARGIN_M)).toEqual(expandRect(grown, DEFAULT_SCOPE_MARGIN_M));
  });
  it('只有一边顶出也算顶出', () => {
    const up = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 40 }, { x: 0, y: 40 }];
    expect(syncScopeForBoundary(scope, up, DEFAULT_SCOPE_MARGIN_M)).toEqual(expandRect(up, DEFAULT_SCOPE_MARGIN_M));
  });
  it('本来没有白框 → 顺手生成一个', () => {
    expect(syncScopeForBoundary(undefined, square, DEFAULT_SCOPE_MARGIN_M)).toEqual(expandRect(square, DEFAULT_SCOPE_MARGIN_M));
  });
  it('红线不足 3 点 → 不动白框也不生成', () => {
    expect(syncScopeForBoundary(scope, [{ x: 0, y: 0 }], DEFAULT_SCOPE_MARGIN_M)).toBeNull();
  });
});

describe('应用别人送来的方案（Agent 提案）时白框怎么跟', () => {
  const scope = expandRect(square, DEFAULT_SCOPE_MARGIN_M);
  const bigger = [{ x: -40, y: -40 }, { x: 90, y: -40 }, { x: 90, y: 80 }, { x: -40, y: 80 }];

  it('来件自己带了白框 → 听它的，不覆盖', () => {
    expect(scopeForAppliedPlan({ currentBoundary: square, nextBoundary: bigger, nextScope: scope })).toBeNull();
  });

  it('红线没变（同样是那四个顶点）→ 保留现场那只框（可能是用户拖过的）', () => {
    expect(scopeForAppliedPlan({
      currentBoundary: square,
      nextBoundary: square.map(p => ({ ...p })),
      nextScope: undefined,
    })).toBeNull();
  });

  it('换了红线却没带框 → 按新红线外扩默认 20 m', () => {
    expect(scopeForAppliedPlan({ currentBoundary: square, nextBoundary: bigger, nextScope: undefined }))
      .toEqual(expandRect(bigger, DEFAULT_SCOPE_MARGIN_M));
  });

  it('exchange 红线为空数组（清场）→ 不凭空造框', () => {
    expect(scopeForAppliedPlan({ currentBoundary: square, nextBoundary: [], nextScope: undefined })).toBeNull();
  });

  it('margin 可指定，用于以后改口径', () => {
    expect(scopeForAppliedPlan({ currentBoundary: square, nextBoundary: bigger, nextScope: undefined, marginM: 5 }))
      .toEqual(expandRect(bigger, 5));
  });
});
