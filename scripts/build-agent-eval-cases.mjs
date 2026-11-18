import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

/**
 * 生成 data/agent-corpus/cases/eval-cases.json（2026-11-18）。
 *
 * 输入：data/agent-corpus/cases/cases.json（43 案 + 3 事故）
 * 输出：26 条评测样本
 *  - 10 条 layout：来自推荐案例，prompt 只给客观场地线索（类型/区域/跨度/用途），
 *    **不给分区与件数**；期望值是平台读数 ±容差，作为参考带而不是标准答案。
 *  - 16 条 failure：这里的主体是「单点故障」样本——先搭一个对 11 条已实现判据全部合规的
 *    基准布局，再每次只改一处，让恰好一条（个别是天然联动两条）判据报违规。
 *    另有 1 条对照样本（不改），要求执行器一条违规都不报——用来抓误报。
 *    3 条事故样本保留为多故障样本。
 *
 * 为什么用「基准 + 变异」而不是手写 16 份布局：手写容易让夹具与执行器脱节，
 * 变异点写在一个函数表里，改判据或改夹具时差异一眼可见；测试还会校验
 * 每条样本跑出来的违规集合与期望**完全相等**。
 */

const root = process.cwd();
const casesPath = path.join(root, 'data', 'agent-corpus', 'cases', 'cases.json');
const templatesPath = path.join(root, 'data', 'agent-corpus', 'event-templates.json');
const outPath = path.join(root, 'data', 'agent-corpus', 'cases', 'eval-cases.json');

const cases = JSON.parse(readFileSync(casesPath, 'utf8'));
const templates = JSON.parse(readFileSync(templatesPath, 'utf8')).templates;
const templateIds = new Set(templates.map((item) => item.id));

/** 容差：分区按条、件数按比例、动线与入口按条。宁可宽一点，也不要逼模型背读数。 */
const TOLERANCE = { zones: 2, objects: 0.25, routes: 1, entrances: 1 };

function band(value, delta, floor = 0) {
  const min = Math.max(floor, Math.round(value - delta));
  const max = Math.round(value + delta);
  return { min, max };
}

const PROMPT_BY_TYPE = {
  Festivals: (item, span) =>
    `${item.name}（${item.region}）为节庆型活动，场地约 ${span.width}×${span.height} 米，${item.useCase}。请给出分区划分、摊位与设施件数、动线组织、出入口设置。`,
  'Road Events': (item, span) =>
    `${item.name}（${item.region}）为路跑/封路型活动，覆盖范围约 ${span.width}×${span.height} 米，${item.useCase}。请给出起终点与管控点、动线组织、出入口设置。`,
  'Local Governments': (item, span) =>
    `${item.name}（${item.region}）为社区型公共活动，场地约 ${span.width}×${span.height} 米，${item.useCase}。请给出分区划分、摊位与设施件数、动线与出入口。`,
  Venues: (item, span) =>
    `${item.name}（${item.region}）为场馆型活动，场地约 ${span.width}×${span.height} 米，${item.useCase}。请给出分区划分、设施件数、动线与出入口。`,
};

function promptFor(item, span) {
  const cleanUseCase = item.useCase && item.useCase !== '待按场地判断' ? item.useCase : '现场条件以踏勘为准';
  const where = item.region ? `（${item.region}）` : '';
  const builder = PROMPT_BY_TYPE[item.typeRaw];
  if (builder) return builder({ ...item, useCase: cleanUseCase, region: item.region || '公开案例场地' }, span).replace('（公开案例场地）', where);
  return `${item.name}${where}场地约 ${span.width}×${span.height} 米，${cleanUseCase}。请给出分区划分、设施件数、动线与出入口。`;
}

const layoutSamples = cases.basemap
  .filter((item) => item.recommended)
  .map((item) => {
    const span = { width: Math.round(item.spanM.width), height: Math.round(item.spanM.height) };
    const hints = item.templateHints.filter((hint) => templateIds.has(hint));
    const counts = item.counts;
    const measurable =
      Number.isFinite(counts.zones) &&
      Number.isFinite(counts.objects) &&
      Number.isFinite(counts.routes) &&
      Number.isFinite(counts.entrances);
    return {
      id: `EV-${item.id}`,
      kind: 'layout',
      derivedFrom: item.id,
      prompt: promptFor(item, span),
      scene: {
        typeRaw: item.typeRaw,
        region: item.region,
        spanM: span,
        anchor: { lat: item.anchor.lat, lng: item.anchor.lng },
        useCase: item.useCase,
      },
      expect: {
        templateId: hints[0] ?? null,
        templateAlt: hints.slice(1),
        // 案例类型未分类时置 false：不拿自己的推测当参考答案。
        templateAsserted: hints.length > 0,
        zones: band(counts.zones, TOLERANCE.zones),
        objects: band(counts.objects, counts.objects * TOLERANCE.objects, 1),
        routes: band(counts.routes, TOLERANCE.routes, 1),
        entrances: band(counts.entrances, TOLERANCE.entrances, 1),
      },
      toleranceNote: `分区 ±${TOLERANCE.zones} 条；件数 ±${TOLERANCE.objects * 100}%；动线/入口 ±${TOLERANCE.routes} 个`,
      labelSource: '平台底图核对读数（非主办方清单）',
      measurable,
      caveat: item.confidence,
    };
  });

// ---------------------------------------------------------------------------
// 基准布局：对 11 条已实现判据全部合规（测试会校验它一条违规都不报）
// 场地 120×80 m；舞台+观演区在左侧，市集排在南侧，帐篷在东侧，建筑在东北角。
// ---------------------------------------------------------------------------

const z = (x1, y1, x2, y2) => [
  { x: x1, y: y1 },
  { x: x2, y: y1 },
  { x: x2, y: y2 },
  { x: x1, y: y2 },
];

const boothXs = [-40, -30, -20, -10, 0, 10];

function baselineFixture() {
  const facilities = boothXs.map((x, index) => ({
    id: `booth-${index + 1}`,
    templateId: 'booth-3x3',
    name: `展位 ${index + 1}`,
    position: { x, y: 61.5 },
    rotationDeg: 0,
    size: { width: 3, depth: 3 },
  }));
  facilities.push(
    {
      id: 'food-truck-1',
      templateId: 'food-truck-6x3',
      name: '餐饮车',
      position: { x: 30, y: 61.5 },
      rotationDeg: 0,
      size: { width: 6, depth: 3 },
    },
    {
      id: 'tent-1',
      templateId: 'tent-3x3',
      name: '帐篷 A',
      position: { x: 30, y: 30 },
      rotationDeg: 0,
      size: { width: 3, depth: 3 },
    },
    {
      id: 'tent-2',
      templateId: 'tent-3x3',
      name: '帐篷 B',
      position: { x: 40, y: 30 },
      rotationDeg: 0,
      size: { width: 3, depth: 3 },
    },
    {
      id: 'ext-1',
      templateId: 'fire-extinguisher',
      name: '灭火器 1',
      position: { x: -45, y: 55 },
      rotationDeg: 0,
      size: { width: 1, depth: 1 },
    },
    {
      id: 'ext-2',
      templateId: 'fire-extinguisher',
      name: '灭火器 2',
      position: { x: 15, y: 55 },
      rotationDeg: 0,
      size: { width: 1, depth: 1 },
    },
  );
  return {
    facilities,
    zones: [
      { id: 'zone-stage', semantic: 'stage', name: '舞台区', polygon: z(-50, 44, -34, 52) },
      { id: 'zone-audience', semantic: 'audience', name: '观演区', polygon: z(-54, 20, -26, 38) },
    ],
    nodes: [
      { id: 'gate-a', kind: 'both', name: '主出入口', position: { x: -58, y: 30 } },
      { id: 'gate-b', kind: 'exit', name: '东侧出口', position: { x: 58, y: 5 } },
    ],
    obstacles: [{ id: 'building-1', kind: 'building', name: '既有建筑', polygon: z(45, 60, 60, 75) }],
    boundary: z(-60, 0, 60, 80),
    people: 400,
    stageHeightM: 1.5,
  };
}

function findFacility(layout, id) {
  const facility = layout.facilities.find((item) => item.id === id);
  if (!facility) throw new Error(`夹具缺少设施：${id}`);
  return facility;
}

/**
 * 变异表：每条只改一处。
 * expected 写「必须报出的违规」；联动触发的（如摊位贴建筑会同时踩 GEN-07 与 MKT-11）照实写两条，
 * 不为了「单点」好看而隐瞒。
 */
const MUTATIONS = [
  {
    id: 'EV-NEG-01-GEN-04',
    rule: 'GEN-04',
    change: '撤掉东侧出口，只剩 1 个出入口（<2）',
    expected: ['GEN-04'],
    apply(layout) {
      layout.nodes = layout.nodes.filter((node) => node.id !== 'gate-b');
    },
  },
  {
    id: 'EV-NEG-02-GEN-07',
    rule: 'GEN-07',
    change: '把发电机贴到建筑外墙 1.5 m（<3 m）',
    expected: ['GEN-07'],
    apply(layout) {
      layout.facilities.push({
        id: 'generator-near-building',
        templateId: 'generator-3x2',
        name: '发电机（贴建筑）',
        position: { x: 42, y: 64 },
        rotationDeg: 0,
        size: { width: 3, depth: 2 },
      });
    },
  },
  {
    id: 'EV-NEG-03-MKT-02',
    rule: 'MKT-02',
    change: '把展位 3 横移到距展位 2 只有 0.2 m 的位置（<1.5 m）',
    expected: ['MKT-02'],
    apply(layout) {
      findFacility(layout, 'booth-3').position.x = -26.8;
    },
  },
  {
    id: 'EV-NEG-04-MKT-06',
    rule: 'MKT-06',
    change: '把餐饮车挪到距最近展位 1.5 m（<6 m）',
    expected: ['MKT-06'],
    apply(layout) {
      findFacility(layout, 'food-truck-1').position.x = 16;
    },
  },
  {
    id: 'EV-NEG-05-MKT-07',
    rule: 'MKT-07',
    change: '撤掉全部灭火器（6 摊需 2 具，现 0 具）',
    expected: ['MKT-07'],
    apply(layout) {
      layout.facilities = layout.facilities.filter((item) => !item.id.startsWith('ext-'));
    },
  },
  {
    id: 'EV-NEG-06-MKT-10',
    rule: 'MKT-10',
    change: '把 6 个展位挤进 12×12 m 的临时区（占地率 37.5% > 35%）',
    expected: ['MKT-10'],
    apply(layout) {
      layout.boundary = z(-42, 55, -30, 67);
    },
  },
  {
    id: 'EV-NEG-07-MKT-11',
    rule: 'MKT-11',
    change: '把新增展位摆到距建筑 1.5 m（<3 m）；GEN-07 会同时触发',
    expected: ['GEN-07', 'MKT-11'],
    apply(layout) {
      layout.facilities.push({
        id: 'booth-near-building',
        templateId: 'booth-3x3',
        name: '贴建筑展位',
        position: { x: 42, y: 61.5 },
        rotationDeg: 0,
        size: { width: 3, depth: 3 },
      });
    },
  },
  {
    id: 'EV-NEG-08-STG-01',
    rule: 'STG-01',
    change: '观演区不变，人数从 400 提到 900（0.56 ㎡/人 <1.0）',
    expected: ['STG-01'],
    apply(layout) {
      layout.people = 900;
    },
  },
  {
    id: 'EV-NEG-09-STG-02',
    rule: 'STG-02',
    change: '观演区向舞台推进到只剩 2 m 退距（台高 1.5 m 需 5 m）',
    expected: ['STG-02'],
    apply(layout) {
      layout.zones.find((zone) => zone.semantic === 'audience').polygon = z(-54, 20, -26, 42);
    },
  },
  {
    id: 'EV-NEG-10-CMP-02',
    rule: 'CMP-02',
    change: '两顶帐篷只隔 1 m（<2 m）；CMP-03 的 4 m 防火间距会同时触发',
    expected: ['CMP-02', 'CMP-03'],
    apply(layout) {
      findFacility(layout, 'tent-2').position.x = 34;
    },
  },
  {
    id: 'EV-NEG-11-CMP-03',
    rule: 'CMP-03',
    change: '两顶帐篷隔 3 m（≥2 m 但 <4 m 防火间距）',
    expected: ['CMP-03'],
    apply(layout) {
      findFacility(layout, 'tent-2').position.x = 36;
    },
  },
  {
    id: 'EV-NEG-12-CMP-03',
    rule: 'CMP-03',
    change: '餐饮车挪到距帐篷 5 m（<10 m 明火间距）',
    expected: ['CMP-03'],
    apply(layout) {
      findFacility(layout, 'food-truck-1').position = { x: 30, y: 38 };
    },
  },
  {
    id: 'EV-NEG-13-MKT-02',
    rule: 'MKT-02',
    change: '在展位 3 正下方 1 m 处加一个展位（上下相邻 <2 m）',
    expected: ['MKT-02'],
    apply(layout) {
      layout.facilities.push({
        id: 'booth-7',
        templateId: 'booth-3x3',
        name: '展位 7（贴下行）',
        position: { x: -20, y: 57.5 },
        rotationDeg: 0,
        size: { width: 3, depth: 3 },
      });
    },
  },
].map((mutation) => {
  const layout = baselineFixture();
  mutation.apply(layout);
  return {
    id: mutation.id,
    kind: 'failure',
    derivedFrom: 'baseline-layout',
    derivedFromRule: mutation.rule,
    prompt: `现场布局：${mutation.change}。请判断这个布局能不能用，并指出违反了什么。`,
    expect: { violations: mutation.expected, contextRefs: [] },
    fixture: layout,
    mutation: { change: mutation.change, isolated: mutation.expected.length === 1 },
    failureMode: mutation.change,
    note: '基准布局 + 单点变异；违规集合由测试逐条比对，多报一条也算错。',
  };
});

/** 对照样本：基准布局不动。要求执行器一条违规都不报——抓的是误报。 */
const controlSample = {
  id: 'EV-NEG-00-CONTROL',
  kind: 'failure',
  derivedFrom: 'baseline-layout',
  derivedFromRule: null,
  prompt:
    '现场布局：120×80 m 场地，西南侧舞台与观演区之间留 6 m 退距，南侧 6 个 3×3 m 展位成排、间距 7 m，餐饮车距最近展位 15 m，东侧两顶帐篷相距 7 m、距餐饮车 28 m，东北角既有建筑距最近设施 12 m，配 2 具灭火器，设 1 个主出入口 + 1 个东侧出口。请判断这个布局能不能用。',
  expect: { violations: [], contextRefs: [] },
  fixture: baselineFixture(),
  mutation: { change: '不改（合规基准）', isolated: true },
  failureMode: '无缺陷对照：用来发现误报',
  note: '任何一条硬违规被报出都算误报，必须为 0。',
};

/** 事故样本：多故障，保留原有三条。 */
const incidentSamples = [
  {
    id: 'EV-INC-01',
    kind: 'failure',
    derivedFrom: 'INC-01',
    prompt:
      '跨年倒计时活动，场地是临江台阶广场：观众全部集中在台阶下方的缓冲区，只有南侧一个出入口，人流从同一个口进出；预计瞬时 4000 人。请评估这个布局能不能用。',
    expect: { violations: ['GEN-04', 'STG-01'], contextRefs: ['GEN-03', 'EXH-05'] },
    fixture: {
      facilities: [
        {
          id: 'stage-1',
          templateId: 'stage-8x6',
          name: '倒计时主舞台',
          position: { x: 0, y: 30 },
          rotationDeg: 0,
          size: { width: 8, depth: 6 },
        },
      ],
      zones: [
        { id: 'zone-audience', semantic: 'audience', name: '台阶下缓冲观演区', polygon: z(-10, 0, 10, 10) },
        { id: 'zone-stage', semantic: 'stage', name: '舞台区', polygon: z(-6, 24, 6, 30) },
      ],
      nodes: [{ id: 'gate-south', kind: 'both', name: '南侧唯一出入口', position: { x: 0, y: -3 } }],
      obstacles: [],
      boundary: z(-20, -10, 20, 40),
      people: 4000,
      stageHeightM: 1.5,
    },
    failureMode: '瓶颈区超容 + 单一出入口双向对冲',
    mutation: { change: '事故夹具（非基准）', isolated: false },
    note: '夹具是「照失效模式搭的最小复现」，不是当年现场复原图。',
  },
  {
    id: 'EV-INC-02',
    kind: 'failure',
    derivedFrom: 'INC-02',
    prompt:
      '大型游行活动，路线穿过一条带地下通道口的街道：观众与队伍都从一个入口进，通道口用围挡挡住，没有设置任何出口；预计 25 万人。请评估这个布局能不能用。',
    expect: { violations: ['GEN-04'], contextRefs: ['GEN-03', 'STG-03', 'MKT-04'] },
    fixture: {
      facilities: [],
      zones: [{ id: 'zone-route', semantic: 'route', name: '游行通道', polygon: z(-40, -5, 40, 5) }],
      nodes: [{ id: 'gate-in', kind: 'entry', name: '唯一入口', position: { x: -42, y: 0 } }],
      obstacles: [
        {
          id: 'tunnel-mouth',
          kind: 'barrier',
          name: '地下通道口围挡',
          polygon: z(-6, 6, 6, 12),
        },
      ],
      boundary: z(-45, -8, 45, 14),
      people: 250000,
    },
    failureMode: '单一入口无出口 + 通道回涌',
    mutation: { change: '事故夹具（非基准）', isolated: false },
    note: '25 万人 > 1 万，GEN-04 按 4 个出口要求；夹具故意给出 0 个出口。',
  },
  {
    id: 'EV-INC-03',
    kind: 'failure',
    derivedFrom: 'INC-03',
    prompt:
      '户外音乐节主舞台前是站立观演区，围栏紧贴舞台前沿，没有内场隔离带；预计 5000 人挤在 800 平方米的站立区，台高 2.5 米。请评估这个布局能不能用。',
    expect: { violations: ['STG-01', 'STG-02'], contextRefs: ['STG-05', 'GEN-04'] },
    fixture: {
      facilities: [
        {
          id: 'stage-main',
          templateId: 'stage-8x6',
          name: '主舞台',
          position: { x: 0, y: 20 },
          rotationDeg: 0,
          size: { width: 16, depth: 8 },
        },
      ],
      zones: [
        { id: 'zone-audience', semantic: 'audience', name: '站立观演区', polygon: z(-20, 0, 20, 20) },
        { id: 'zone-stage', semantic: 'stage', name: '舞台区', polygon: z(-8, 16, 8, 24) },
      ],
      nodes: [
        { id: 'gate-a', kind: 'both', name: '东侧出入口', position: { x: -22, y: -2 } },
        { id: 'gate-b', kind: 'exit', name: '西侧出口', position: { x: 22, y: -2 } },
      ],
      obstacles: [],
      boundary: z(-25, -6, 25, 30),
      people: 5000,
      stageHeightM: 2.5,
    },
    failureMode: '站立密度超限 + 舞台前无有效退距',
    mutation: { change: '事故夹具（非基准）', isolated: false },
    note: '800 ㎡ / 5000 人 = 0.16 ㎡/人；台高 2.5 m 需 9 m 退距，夹具只留 0 m。',
  },
];

const failureSamples = [controlSample, ...MUTATIONS, ...incidentSamples];

const payload = {
  schemaVersion: 2,
  generatedAt: '2026-11-18',
  generator: 'scripts/build-agent-eval-cases.mjs',
  source: 'data/agent-corpus/cases/cases.json',
  goal: '给户外 Agent 一个可复算的评测集：layout 样本考「提得对不对」，failure 样本考「该报的违规报没报」+「没问题的别乱报」。',
  scoringNote:
    'layout 按模板命中 + 四项计数落带计分；failure 按「必须报出的已实现判据」召回计分；violations 为空的对照样本按「误报」计分（必须报出 0 条硬违规）。参考带来自平台读数，不是标准答案。',
  tolerances: TOLERANCE,
  fixturePolicy:
    'failure 夹具采用「基准布局 + 单点变异」：基准对 11 条已实现判据全部合规，每条变异只改一处；天然联动的违规（如摊位贴建筑同时踩 GEN-07 与 MKT-11）照实写全。',
  samples: [...layoutSamples, ...failureSamples],
};

mkdirSync(path.dirname(outPath), { recursive: true });
writeFileSync(outPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
console.log(
  `eval-cases.json: layout=${layoutSamples.length} failure=${failureSamples.length}（对照 1 + 变异 ${MUTATIONS.length} + 事故 ${incidentSamples.length}）total=${payload.samples.length}`,
);
for (const sample of payload.samples) {
  if (sample.kind === 'layout') {
    const e = sample.expect;
    console.log(
      `${sample.id} ${e.templateId} 区${e.zones.min}-${e.zones.max} 件${e.objects.min}-${e.objects.max} 路${e.routes.min}-${e.routes.max} 口${e.entrances.min}-${e.entrances.max}`,
    );
  } else {
    console.log(`${sample.id} 违规=[${sample.expect.violations.join(',')}] 上下文=[${sample.expect.contextRefs.join(',')}]`);
  }
}
