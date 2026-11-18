import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

/**
 * 生成 data/agent-corpus/cases/eval-cases.json（2026-11-18）。
 *
 * 输入：data/agent-corpus/cases/cases.json（43 案 + 3 事故）
 * 输出：13 条评测样本
 *  - 10 条 layout：来自推荐案例，prompt 只给客观场地线索（类型/区域/跨度/用途），
 *    **不给分区与件数**；期望值是平台读数 ±容差，作为参考带而不是标准答案。
 *  - 3 条 failure：来自事故失效模式，附可执行的最小布局夹具，
 *    期望值只写「必须报出的已实现判据」，其余引用记进 contextRefs。
 *
 * 为什么夹具写在这里而不是 JSON 手改：夹具必须能被 evaluateLayout 真跑出违规，
 * 手改容易与执行器脱节；脚本重建 + 测试兜底，改坏了测试会红。
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
        // 套餐类型未分类的案例不校模板：不拿自己的推测当参考答案。
        templateAsserted: hints.length > 0,
        zones: band(counts.zones, TOLERANCE.zones),
        objects: band(counts.objects, counts.objects * TOLERANCE.objects, 1),
        routes: band(counts.routes, TOLERANCE.routes, 1),
        entrances: band(counts.entrances, TOLERANCE.entrances, 1),
      },
      toleranceNote: `分区 ±${TOLERANCE.zones} 条；件数 ±${TOLERANCE.objects * 100}%；动线/入口 ±${TOLERANCE.routes} 个`,
      labelSource: '平台底图核对读数（非主办方清单）',
      measurable,
      caveat: item.confidence,    };
  });

/** 失效样本：夹具要能被 evaluateLayout 真跑出违规，否则测试会红。 */
const failureSamples = [
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
        {
          id: 'zone-audience',
          semantic: 'audience',
          name: '台阶下缓冲观演区',
          polygon: [
            { x: -10, y: 0 },
            { x: 10, y: 0 },
            { x: 10, y: 10 },
            { x: -10, y: 10 },
          ],
        },
        {
          id: 'zone-stage',
          semantic: 'stage',
          name: '舞台区',
          polygon: [
            { x: -6, y: 24 },
            { x: 6, y: 24 },
            { x: 6, y: 30 },
            { x: -6, y: 30 },
          ],
        },
      ],
      nodes: [{ id: 'gate-south', kind: 'both', name: '南侧唯一出入口', position: { x: 0, y: -3 } }],
      obstacles: [],
      boundary: [
        { x: -20, y: -10 },
        { x: 20, y: -10 },
        { x: 20, y: 40 },
        { x: -20, y: 40 },
      ],
      people: 4000,
      stageHeightM: 1.5,
    },
    failureMode: '瓶颈区超容 + 单一出入口双向对冲',
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
      zones: [
        {
          id: 'zone-route',
          semantic: 'route',
          name: '游行通道',
          polygon: [
            { x: -40, y: -5 },
            { x: 40, y: -5 },
            { x: 40, y: 5 },
            { x: -40, y: 5 },
          ],
        },
      ],
      nodes: [{ id: 'gate-in', kind: 'entry', name: '唯一入口', position: { x: -42, y: 0 } }],
      obstacles: [
        {
          id: 'tunnel-mouth',
          kind: 'barrier',
          name: '地下通道口围挡',
          polygon: [
            { x: -6, y: 6 },
            { x: 6, y: 6 },
            { x: 6, y: 12 },
            { x: -6, y: 12 },
          ],
        },
      ],
      boundary: [
        { x: -45, y: -8 },
        { x: 45, y: -8 },
        { x: 45, y: 14 },
        { x: -45, y: 14 },
      ],
      people: 250000,
    },
    failureMode: '单一入口无出口 + 通道回涌',
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
        {
          id: 'zone-audience',
          semantic: 'audience',
          name: '站立观演区',
          polygon: [
            { x: -20, y: 0 },
            { x: 20, y: 0 },
            { x: 20, y: 20 },
            { x: -20, y: 20 },
          ],
        },
        {
          id: 'zone-stage',
          semantic: 'stage',
          name: '舞台区',
          polygon: [
            { x: -8, y: 16 },
            { x: 8, y: 16 },
            { x: 8, y: 24 },
            { x: -8, y: 24 },
          ],
        },
      ],
      nodes: [
        { id: 'gate-a', kind: 'both', name: '东侧出入口', position: { x: -22, y: -2 } },
        { id: 'gate-b', kind: 'exit', name: '西侧出口', position: { x: 22, y: -2 } },
      ],
      obstacles: [],
      boundary: [
        { x: -25, y: -6 },
        { x: 25, y: -6 },
        { x: 25, y: 30 },
        { x: -25, y: 30 },
      ],
      people: 5000,
      stageHeightM: 2.5,
    },
    failureMode: '站立密度超限 + 舞台前无有效退距',
    note: '800 ㎡ / 5000 人 = 0.16 ㎡/人；台高 2.5 m 需 9 m 退距，夹具只留 0 m。',
  },
];

const payload = {
  schemaVersion: 1,
  generatedAt: '2026-11-18',
  generator: 'scripts/build-agent-eval-cases.mjs',
  source: 'data/agent-corpus/cases/cases.json',
  goal: '给户外 Agent 一个可复算的评测集：layout 样本考「提得对不对」，failure 样本考「该报的违规报没报出来」。',
  scoringNote:
    'layout 方案按模板命中 + 四项计数落带计分；failure 方案按「必须报出的已实现判据」召回计分，未实现的引用只记上下文、不计分。参考带来自平台读数，不是标准答案。',
  tolerances: TOLERANCE,
  samples: [...layoutSamples, ...failureSamples],
};

mkdirSync(path.dirname(outPath), { recursive: true });
writeFileSync(outPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
console.log(`eval-cases.json: layout=${layoutSamples.length} failure=${failureSamples.length} total=${payload.samples.length}`);
for (const sample of payload.samples) {
  if (sample.kind === 'layout') {
    const e = sample.expect;
    console.log(
      `${sample.id} ${e.templateId} 区${e.zones.min}-${e.zones.max} 件${e.objects.min}-${e.objects.max} 路${e.routes.min}-${e.routes.max} 口${e.entrances.min}-${e.entrances.max}`,
    );
  } else {
    console.log(`${sample.id} 违规=${sample.expect.violations.join(',')} 上下文=${sample.expect.contextRefs.join(',')}`);
  }
}
