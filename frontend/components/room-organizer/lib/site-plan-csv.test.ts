import { describe, expect, it } from 'vitest';
import { CSV_EXPORT_HEADERS, buildPlanCsv, csvEscape } from './site-plan-csv';
import { PLAN_NODE_KIND_LABELS } from './site-plan-inventory';
import type { SitePlanData } from '../../../../supabase/functions/_shared/site-plan';

function samplePlan(): SitePlanData {
  return {
    schemaVersion: 1,
    anchor: { lng: 120.1443, lat: 30.2459, crs: 'gcj-02', source: 'picker' },
    boundary: [
      { x: 0, y: 0 },
      { x: 200, y: 0 },
      { x: 200, y: 120 },
      { x: 0, y: 120 },
    ],
    zones: [
      {
        id: 'a1000000-0000-4000-8000-000000000001',
        semantic: 'audience',
        name: '观众区, 东侧',
        polygon: [
          { x: 10, y: 10 },
          { x: 90, y: 10 },
          { x: 90, y: 55 },
          { x: 10, y: 55 },
        ],
        notes: '含逗号的备注',
      },
    ],
    facilities: [
      {
        id: 'b2000000-0000-4000-8000-000000000001',
        templateId: 'booth-2x2',
        name: '摊位 "A"',
        position: { x: 60, y: 80 },
        rotationDeg: 0,
        size: { width: 2, depth: 2 },
        zoneId: 'a1000000-0000-4000-8000-000000000001',
        notes: '',
      },
    ],
    routes: [
      {
        id: 'c3000000-0000-4000-8000-000000000001',
        kind: 'pedestrian',
        name: '入场动线',
        points: [
          { x: 0, y: 60 },
          { x: 55, y: 60 },
        ],
        oneWay: true,
        notes: '',
      },
    ],
    nodes: [
      {
        id: 'd4000000-0000-4000-8000-000000000001',
        kind: 'entry',
        name: '西门',
        // 2026-11-15 用户：「明明出入口已经在动线上了，还是显示未在动线上」。
        // 压在动线上的节点现在算已连接，所以这只“孤立节点”必须真的离开动线，才还是问题行。
        position: { x: 30, y: 100 },
        notes: '',
      },
    ],
    workers: [
      {
        id: 'e5000000-0000-4000-8000-000000000001',
        role: '安保',
        count: 2,
        position: { x: 3, y: 57 },
        zoneId: 'a1000000-0000-4000-8000-000000000001',
        notes: '',
      },
    ],
    measurements: [],
  } as unknown as SitePlanData;
}

/** RFC4180 感知的最小 CSV 解析（测试用）。 */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; }
        else quoted = false;
      } else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\r') { /* 行尾 \r\n */ }
    else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(cells => cells.length > 1 || cells[0] !== '');
}
/** 车辆夹具（2026-11-16 #122）：一台待补模型的大巴 + 一台有模型的商务车。 */
function planWithVehicles(): SitePlanData {
  const plan = samplePlan();
  plan.vehicles = [
    { id: 'aa000000-0000-4000-8000-000000000001', type: 'coach', count: 3, position: { x: 20, y: 100 }, notes: '大巴停车位' },
    { id: 'aa000000-0000-4000-8000-000000000002', type: 'business', count: 2, position: { x: 120, y: 100 }, modelSlug: 'car-park-and-road-vehicle-fleet-saloon-ad831b1f', notes: '' },
  ];
  return plan;
}

describe('csv plan export 车辆行（#122）', () => {
  it('exports vehicle rows with kind 车辆 and a 台数 metric, keeping the 14-field header', () => {
    const csv = buildPlanCsv(planWithVehicles());
    const header = csv.replace(/^\uFEFF/, '').split('\r\n')[0]!;
    expect(header.split(',')).toHaveLength(14);
    expect(header).toBe(CSV_EXPORT_HEADERS.join(','));
    const rows = parseCsv(csv.replace(/^\uFEFF/, ''));
    const vehicleRows = rows.filter(cells => cells[0] === '车辆');
    expect(vehicleRows).toHaveLength(2);
    expect(vehicleRows[0]![1]).toBe('服务大巴车（待补模型）');
    expect(vehicleRows[0]![2]).toBe('车辆');
    expect(vehicleRows[0]![4]).toBe('3 台');
    expect(vehicleRows[0]![5]).toBe('20.00');
    expect(vehicleRows[0]![6]).toBe('100.00');
    expect(vehicleRows[0]![13]).toBe('大巴停车位');
    expect(vehicleRows[1]![1]).toBe('商务车');
    expect(vehicleRows[1]![4]).toBe('2 台');
  });

  it('sorts vehicles after 人员 and before 测量 without touching existing rows', () => {
    const plan = planWithVehicles();
    plan.measurements = [{ id: 'f6000000-0000-4000-8000-000000000001', kind: 'distance', name: '距离 1', points: [{ x: 0, y: 0 }, { x: 10, y: 0 }], notes: '' }];
    const rows = parseCsv(buildPlanCsv(plan).replace(/^\uFEFF/, ''));
    const kinds = rows.slice(1).map(cells => cells[0]);
    expect(kinds).toEqual(['分区', '设施', '动线', '出入口', '人员', '车辆', '车辆', '测量']);
  });

  it('leaves legacy CSV output byte-identical when the plan has no vehicles', () => {
    const legacy = buildPlanCsv(samplePlan());
    // 旧快照（无 vehicles 字段）与显式空数组两份导出字节相同，且不含车辆行。
    expect(buildPlanCsv({ ...samplePlan(), vehicles: [] })).toBe(legacy);
    expect(legacy).not.toContain('车辆');
    expect(legacy.replace(/^\uFEFF/, '').trim().split('\r\n')).toHaveLength(6);
  });
});

describe('csv plan export (H5-a)', () => {
  it('escapes values per RFC 4180', () => {
    expect(csvEscape('plain')).toBe('plain');
    expect(csvEscape('a,b')).toBe('"a,b"');
    expect(csvEscape('say "hi"')).toBe('"say ""hi"""');
    expect(csvEscape('line\nbreak')).toBe('"line\nbreak"');
  });

  it('starts with BOM and the 14-field header', () => {
    const csv = buildPlanCsv(samplePlan());
    expect(csv.charCodeAt(0)).toBe(0xFEFF);
    const lines = csv.replace(/^\uFEFF/, '').split('\r\n');
    expect(lines[0].split(',')).toHaveLength(14);
    expect(lines[0]).toContain('类型');
    expect(lines[0]).toContain('东向 x (m)');
    expect(lines[0]).toContain('问题标记');
  });

  it('exports one row per inventory entity with stable order', () => {
    const csv = buildPlanCsv(samplePlan());
    const lines = csv.replace(/^\uFEFF/, '').trim().split('\r\n');
    expect(lines).toHaveLength(6); // 表头 + 分区/设施/动线/出入口/人员各 1。
    // 顺序：分区 → 设施 → 动线 → 出入口 → 人员。
    expect(lines[1]).toContain('分区');
    expect(lines[2]).toContain('设施');
    expect(lines[3]).toContain('动线');
    expect(lines[4]).toContain('出入口');
    expect(lines[5]).toContain('人员');
  });

  it('is byte-stable across exports of the same plan', () => {
    expect(buildPlanCsv(samplePlan())).toBe(buildPlanCsv(samplePlan()));
  });

  it('escapes commas in zone names and double quotes in facility names', () => {
    const csv = buildPlanCsv(samplePlan());
    expect(csv).toContain('"观众区, 东侧"');
    expect(csv).toContain('"摊位 ""A"""');
  });

  it('carries ENU coordinates and GCJ-02 anchor lng/lat columns', () => {
    const csv = buildPlanCsv(samplePlan());
    // 用 RFC4180 感知解析（zone 名称含逗号，naive split 会错位）。
    const rows = parseCsv(csv.replace(/^\uFEFF/, ''));
    const zoneRow = rows.find(cells => cells[0] === '分区');
    expect(zoneRow).toBeTruthy();
    expect(zoneRow![5]).toBe('50.00'); // 观众区质心 x=50
    expect(zoneRow![6]).toBe('32.50'); // 质心 y=32.5
    expect(zoneRow![11]).toMatch(/^120\.144[0-9]+$/); // 锚点经度
    expect(zoneRow![12]).toMatch(/^30\.246[0-9]+$/); // 锚点纬度
    const facilityRow = rows.find(cells => cells[0] === '设施');
    expect(facilityRow![5]).toBe('60.00');
    expect(facilityRow![3]).toBe('观众区, 东侧'); // 转义往返还原。
  });

  it('exports an issue marker for problem rows only', () => {
    const csv = buildPlanCsv(samplePlan());
    const rows = parseCsv(csv.replace(/^\uFEFF/, ''));
    const zoneRow = rows.find(cells => cells[0] === '分区')!;
    const facilityRow = rows.find(cells => cells[0] === '设施')!;
    const nodeRow = rows.find(cells => cells[0] === '出入口')!;
    // 分区/设施无问题：标记列为空；西门未连动线是真实问题：✓。
    expect(zoneRow[9]).toBe('');
    expect(facilityRow[9]).toBe('');
    expect(nodeRow[9]).toBe('✓');
  });

  it('swaps area/length headers and values to feet while keeping metre coordinates', () => {
    const csv = buildPlanCsv(samplePlan(), 'ft');
    const lines = csv.replace(/^\uFEFF/, '').split('\r\n');
    expect(lines[0]).toContain('面积 (ft²)');
    expect(lines[0]).toContain('长度 (ft)');
    // 坐标是 ENU 米制定位基准，不换算。
    expect(lines[0]).toContain('东向 x (m)');
    const rows = parseCsv(csv.replace(/^\uFEFF/, ''));
    const zoneRow = rows.find(cells => cells[0] === '分区');
    const routeRow = rows.find(cells => cells[0] === '动线');
    expect(zoneRow![7]).toMatch(/ft²$/);
    expect(routeRow![8]).toMatch(/ft$/);
    expect(zoneRow![5]).toBe('50.00');
  });

  it('keeps node kind labels aligned', () => {
    expect(PLAN_NODE_KIND_LABELS.entry).toBe('入口');
    expect(PLAN_NODE_KIND_LABELS.exit).toBe('出口');
    expect(PLAN_NODE_KIND_LABELS.both).toBe('出入口');
    void CSV_EXPORT_HEADERS;
  });
});

describe('csv plan export 测量备注（M3c 补强）', () => {
  it('writes measurement notes into the notes column, keeping 14 fields', () => {
    const plan = samplePlan();
    plan.measurements = [
      { id: 'f6000000-0000-4000-8000-000000000001', kind: 'distance', name: '距离 1', points: [{ x: 0, y: 0 }, { x: 10, y: 0 }], notes: '门到摊位的直线' },
    ];

    const rows = parseCsv(buildPlanCsv(plan).replace(/^\uFEFF/, ''));
    const row = rows.find(cells => cells[0] === '测量')!;

    expect(row).toHaveLength(14);
    expect(row[4]).toContain('10');
    expect(row[13]).toBe('门到摊位的直线');
  });
});
