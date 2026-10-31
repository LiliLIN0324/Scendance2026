import { describe, expect, it } from 'vitest';
import { makeFloor, makeItem, makeLayout } from './__testfixtures__/fixtures';
import { proposeReviewFix, reviewLayout, type ReviewIssue } from './layout-review';
import type { FurnitureItem, RoomLayout } from './types';

function layoutWith(items: FurnitureItem[], extra: Partial<RoomLayout> = {}): RoomLayout {
  return makeLayout({ floors: [makeFloor({ items })], ...extra });
}

function chair(id: string, x: number, z: number, overrides: Partial<FurnitureItem> = {}): FurnitureItem {
  return makeItem({ id, type: 'chair', name: '椅子', width: 0.5, depth: 0.5, position: { x, z }, ...overrides });
}

function table(id: string, x: number, z: number, overrides: Partial<FurnitureItem> = {}): FurnitureItem {
  return makeItem({ id, type: 'table', name: '餐桌', width: 1.2, depth: 0.8, position: { x, z }, ...overrides });
}

/** 1.8 × 0.9 的餐桌：两条长边各放得下 3 把椅子，是现场最常见的六人桌。 */
function diningTable(id: string, x: number, z: number, overrides: Partial<FurnitureItem> = {}): FurnitureItem {
  return makeItem({ id, type: 'dining-table', name: '餐桌', width: 1.8, depth: 0.9, position: { x, z }, ...overrides });
}

function seatIssue(layout: RoomLayout): ReviewIssue {
  const issue = reviewLayout(layout).issues.find(candidate => candidate.kind === 'seat-clearance');
  expect(issue).toBeTruthy();
  return issue!;
}

describe('reviewLayout', () => {
  it('reports a clean layout without inventing an entrance', () => {
    const layout = layoutWith([chair('a', -1.5, 0), chair('b', 1.5, 0)]);
    const report = reviewLayout(layout);
    expect(report.clean).toBe(true);
    expect(report.issues).toEqual([]);
    expect(report.checked).toBe(2);
    expect(report.entranceKnown).toBe(false);
    expect(report.notes).toContain('这张场地没有可识别的入口或门，入口通道我不猜。');
  });

  it('drops the not-guessed note once the venue has an entrance', () => {
    const report = reviewLayout(layoutWith([chair('a', 0, 0)], { entrance: { width: 1.4, depth: 1.2 } }));
    expect(report.entranceKnown).toBe(true);
    expect(report.notes.join('')).not.toContain('入口通道我不猜');
  });

  it('groups an overlapping pile into one issue with one fix', () => {
    const layout = layoutWith([
      chair('a', 0, 0),
      chair('b', 0.2, 0),
      chair('c', 0.4, 0.1),
    ]);
    const report = reviewLayout(layout);
    const overlaps = report.issues.filter(issue => issue.kind === 'overlap');
    expect(overlaps).toHaveLength(1);
    expect(overlaps[0]!.itemIds).toHaveLength(3);
    expect(overlaps[0]!.fix?.kind).toBe('separate');
  });

  it('reports a column conflict and out-of-bounds separately', () => {
    const layout = layoutWith([
      makeItem({ id: 'out', type: 'chair', name: '出界椅', width: 1, depth: 1, position: { x: 3.9, z: 0 } }),
      makeItem({ id: 'column', type: 'column', name: '柱子', structuralColumnId: 'column-1', width: 0.6, depth: 0.6, position: { x: 3.4, z: 0 } }),
      makeItem({ id: 'desk', type: 'desk', name: '长桌', width: 1.2, depth: 0.6, position: { x: 3.3, z: 0 } }),
    ]);
    const report = reviewLayout(layout);
    expect(report.issues.some(issue => issue.kind === 'bounds' && issue.itemIds.includes('out'))).toBe(true);
    expect(report.issues.some(issue => issue.kind === 'structure' && issue.itemIds.includes('desk'))).toBe(true);
    expect(report.issues.some(issue => issue.kind === 'structure' && issue.itemIds.includes('column'))).toBe(false);
  });

  it.each([
    ['east', 3.35, 0, 2.5, 0, 'x', -1],
    ['west', -3.35, 0, -2.5, 0, 'x', 1],
    ['south', 0, 3.35, 0, 2.5, 'z', -1],
    ['north', 0, -3.35, 0, -2.5, 'z', 1],
  ] as const)('flags a %s-side chair with no pull-out space', (_side, seatX, seatZ, tableX, tableZ, axis, direction) => {
    const seat = chair('seat', seatX, seatZ);
    const layout = layoutWith([table('table', tableX, tableZ), seat]);
    const issue = seatIssue(layout);
    expect(issue.title).toContain('椅子');
    expect(issue.detail).toContain('0.40 m');

    const result = proposeReviewFix(layout, 0, issue);
    expect(result).toBeTruthy();
    expect(result!.moved).toBe(2);
    const fixedSeat = result!.layout.floors[0]!.items.find(item => item.id === 'seat')!;
    expect(Math.sign(fixedSeat.position![axis] - seat.position![axis])).toBe(direction);
    expect(result!.remaining.some(candidate => candidate.kind === 'seat-clearance')).toBe(false);
    expect(result!.skipped).toEqual([]);
  });

  it('leaves a locked chair alone and says why', () => {
    const seat = chair('seat', 3.35, 0, { locked: true });
    const layout = layoutWith([table('table', 2.5, 0), seat]);
    const issue = seatIssue(layout);
    const result = proposeReviewFix(layout, 0, issue);
    expect(result).toBeTruthy();
    expect(result!.moved).toBe(0);
    expect(result!.layout).toBe(layout);
    expect(result!.skipped).toEqual([{ name: '椅子', reason: 'locked' }]);
    expect(result!.remaining.some(candidate => candidate.kind === 'seat-clearance')).toBe(true);
  });

  it('widens a narrow table passage and verifies the real gap', () => {
    const layout = layoutWith([table('a', -0.85, 0), table('b', 0.85, 0)]);
    const report = reviewLayout(layout);
    const issue = report.issues.find(candidate => candidate.kind === 'table-gap');
    expect(issue).toBeTruthy();
    expect(issue!.detail).toContain('0.50 m');

    const result = proposeReviewFix(layout, 0, issue!);
    expect(result).toBeTruthy();
    expect(result!.moved).toBeGreaterThan(0);
    expect(result!.remaining.some(candidate => candidate.kind === 'table-gap')).toBe(false);
  });

  it('does not mutate the layout it was given', () => {
    const layout = layoutWith([table('table', 2.5, 0), chair('seat', 3.35, 0)]);
    const before = JSON.stringify(layout);
    const issue = seatIssue(layout);
    proposeReviewFix(layout, 0, issue);
    expect(JSON.stringify(layout)).toBe(before);
  });

  it('never claims a compliance verdict', () => {
    const layout = layoutWith([
      chair('a', 0, 0),
      chair('b', 0.2, 0),
      table('table', 2.5, 0),
      chair('seat', 3.35, 0),
      makeItem({ id: 'out', type: 'chair', name: '出界椅', width: 1, depth: 1, position: { x: 3.9, z: 2 } }),
    ]);
    const report = reviewLayout(layout);
    const text = JSON.stringify(report);
    expect(text).not.toMatch(/合规|消防|疏散|无障碍/);
    for (const issue of report.issues) {
      const fixed = proposeReviewFix(layout, 0, issue);
      if (fixed) expect(JSON.stringify(fixed.skipped)).not.toMatch(/合规|消防|疏散|无障碍/);
    }
  });
});

describe('桌椅配套', () => {
  it('flags a chair left far from every table and reports the measured gap', () => {
    const layout = layoutWith([
      table('main', 0, 0),
      chair('north', 0, 0.85),
      chair('south', 0, -0.85),
      chair('stray', 3.5, 3.5),
    ]);
    const report = reviewLayout(layout);
    const issue = report.issues.find(candidate => candidate.kind === 'orphan-seat');
    expect(issue).toBeTruthy();
    expect(issue!.itemIds).toEqual(['stray']);
    expect(issue!.title).toContain('椅子');
    // 净距是画布上的实测值，不是「看起来宽敞」这种主观话。
    expect(issue!.detail).toContain('2.85');
    expect(issue!.detail).toContain('1.80');
    expect(issue!.fix).toBeNull();
    expect(report.issues.some(candidate => candidate.kind === 'unpaired-table')).toBe(false);
    // 证据类问题不给改法：挪椅子去凑桌是改人的摆法，不冒充成候选。
    expect(proposeReviewFix(layout, 0, issue!)).toBeNull();
  });

  it('does not flag a normally paired table set, desk or lone bench', () => {
    const layout = layoutWith([
      diningTable('big', 0, 0),
      chair('n1', -0.55, 0.75), chair('n2', 0, 0.75), chair('n3', 0.55, 0.75),
      chair('s1', -0.55, -0.75), chair('s2', 0, -0.75), chair('s3', 0.55, -0.75),
      makeItem({ id: 'desk', type: 'desk', name: '工作桌', width: 1.2, depth: 0.6, position: { x: -3, z: 2 } }),
      chair('desk-chair', -3, 2.6),
      makeItem({ id: 'bench', type: 'bench', name: '长凳', width: 1.5, depth: 0.5, position: { x: 3, z: 3 } }),
    ]);
    const report = reviewLayout(layout);
    expect(report.issues.filter(candidate => candidate.kind === 'orphan-seat' || candidate.kind === 'unpaired-table')).toEqual([]);
    expect(report.clean).toBe(true);
  });

  it('counts a bench at a picnic table as seating, not as an empty table', () => {
    const layout = layoutWith([
      makeItem({ id: 'picnic', type: 'picnic-table', name: '野餐桌', width: 1.8, depth: 0.8, position: { x: 0, z: 0 } }),
      makeItem({ id: 'bench', type: 'bench', name: '长凳', width: 1.6, depth: 0.4, position: { x: 0, z: 0.75 } }),
    ]);
    const report = reviewLayout(layout);
    expect(report.issues.filter(candidate => candidate.kind === 'orphan-seat' || candidate.kind === 'unpaired-table')).toEqual([]);
  });

  it('flags a table with no seating while the rest of the set is seated', () => {
    const layout = layoutWith([
      table('seated', -2, 0),
      chair('seat', -2, 0.75),
      table('empty', 2, 0),
    ]);
    const report = reviewLayout(layout);
    const issue = report.issues.find(candidate => candidate.kind === 'unpaired-table');
    expect(issue).toBeTruthy();
    expect(issue!.itemIds).toEqual(['empty']);
    expect(issue!.title).toContain('桌');
    expect(issue!.detail).toContain('没有找到座位');
    expect(issue!.fix).toBeNull();
    expect(report.issues.some(candidate => candidate.kind === 'orphan-seat')).toBe(false);
    expect(proposeReviewFix(layout, 0, issue!)).toBeNull();
  });

  it('flags a long table whose measured seat count is far under its long-edge capacity', () => {
    const layout = layoutWith([
      diningTable('banquet', 0, 0, { width: 3, depth: 1 }),
      chair('c1', -0.4, 1),
      chair('c2', 0.4, 1),
    ]);
    const report = reviewLayout(layout);
    const issue = report.issues.find(candidate => candidate.kind === 'unpaired-table');
    expect(issue).toBeTruthy();
    expect(issue!.itemIds).toEqual(['banquet']);
    // 3 m 长的桌子两条长边按 0.75 m/座估 8 座，桌边只量到 2 个座位。
    expect(issue!.detail).toContain('8');
    expect(issue!.detail).toContain('2 个');
    expect(issue!.detail).toContain('0.75');
    expect(issue!.fix).toBeNull();
    expect(report.issues.some(candidate => candidate.kind === 'orphan-seat')).toBe(false);
  });

  it('stays quiet when chairs and tables are not grouped yet', () => {
    const layout = layoutWith([
      table('t1', -2, 0), table('t2', 2, 0),
      chair('c1', -3.5, 3.5), chair('c2', 3.5, -3.5),
    ]);
    const kinds = reviewLayout(layout).issues.map(candidate => candidate.kind);
    expect(kinds).not.toContain('orphan-seat');
    expect(kinds).not.toContain('unpaired-table');
  });
});

describe('proposeReviewFix', () => {
  it('moves out-of-bounds furniture back inside the venue', () => {
    const item = makeItem({ id: 'out', type: 'chair', name: '出界椅', width: 1, depth: 1, position: { x: 3.9, z: 0 } });
    const layout = layoutWith([item]);
    const issue = reviewLayout(layout).issues.find(candidate => candidate.kind === 'bounds')!;
    const result = proposeReviewFix(layout, 0, issue);
    expect(result).toBeTruthy();
    expect(result!.moved).toBe(1);
    const fixed = result!.layout.floors[0]!.items[0]!;
    expect(fixed.position!.x + fixed.width / 2).toBeLessThanOrEqual(4);
    expect(result!.remaining.some(candidate => candidate.kind === 'bounds')).toBe(false);
  });

  it('separates overlapping furniture', () => {
    const layout = layoutWith([chair('a', 0, 0), chair('b', 0.2, 0)]);
    const issue = reviewLayout(layout).issues.find(candidate => candidate.kind === 'overlap')!;
    const result = proposeReviewFix(layout, 0, issue);
    expect(result).toBeTruthy();
    expect(result!.moved).toBe(1);
    expect(result!.remaining.some(candidate => candidate.kind === 'overlap')).toBe(false);
  });

  it('returns null for a stale issue with no matching furniture', () => {
    const layout = layoutWith([chair('a', 0, 0)]);
    const stale: ReviewIssue = {
      id: 'stale', kind: 'overlap', title: '旧问题', detail: '', itemIds: ['missing'],
      fix: { label: '挪开', kind: 'separate', itemIds: ['missing'] },
    };
    expect(proposeReviewFix(layout, 0, stale)).toBeNull();
  });
});
