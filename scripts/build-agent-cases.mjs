import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import path from 'node:path';

/**
 * 生成 data/agent-corpus/cases/cases.json（2026-11-18）。
 * 输入：
 *  - deliverables/幕景中国研究资料包_2026-11-18/06_卫星图活动试验/卫星底图活动试验清单.csv（43 案）
 *  - deliverables/幕景中国研究资料包_2026-11-18/04_场地档案与演练/（自有场地档案）
 * 输出只做归一化与归类，不改动任何读数；来源路径逐条写进 evidence。
 */

const root = process.cwd();
const csvPath = path.join(
  root,
  'deliverables/幕景中国研究资料包_2026-11-18/06_卫星图活动试验/卫星底图活动试验清单.csv',
);
const venueDir = path.join(root, 'deliverables/幕景中国研究资料包_2026-11-18/04_场地档案与演练');
const outDir = path.join(root, 'data/agent-corpus/cases');

function parseCsv(text) {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((line) => line.trim());
  const split = (line) => {
    const cells = [];
    let current = '';
    let quoted = false;
    for (const char of line) {
      if (char === '"') quoted = !quoted;
      else if (char === ',' && !quoted) { cells.push(current); current = ''; }
      else current += char;
    }
    cells.push(current);
    return cells;
  };
  const header = split(lines[0]);
  return lines.slice(1).map((line) => {
    const cells = split(line);
    const row = {};
    header.forEach((key, index) => { row[key] = cells[index] ?? ''; });
    return row;
  });
}

const numberOrNull = (value) => {
  const text = String(value ?? '').trim();
  if (!text) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
};

function templateHints(type, useCase) {
  const text = `${type} ${useCase}`;
  const hints = [];
  if (/Road Events|路线|路跑|封控/.test(text)) hints.push('STG');
  if (/Festivals|节庆|市集|展位/.test(text)) hints.push('MKT');
  if (/舞台|演出/.test(text)) hints.push('STG');
  if (/Local Governments|社区|公共/.test(text)) hints.push('MKT');
  if (/Education|Venues|展览|展陈/.test(text)) hints.push('EXH');
  return [...new Set(hints)];
}

const rows = parseCsv(readFileSync(csvPath, 'utf8'));
const basemap = rows.map((row) => {
  const id = `BM-${String(row['序号']).padStart(2, '0')}`;
  const rawAnchor = String(row['原始锚点串_经在前'] ?? '').trim();
  const lat = numberOrNull(row['锚点纬度']);
  const lng = numberOrNull(row['锚点经度']);
  const parsed = rawAnchor.split(',').map((part) => Number(part.trim()));
  return {
    id,
    source: 'basemap-audit',
    name: row['活动名'],
    typeRaw: row['类型'] || '未分类',
    region: row['区域'],
    anchor: {
      lat,
      lng,
      raw: rawAnchor,
      // 原始串是「经在前」；这里显式记录，避免下游把 lat/lng 读反。
      rawOrder: 'lng,lat',
      matchesRaw: parsed.length === 2 && Math.abs(parsed[0] - lng) < 1e-6 && Math.abs(parsed[1] - lat) < 1e-6,
    },
    spanM: { width: numberOrNull(row['复刻跨度_宽m']), height: numberOrNull(row['复刻跨度_高m']) },
    counts: {
      zones: numberOrNull(row['分区数']),
      objects: numberOrNull(row['物料件数']),
      routes: numberOrNull(row['路线数']),
      entrances: numberOrNull(row['入口点数']),
    },
    registration: {
      badge: row['核对徽标'] || '',
      angleDeg: numberOrNull(row['配准角_度']),
      metersPerPixel: numberOrNull(row['图上分辨率_m每px']),
      rmsM: numberOrNull(row['拟合RMS_m']),
      imageryPoints: numberOrNull(row['影像对应点数']),
    },
    useCase: row['试验用途'] || '',
    recommended: row['推荐'] === '是',
    templateHints: templateHints(row['类型'], row['试验用途']),
    confidence: '平台案例底图核对读数；锚点与件数为核对值，不是主办方官方数据',
    evidence: {
      auditHtml: 'deliverables/幕景中国研究资料包_2026-11-18/06_卫星图活动试验/经典活动案例底图核对_43案.html',
      auditCsv: 'deliverables/幕景中国研究资料包_2026-11-18/06_卫星图活动试验/卫星底图活动试验清单.csv',
    },
  };
});

const venueFiles = readdirSync(venueDir).filter((name) => !name.startsWith('.'));
const venueMap = new Map();
for (const file of venueFiles) {
  const match = file.match(/^幕景([^_]+)_/);
  const venue = match ? match[1] : file.split('_')[0];
  if (!venueMap.has(venue)) venueMap.set(venue, []);
  venueMap.get(venue).push(file);
}

const venueHints = (files) => {
  const text = files.join(' ');
  const hints = new Set();
  if (/展|博|馆|进博|数贸/.test(text)) hints.add('EXH');
  if (/巡游|启动|舞台|演出/.test(text)) hints.add('STG');
  if (/活动安排|开放|签到|休息/.test(text)) hints.add('MKT');
  if (hints.size === 0) hints.add('EXH');
  return [...hints];
};

const venues = [...venueMap.entries()].sort(([a], [b]) => a.localeCompare(b, 'zh')).map(([venue, files], index) => ({
  id: `VN-${String(index + 1).padStart(2, '0')}`,
  source: 'own-venue-archive',
  name: venue,
  files: files.sort(),
  fileCount: files.length,
  templateHints: venueHints(files),
  confidence: '自有演练档案；匿名化命名，未含真实客户与报价',
  evidence: { dir: 'deliverables/幕景中国研究资料包_2026-11-18/04_场地档案与演练' },
}));

/**
 * 事故复盘案例。
 * 刻意不写伤亡数字与调查结论——本轮没有取得官方调查报告原文。
 * 只记录「布局层面的失效模式」，并绑定到判据 id，供负样本使用。
 */
const incidents = [
  {
    id: 'INC-01',
    source: 'public-incident',
    name: '上海外滩陈毅广场跨年踩踏（2014-12-31）',
    typeRaw: 'public gathering',
    layoutFailure: '观景平台与上下台阶形成单向瓶颈，双向人流对冲；瞬时人数超出平台容量，缺少分流与限流。',
    failureModes: ['bottleneck', 'counter-flow', 'capacity-overrun'],
    assertionRefs: ['GEN-03', 'GEN-04', 'STG-01', 'EXH-05'],
    templateHints: ['STG'],
    verification: '待回查官方调查报告原文；本条不引用伤亡数字与责任结论',
    confidence: '公开报道广泛记录的事件类型；细节以官方调查报告为准',
    evidence: { note: '本轮未取得调查报告原文，故不写数值' },
  },
  {
    id: 'INC-02',
    source: 'public-incident',
    name: '德国杜伊斯堡 Love Parade 音乐节踩踏（2010-07-24）',
    typeRaw: 'festival',
    layoutFailure: '场地唯一进出通道为斜坡隧道，入口宽度不足且无第二条疏散路径；人群在入口回涌时无法分流。',
    failureModes: ['single-entry', 'bottleneck', 'no-secondary-egress'],
    assertionRefs: ['GEN-03', 'GEN-04', 'STG-03', 'MKT-04'],
    templateHints: ['STG', 'MKT'],
    verification: '待回查官方调查报告原文；本条不引用伤亡数字与责任结论',
    confidence: '公开报道广泛记录的事件类型；细节以官方调查报告为准',
    evidence: { note: '本轮未取得调查报告原文，故不写数值' },
  },
  {
    id: 'INC-03',
    source: 'public-incident',
    name: '美国 Astroworld 音乐节人群挤压（2021-11-05）',
    typeRaw: 'festival',
    layoutFailure: '站立观众区密度持续升高，观众与舞台之间缺少有效分隔与医疗通道，现场响应被拥堵阻断。',
    failureModes: ['density-overrun', 'medical-access-blocked', 'barrier-missing'],
    assertionRefs: ['STG-01', 'STG-05', 'GEN-04'],
    templateHints: ['STG'],
    verification: '待回查官方调查报告原文；本条不引用伤亡数字与责任结论',
    confidence: '公开报道广泛记录的事件类型；细节以官方调查报告为准',
    evidence: { note: '本轮未取得调查报告原文，故不写数值' },
  },
];

const output = {
  schemaVersion: 1,
  generatedAt: '2026-11-18',
  note: '三类案例：平台底图核对（读数）、自有场地档案（演练件）、公开事故复盘（只记布局失效模式，不引伤亡数字）。案例不是验收证据，也不能替代审批。',
  counts: {
    basemap: basemap.length,
    recommended: basemap.filter((item) => item.recommended).length,
    venues: venues.length,
    venueFiles: venueFiles.length,
    incidents: incidents.length,
  },
  basemap,
  venues,
  incidents,
};

mkdirSync(outDir, { recursive: true });
writeFileSync(path.join(outDir, 'cases.json'), `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(`cases.json: basemap=${basemap.length} recommended=${output.counts.recommended} venues=${venues.length} files=${venueFiles.length} incidents=${incidents.length}`);
console.log(venues.map((venue) => `${venue.id} ${venue.name} (${venue.fileCount})`).join('\n'));
