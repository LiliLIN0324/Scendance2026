import { METERS_PER_DEGREE_LAT, metersPerDegreeLng, polygonBboxMeters, type AmapPoint } from './amap-venue';

/** 沿场一圈或沿主客流线的一个站位。 */
export interface CaptureStop {
  index: number;
  lng: number;
  lat: number;
  /** 镜头朝向：自正北顺时针的度数。 */
  bearing: number;
  /** 朝向的口语说法。 */
  compass: string;
}

export type CaptureMode = 'boundary' | 'flow';

export interface CapturePlan {
  stops: CaptureStop[];
  /** 圈画边界的周长（米）；流线模式仍报周长便于对照场地尺度。 */
  perimeter: number;
  /** 相邻两站的间距（米）。 */
  spacing: number;
  /** 总张数：每站平视与俯角各一张。 */
  shots: number;
  size: { width: number; depth: number };
  /** 站距被拉到 12 米以上：这种地块靠走路拍照补不齐，改录视频。 */
  preferVideo: boolean;
  /** boundary = 沿边界；flow = 沿主客流线加密（D1）。 */
  mode: CaptureMode;
  /** 主客流线长度（米）；仅 flow 模式有。 */
  flowLength?: number;
  /** 导出俯视图用的流线折点；仅 flow 模式有。 */
  flow?: AmapPoint[];
}

const MIN_STOPS = 12;
const MAX_STOPS = 24;
/** 边界站距：三米半到八米之间才谈得上相邻重叠。 */
const TARGET_SPACING = 8;
/** 流线站距更密：主客路径上要接得上相邻重叠。 */
const TARGET_FLOW_SPACING = 4;
const MIN_FLOW_STOPS = 8;
const MAX_FLOW_STOPS = 36;
const PHOTOS_PER_STOP = 2;
export const VIDEO_SPACING = 12;
/** 每站两张：一张平视扫全场，一张略俯收地面铺装与矮障碍。 */
export const PHOTOS_PER_STOP_HINT = '平视 1 张 + 略俯 1 张';

const COMPASS = ['北', '东北', '东', '东南', '南', '西南', '西', '西北'];

function compassOf(bearing: number): string {
  return COMPASS[Math.round(bearing / 45) % 8] ?? '场内';
}

type LocalXY = { x: number; z: number };

function projectRing(polygon: AmapPoint[]): {
  ring: LocalXY[];
  origin: AmapPoint;
  kx: number;
  size: { width: number; depth: number };
  perimeter: number;
  segments: { start: LocalXY; end: LocalXY; length: number }[];
} {
  const size = polygonBboxMeters(polygon);
  const empty = {
    ring: [] as LocalXY[],
    origin: { lng: 0, lat: 0 },
    kx: 1,
    size,
    perimeter: 0,
    segments: [] as { start: LocalXY; end: LocalXY; length: number }[],
  };
  if (polygon.length < 3) return empty;
  const lats = polygon.map(point => point.lat);
  const lngs = polygon.map(point => point.lng);
  const latMid = (Math.min(...lats) + Math.max(...lats)) / 2;
  const kx = metersPerDegreeLng(latMid);
  const origin = { lng: (Math.min(...lngs) + Math.max(...lngs)) / 2, lat: latMid };
  const ring = polygon.map(point => ({
    x: (point.lng - origin.lng) * kx,
    z: (point.lat - origin.lat) * METERS_PER_DEGREE_LAT,
  }));
  const segments = ring.map((start, index) => {
    const end = ring[(index + 1) % ring.length]!;
    return { start, end, length: Math.hypot(end.x - start.x, end.z - start.z) };
  });
  const perimeter = segments.reduce((sum, segment) => sum + segment.length, 0);
  return { ring, origin, kx, size, perimeter, segments };
}

function toLngLat(origin: AmapPoint, kx: number, x: number, z: number): AmapPoint {
  return {
    lng: Math.round((origin.lng + x / kx) * 1e6) / 1e6,
    lat: Math.round((origin.lat + z / METERS_PER_DEGREE_LAT) * 1e6) / 1e6,
  };
}

function samplePolyline(
  segments: { start: LocalXY; end: LocalXY; length: number }[],
  totalLength: number,
  stopCount: number,
  bearingAt: (x: number, z: number, tx: number, tz: number) => number,
  origin: AmapPoint,
  kx: number,
): CaptureStop[] {
  const stops: CaptureStop[] = [];
  let walked = 0;
  let cursor = 0;
  for (let i = 0; i < stopCount; i++) {
    const target = i * (totalLength / stopCount);
    while (cursor < segments.length - 1 && walked + segments[cursor]!.length < target) {
      walked += segments[cursor]!.length;
      cursor++;
    }
    const segment = segments[cursor]!;
    const t = segment.length > 0 ? Math.min(1, Math.max(0, (target - walked) / segment.length)) : 0;
    const x = segment.start.x + (segment.end.x - segment.start.x) * t;
    const z = segment.start.z + (segment.end.z - segment.start.z) * t;
    const tx = segment.end.x - segment.start.x;
    const tz = segment.end.z - segment.start.z;
    const bearing = bearingAt(x, z, tx, tz);
    const ll = toLngLat(origin, kx, x, z);
    stops.push({
      index: i + 1,
      lng: ll.lng,
      lat: ll.lat,
      bearing: Math.round(bearing),
      compass: compassOf(bearing),
    });
  }
  return stops;
}

/**
 * 圈画边界 → 现场采集单。
 * 重建要的是「绕场一圈、相邻重叠」的连续覆盖，所以站位按周长均分、镜头一律朝向场地中心；
 * 一圈拉不出 20 张以上的重叠（站距超过 12 米）就说明这块地太大，走路拍照补不齐，该改用视频。
 */
export function capturePlan(polygon: AmapPoint[]): CapturePlan {
  const { ring, origin, kx, size, perimeter, segments } = projectRing(polygon);
  const empty: CapturePlan = {
    stops: [], perimeter: 0, spacing: 0, shots: 0, size, preferVideo: false, mode: 'boundary',
  };
  if (ring.length < 3 || !Number.isFinite(perimeter) || perimeter < 1) return empty;

  const centroid = {
    x: ring.reduce((sum, p) => sum + p.x, 0) / ring.length,
    z: ring.reduce((sum, p) => sum + p.z, 0) / ring.length,
  };
  const stopCount = Math.min(MAX_STOPS, Math.max(MIN_STOPS, Math.round(perimeter / TARGET_SPACING)));
  const step = perimeter / stopCount;
  const stops = samplePolyline(
    segments,
    perimeter,
    stopCount,
    (x, z) => ((Math.atan2(centroid.x - x, centroid.z - z) * 180) / Math.PI + 360) % 360,
    origin,
    kx,
  );
  return {
    stops,
    perimeter: Math.round(perimeter),
    spacing: Math.round(step * 10) / 10,
    shots: stops.length * PHOTOS_PER_STOP,
    size,
    preferVideo: step > VIDEO_SPACING,
    mode: 'boundary',
  };
}

/**
 * 默认主客流线：沿外接矩形较长边穿过场地中心（入口边中点 → 对边中点）。
 * 没手画流线时用它加密站位，避免「只有边界站位却声称流线」。
 */
export function defaultGuestFlow(polygon: AmapPoint[]): AmapPoint[] {
  if (polygon.length < 3) return [];
  const lats = polygon.map(p => p.lat);
  const lngs = polygon.map(p => p.lng);
  const latMid = (Math.min(...lats) + Math.max(...lats)) / 2;
  const lngMid = (Math.min(...lngs) + Math.max(...lngs)) / 2;
  const kx = metersPerDegreeLng(latMid);
  const width = (Math.max(...lngs) - Math.min(...lngs)) * kx;
  const depth = (Math.max(...lats) - Math.min(...lats)) * METERS_PER_DEGREE_LAT;
  const inset = 0.08;
  if (width >= depth) {
    const span = Math.max(...lngs) - Math.min(...lngs);
    return [
      { lng: Math.min(...lngs) + span * inset, lat: latMid },
      { lng: Math.max(...lngs) - span * inset, lat: latMid },
    ];
  }
  const span = Math.max(...lats) - Math.min(...lats);
  return [
    { lng: lngMid, lat: Math.min(...lats) + span * inset },
    { lng: lngMid, lat: Math.max(...lats) - span * inset },
  ];
}

/**
 * 圈画内主客流线 → 沿流线加密站位（D1）。
 * 镜头朝向沿流线前进方向（客人眼里的主视角）；俯视图会画出流线折点。
 */
export function capturePlanAlongFlow(polygon: AmapPoint[], flow: AmapPoint[]): CapturePlan {
  const projected = projectRing(polygon);
  const size = projected.size;
  const empty: CapturePlan = {
    stops: [],
    perimeter: Math.round(projected.perimeter),
    spacing: 0,
    shots: 0,
    size,
    preferVideo: false,
    mode: 'flow',
    flowLength: 0,
    flow: [],
  };
  if (polygon.length < 3 || flow.length < 2) return empty;

  const { origin, kx, perimeter } = projected;
  const local = flow.map(point => ({
    x: (point.lng - origin.lng) * kx,
    z: (point.lat - origin.lat) * METERS_PER_DEGREE_LAT,
  }));
  const segments = local.slice(0, -1).map((start, index) => {
    const end = local[index + 1]!;
    return { start, end, length: Math.hypot(end.x - start.x, end.z - start.z) };
  }).filter(segment => segment.length > 1e-6);
  const flowLength = segments.reduce((sum, segment) => sum + segment.length, 0);
  if (!Number.isFinite(flowLength) || flowLength < 1) {
    return { ...empty, perimeter: Math.round(perimeter) };
  }

  const stopCount = Math.min(
    MAX_FLOW_STOPS,
    Math.max(MIN_FLOW_STOPS, Math.round(flowLength / TARGET_FLOW_SPACING) + 1),
  );
  const stops: CaptureStop[] = [];
  for (let i = 0; i < stopCount; i++) {
    const target = stopCount === 1 ? 0 : (i / (stopCount - 1)) * flowLength;
    let walked = 0;
    let cursor = 0;
    while (cursor < segments.length - 1 && walked + segments[cursor]!.length < target) {
      walked += segments[cursor]!.length;
      cursor++;
    }
    const segment = segments[cursor]!;
    const t = segment.length > 0 ? Math.min(1, Math.max(0, (target - walked) / segment.length)) : 0;
    const x = segment.start.x + (segment.end.x - segment.start.x) * t;
    const z = segment.start.z + (segment.end.z - segment.start.z) * t;
    const tx = segment.end.x - segment.start.x;
    const tz = segment.end.z - segment.start.z;
    const bearing = ((Math.atan2(tx, tz) * 180) / Math.PI + 360) % 360;
    const ll = toLngLat(origin, kx, x, z);
    stops.push({
      index: i + 1,
      lng: ll.lng,
      lat: ll.lat,
      bearing: Math.round(bearing),
      compass: compassOf(bearing),
    });
  }

  const spacing = stopCount > 1 ? flowLength / (stopCount - 1) : flowLength;
  return {
    stops,
    perimeter: Math.round(perimeter),
    spacing: Math.round(spacing * 10) / 10,
    shots: stops.length * PHOTOS_PER_STOP,
    size,
    preferVideo: spacing > VIDEO_SPACING,
    mode: 'flow',
    flowLength: Math.round(flowLength * 10) / 10,
    flow: flow.map(point => ({ lng: point.lng, lat: point.lat })),
  };
}

/** 有手画流线就用它；否则用默认长轴流线。永远走 flow 模式出站位。 */
export function capturePlanForVenue(polygon: AmapPoint[], flow?: AmapPoint[] | null): CapturePlan {
  const path = flow && flow.length >= 2 ? flow : defaultGuestFlow(polygon);
  return capturePlanAlongFlow(polygon, path);
}

/** 俯视图：边界轮廓 + 可选流线 + 站位编号。 */
function planViewSvg(plan: CapturePlan, polygon: AmapPoint[]): string {
  if (polygon.length < 3) return '';
  const lats = polygon.map(point => point.lat);
  const lngs = polygon.map(point => point.lng);
  const latMid = (Math.min(...lats) + Math.max(...lats)) / 2;
  const kx = metersPerDegreeLng(latMid);
  const width = Math.max(1, (Math.max(...lngs) - Math.min(...lngs)) * kx);
  const depth = Math.max(1, (Math.max(...lats) - Math.min(...lats)) * METERS_PER_DEGREE_LAT);
  const toXY = (lng: number, lat: number) => [
    ((lng - Math.min(...lngs)) * kx).toFixed(1),
    ((Math.max(...lats) - lat) * METERS_PER_DEGREE_LAT).toFixed(1),
  ];
  const outline = polygon.map(point => toXY(point.lng, point.lat).join(',')).join(' ');
  const radius = width / 90;
  const flowLine = plan.flow && plan.flow.length >= 2
    ? `<polyline class="flow" points="${plan.flow.map(p => toXY(p.lng, p.lat).join(',')).join(' ')}" fill="none" stroke="#4A7C59" stroke-width="0.5" stroke-dasharray="1.2 0.8"/>`
    : '';
  const marks = plan.stops.map(stop => {
    const [x, y] = toXY(stop.lng, stop.lat);
    return `<g class="stop"><circle cx="${x}" cy="${y}" r="${radius.toFixed(2)}"/><text x="${x}" y="${(Number(y) - radius * 1.6).toFixed(1)}" font-size="${(radius * 3).toFixed(2)}">${stop.index}</text></g>`;
  }).join('');
  const label = plan.mode === 'flow' ? '场地边界、主客流线与站位俯视图' : '场地边界与站位俯视图';
  return `<svg class="sheet-plan" viewBox="-2 -2 ${(width + 4).toFixed(2)} ${(depth + 4).toFixed(2)}" role="img" aria-label="${label}">
<polygon points="${outline}" fill="none" stroke="#355b4b" stroke-width="0.6"/>
${flowLine}
${marks}
</svg>`;
}

/**
 * 可打印的采集单：一页装得下站位编号、俯视图和每站的朝向。
 * 坐标按 GCJ-02（高德用的坐标系）原样印出，到现场照编号走。
 */
export function capturePlanSheetHtml(
  plan: CapturePlan,
  polygon: AmapPoint[],
  meta: { name: string; location?: string },
): string {
  const rows = plan.stops.map(stop =>
    `<tr><td>${stop.index}</td><td>${stop.compass} ${stop.bearing}°</td><td class="coord">${stop.lng.toFixed(6)}, ${stop.lat.toFixed(6)}</td></tr>`,
  ).join('');
  const where = [meta.name, meta.location].filter(Boolean).join(' · ');
  const isFlow = plan.mode === 'flow';
  const lede = isFlow
    ? `按编号沿主客流线走，每站${PHOTOS_PER_STOP_HINT}，相邻两张留三分之一重叠。镜头朝前进方向。`
    : `按编号沿边界走一圈，每站${PHOTOS_PER_STOP_HINT}，相邻两张留三分之一重叠。`;
  const stats = isFlow
    ? `<dt>场地范围</dt><dd>${plan.size.width} × ${plan.size.depth} m</dd>
<dt>流线长</dt><dd>${plan.flowLength ?? 0} m</dd>
<dt>站位数</dt><dd>${plan.stops.length}</dd>
<dt>共需</dt><dd>${plan.shots} 张</dd>`
    : `<dt>场地范围</dt><dd>${plan.size.width} × ${plan.size.depth} m</dd>
<dt>一圈周长</dt><dd>${plan.perimeter} m</dd>
<dt>站位数</dt><dd>${plan.stops.length}</dd>
<dt>共需</dt><dd>${plan.shots} 张</dd>`;
  const how = isFlow
    ? `<li>先从第 1 站起，沿流线走到最后一站，中途不跳点。</li>
<li>每站镜头朝前进方向；地面铺装、矮墙、入口各补一张近景。</li>
<li>拍完回到工作台，在这个入口上传素材提交重建。</li>
<li>禁止把高德瓦片、卫星截图当重建素材；须现场手机拍照或绕场视频。</li>`
    : `<li>先从第 1 站起，顺时针走到最后一站，中途不跳点。</li>
<li>每站镜头对准场地中心方向；地面铺装、矮墙、入口各补一张近景。</li>
<li>拍完回到工作台，在这个入口上传素材提交重建。</li>
<li>禁止把高德瓦片、卫星截图当重建素材；须现场手机拍照或绕场视频。</li>`;
  const videoHint = plan.preferVideo
    ? (isFlow
      ? `<p class="lede">这条流线 ${plan.flowLength ?? 0} 米，站距要拉到 ${plan.spacing} 米才走得完，重叠不够、重建容易糊。建议直接沿流线录一段视频（.mp4 / .mov）代替逐站拍照。</p>`
      : `<p class="lede">这块地一圈 ${plan.perimeter} 米，站距要拉到 ${plan.spacing} 米才走得完，重叠不够、重建容易糊。建议直接录一段绕场视频（.mp4 / .mov）代替逐站拍照。</p>`)
    : '';
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>${where} · 场地采集单</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
:root { color-scheme: light; }
body { margin: 32px auto; max-width: 820px; padding: 0 20px; font: 15px/1.75 -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif; color: #23281f; }
h1 { margin: 0 0 4px; font-size: 22px; font-weight: 650; letter-spacing: .01em; }
p.lede { margin: 0 0 24px; color: #6b7065; font-size: 14px; }
dl { display: grid; grid-template-columns: repeat(4, auto); gap: 0 28px; margin: 0 0 28px; font-size: 14px; }
dt { color: #6b7065; }
dd { margin: 0; font-variant-numeric: tabular-nums; }
svg.sheet-plan { width: 100%; height: auto; margin: 0 0 28px; }
svg.sheet-plan .stop circle { fill: #c2500f; stroke: #fff; stroke-width: .3; }
svg.sheet-plan .stop text { fill: #23281f; text-anchor: middle; }
table { width: 100%; border-collapse: collapse; font-size: 14px; }
th { text-align: left; font-weight: 600; color: #6b7065; padding-bottom: 6px; border-bottom: 1px solid #d9d6cc; }
td { padding: 7px 0; border-bottom: 1px solid #eeebe3; font-variant-numeric: tabular-nums; }
td.coord { color: #6b7065; }
ol.how { margin: 28px 0 0; padding-left: 20px; color: #4a4f45; font-size: 14px; }
@media print { body { margin: 12mm; } }
</style></head>
<body>
<h1>${where} · 场地采集单</h1>
<p class="lede">${lede}</p>
<dl>
${stats}
</dl>
${planViewSvg(plan, polygon)}
${videoHint}
<table><thead><tr><th>站</th><th>镜头朝向</th><th>坐标（GCJ-02）</th></tr></thead><tbody>${rows}</tbody></table>
<ol class="how">
${how}
</ol>
</body></html>`;
}

/** 导出文件名：去掉 Windows 不允许的字符，保留中文场地名。 */
export function capturePlanFileName(name: string): string {
  const safe = name.replace(/[\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
  return `${safe || '场地'}-采集单.html`;
}

/* ------------------------------------------------------------------ *
 * 扫描结果、场景坐标与尺度信息的检查与修正
 *
 * 3DGS 看着真实，不等于几何准确：上游给的点云可能尺度偏了、朝向不对，
 * 也可能根本没有真实米制。这里只做「能核对、能手改」的确定性计算，
 * 不做自动空间理解。场景落位与渲染在 three/splat-preview.ts 消费这些结果。
 * ------------------------------------------------------------------ */

export type ScanAxis = 'x' | 'y' | 'z';

/** 扫描落位后得到的米制外廓（x = 宽，z = 深，y = 高）。 */
export interface ScanExtent {
  width: number;
  depth: number;
  height: number;
}

export type CalibrationConfidence = 'ok' | 'coarse' | 'suspect';

/** 一次手动标定的依据：哪一轴、现场实测多少米、扫描里量到多少米。 */
export interface ScanScaleReference {
  axis: ScanAxis;
  knownMeters: number;
  measuredMeters: number;
}

export interface ScanScaleCalibration {
  /** 扫描米 → 真实米的倍数；1 表示上游就是真实米制。 */
  scale: number;
  reference: ScanScaleReference;
  /** 与「上游已是真实米制」的偏差百分比，正数表示扫描偏小。 */
  deviationPct: number;
  confidence: CalibrationConfidence;
  /** 给人看的一行结论，含误差提示。 */
  note: string;
}

/** 允许的缩放范围：低于 0.2 或高于 20 时基本是轴选错或量错，不做静默修正。 */
export const MIN_SCAN_SCALE = 0.2;
export const MAX_SCAN_SCALE = 20;

function roundOne(value: number): number {
  return Math.round(value * 10) / 10;
}

function roundTwo(value: number): number {
  return Math.round(value * 100) / 100;
}

/** 扫描外廓按轴取一段长度；缺高时退回水平最长边，避免出现 0。 */
export function scanSpanOnAxis(scan: ScanExtent, axis: ScanAxis): number {
  const value = axis === 'x' ? scan.width : axis === 'z' ? scan.depth : scan.height;
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * 已知一段真实长度 → 扫描比例。
 * 现场最容易拿到的是「场地宽 12 米」这类整段长度，和扫描的宽 / 深 / 高一一对应；
 * 不需要在点云里点两个点，也就没有拾取误差。
 */
export function calibrateScanScale(input: {
  axis: ScanAxis;
  knownMeters: number;
  scan: ScanExtent;
}): ScanScaleCalibration | null {
  const { axis, knownMeters, scan } = input;
  if (!Number.isFinite(knownMeters) || knownMeters <= 0.05 || knownMeters > 500) return null;
  const measuredMeters = scanSpanOnAxis(scan, axis);
  if (!(measuredMeters > 0.05)) return null;
  const raw = knownMeters / measuredMeters;
  const scale = Math.min(MAX_SCAN_SCALE, Math.max(MIN_SCAN_SCALE, raw));
  const clamped = scale !== raw;
  const deviationPct = roundOne((scale - 1) * 100);
  const abs = Math.abs(deviationPct);
  const confidence: CalibrationConfidence = clamped || abs > 40 ? 'suspect' : abs > 10 ? 'coarse' : 'ok';
  const axisLabel = axis === 'x' ? '东西向宽' : axis === 'z' ? '南北向深' : '高度';
  const sign = deviationPct > 0 ? '+' : '−';
  const note = clamped
    ? `按${axisLabel} ${roundOne(measuredMeters)} m ↔ 实测 ${roundOne(knownMeters)} m 算出比例 ${roundTwo(raw)}，超出可校准范围（${MIN_SCAN_SCALE}–${MAX_SCAN_SCALE}），可能轴向选错。`
    : confidence === 'ok'
      ? `比例 ${roundTwo(scale)}：扫描${axisLabel} ${roundOne(measuredMeters)} m 对应实测 ${roundOne(knownMeters)} m，偏差 ${sign}${abs}%。`
      : `比例 ${roundTwo(scale)}：扫描${axisLabel} ${roundOne(measuredMeters)} m 对应实测 ${roundOne(knownMeters)} m，偏差 ${sign}${abs}%，${confidence === 'suspect' ? '这一段可能不是同一段，建议复测另一条边交叉核对。' : '与上游米制差异较大，建议再测一条边复核。'}`;
  return {
    scale,
    reference: { axis, knownMeters: roundOne(knownMeters), measuredMeters: roundOne(measuredMeters) },
    deviationPct,
    confidence,
    note,
  };
}

export interface ScanInspection {
  status: 'ok' | 'warning' | 'error';
  /** 扫描相对场地壳体的宽 / 深偏差百分比。 */
  widthDeltaPct: number;
  depthDeltaPct: number;
  note: string;
}

/**
 * 扫描实测外廓 vs 场地壳体：两者差得越多，越说明扫描不是这块场地、
 * 或者扫描尺度没有真实米制。只做提示，不自动改场地尺寸。
 */
export function inspectScanAgainstSite(
  scan: ScanExtent | null | undefined,
  site: { width: number; depth: number },
): ScanInspection {
  const empty: ScanInspection = { status: 'ok', widthDeltaPct: 0, depthDeltaPct: 0, note: '扫描外廓不可用，保留场地尺寸。' };
  if (!scan || !(scan.width > 0.05) || !(scan.depth > 0.05) || !(site.width > 0.05) || !(site.depth > 0.05)) return empty;
  const widthDeltaPct = roundOne((scan.width / site.width - 1) * 100);
  const depthDeltaPct = roundOne((scan.depth / site.depth - 1) * 100);
  const worst = Math.max(Math.abs(widthDeltaPct), Math.abs(depthDeltaPct));
  const status: ScanInspection['status'] = worst > 35 ? 'error' : worst > 10 ? 'warning' : 'ok';
  const note = status === 'ok'
    ? `扫描 ${roundOne(scan.width)} × ${roundOne(scan.depth)} m 与场地 ${roundOne(site.width)} × ${roundOne(site.depth)} m 基本一致。`
    : `扫描 ${roundOne(scan.width)} × ${roundOne(scan.depth)} m 与场地 ${roundOne(site.width)} × ${roundOne(site.depth)} m 相差 ${roundOne(worst)}%，${status === 'error' ? '大概率不是同一块场地，需先标定或换场景。' : '建议标定后复核。'}`;
  return { status, widthDeltaPct, depthDeltaPct, note };
}

/* ------------------------- 地面基准面 ------------------------- */

export interface GroundNormal {
  x: number;
  y: number;
  z: number;
}

/**
 * 水平基准面：所有物件的落地参考。
 * `height` 是平面过 (0, y, 0) 的高度；法线朝上，允许轻微倾斜（三点定面）。
 */
export interface GroundPlane {
  y: number;
  normal: GroundNormal;
  definedBy: 'height' | 'points';
}

export const DEFAULT_GROUND_PLANE: GroundPlane = Object.freeze({
  y: 0,
  normal: Object.freeze({ x: 0, y: 1, z: 0 }),
  definedBy: 'height',
});

const UP = { x: 0, y: 1, z: 0 } as const;

function unitNormal(normal: GroundNormal): GroundNormal | null {
  const length = Math.hypot(normal.x, normal.y, normal.z);
  if (!Number.isFinite(length) || length < 1e-6) return null;
  const unit = { x: normal.x / length, y: normal.y / length, z: normal.z / length };
  // 法线只认朝上的那半边：朝下时翻过来，平面本身没有变化。
  return unit.y < 0 ? { x: -unit.x, y: -unit.y, z: -unit.z } : unit;
}

/** 给定高度（可带法线）。 */
export function groundFromHeight(y: number, normal: GroundNormal = UP): GroundPlane {
  const unit = unitNormal(normal) ?? UP;
  return { y: Number.isFinite(y) ? y : 0, normal: unit, definedBy: 'height' };
}

/** 手动三点定面：三个不共线的点决定一个平面；共线 / 重合时返回 null。 */
export function groundFromThreePoints(
  a: { x: number; y: number; z: number },
  b: { x: number; y: number; z: number },
  c: { x: number; y: number; z: number },
): GroundPlane | null {
  const ab = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
  const ac = { x: c.x - a.x, y: c.y - a.y, z: c.z - a.z };
  const normal = {
    x: ab.y * ac.z - ab.z * ac.y,
    y: ab.z * ac.x - ab.x * ac.z,
    z: ab.x * ac.y - ab.y * ac.x,
  };
  const unit = unitNormal(normal);
  if (!unit) return null;
  // 平面过 a：n·(p - a) = 0，整理出过 (0, y0, 0) 的高度。
  const y0 = a.y + (unit.x * a.x + unit.z * a.z) / unit.y;
  if (!Number.isFinite(y0)) return null;
  return { y: y0, normal: unit, definedBy: 'points' };
}

/** 基准面在某个水平位置的高度；水平面时就是 `y`。 */
export function groundHeightAt(ground: GroundPlane | null | undefined, x: number, z: number): number {
  if (!ground) return 0;
  const n = ground.normal;
  if (!Number.isFinite(x) || !Number.isFinite(z) || !(Math.abs(n.y) > 1e-6)) return ground.y;
  return ground.y - (n.x * x + n.z * z) / n.y;
}

/** 面与水平面的夹角，度；超过 8° 时界面应提示「场地是斜的」。 */
export function groundTiltDeg(ground: GroundPlane | null | undefined): number {
  if (!ground) return 0;
  const unit = unitNormal(ground.normal);
  if (!unit) return 0;
  return Math.round((Math.acos(Math.min(1, Math.max(0, unit.y))) * 180 / Math.PI) * 10) / 10;
}

/** 基准面的一行说明（含倾斜提示）。 */
export function groundPlaneNote(ground: GroundPlane | null | undefined): string {
  if (!ground) return '未定义基准面，物件按场地地面（y = 0）落地。';
  const tilt = groundTiltDeg(ground);
  const base = `基准面 ${ground.y.toFixed(2)} m`;
  if (tilt < 0.5) return `${base}（水平）`;
  return `${base}，倾斜 ${tilt}°${tilt > 8 ? '，斜面上物件需按位置取高差' : ''}`;
}

/* --------------------------- 地面锚点 --------------------------- */

export type AnchorKind = 'stage' | 'entrance' | 'custom';

/** 场地锚点：打在基准面上的落点，「舞台位」「入口」等。 */
export interface GroundAnchor {
  id: string;
  label: string;
  kind: AnchorKind;
  x: number;
  z: number;
}

export const ANCHOR_SNAP_RADIUS_M = 1.2;

/** 最近的锚点（带吸附半径）；没有落在半径内的就返回 null。 */
export function nearestAnchor(
  anchors: readonly GroundAnchor[] | null | undefined,
  x: number,
  z: number,
  radius = ANCHOR_SNAP_RADIUS_M,
): { anchor: GroundAnchor; distance: number } | null {
  if (!anchors?.length) return null;
  let best: { anchor: GroundAnchor; distance: number } | null = null;
  for (const anchor of anchors) {
    const distance = Math.hypot(anchor.x - x, anchor.z - z);
    if (distance > radius) continue;
    if (!best || distance < best.distance) best = { anchor, distance };
  }
  return best;
}

/** 锚点吸附：命中就返回锚点坐标，否则返回 null。 */
export function snapToAnchor(
  anchors: readonly GroundAnchor[] | null | undefined,
  x: number,
  z: number,
  radius = ANCHOR_SNAP_RADIUS_M,
): GroundAnchor | null {
  return nearestAnchor(anchors, x, z, radius)?.anchor ?? null;
}

/** 锚点 id：稳定、可读，不和已有 id 撞。 */
export function nextAnchorId(anchors: readonly GroundAnchor[]): string {
  let index = anchors.length + 1;
  const used = new Set(anchors.map(anchor => anchor.id));
  while (used.has(`anchor-${index}`)) index += 1;
  return `anchor-${index}`;
}

/* ----------------------- 模型落地校验 ----------------------- */

export interface LandableItem {
  id: string;
  position?: { x: number; z: number } | undefined;
  /** 相对本层地面的抬升（米）；悬空物件靠它浮起来。 */
  elevation?: number | undefined;
  height?: number | undefined;
  /** 模型原点在包围盒底面的偏移：底面原点给 0，中心原点给半高。 */
  baseOffsetM?: number | undefined;
}

export interface LandingCorrection {
  id: string;
  beforeY: number;
  afterY: number;
  deltaY: number;
}

/**
 * 一次性「落地」清单：把悬空 / 穿地的物件拉回基准面，Y 取「基准面高度 + 原点到底面的偏移」。
 * 只产出建议，不直接改布局——应用仍走编辑器的 onApply，撤销历史才不会被绕过。
 */
export function landingCorrections(
  items: readonly LandableItem[],
  ground: GroundPlane | null | undefined,
  options: { floorY?: number; toleranceM?: number } = {},
): LandingCorrection[] {
  const floorY = Number.isFinite(options.floorY) ? (options.floorY as number) : 0;
  const tolerance = Number.isFinite(options.toleranceM) ? (options.toleranceM as number) : 0.02;
  const corrections: LandingCorrection[] = [];
  for (const item of items) {
    const x = item.position?.x ?? 0;
    const z = item.position?.z ?? 0;
    const baseOffset = Number.isFinite(item.baseOffsetM) ? (item.baseOffsetM as number) : 0;
    const beforeY = floorY + (Number.isFinite(item.elevation) ? (item.elevation as number) : 0);
    const afterY = groundHeightAt(ground, x, z) + baseOffset;
    const deltaY = afterY - beforeY;
    if (Math.abs(deltaY) <= tolerance) continue;
    corrections.push({ id: item.id, beforeY, afterY, deltaY: roundTwo(deltaY) });
  }
  return corrections;
}

/** 把落地清单折回布局的修改（elevation 相对本层地面）。供 onApply 直接使用。 */
export function applyLanding(
  items: readonly LandableItem[],
  corrections: readonly LandingCorrection[],
  floorY = 0,
): Array<LandableItem & { elevation: number }> {
  const byId = new Map(corrections.map(correction => [correction.id, correction]));
  return items.map(item => {
    const correction = byId.get(item.id);
    return correction
      ? { ...item, elevation: roundTwo(correction.afterY - floorY) }
      : { ...item, elevation: item.elevation ?? 0 };
  });
}

/* --------------------------- 场景标定持久化 --------------------------- */

/**
 * 某个扫描场景的标定记录。按 assetId 存本机：换项目、刷新页面都还在，
 * 不改布局 schema，也不进云端场景线。
 */
export interface SiteCalibration {
  version: 1;
  assetId: string;
  scale: number;
  /** 绕世界 Y 轴的朝向修正，度。 */
  yawDeg: number;
  /** 扫描原点相对场地原点的水平平移，米；用来对齐两张平面的坐标系原点。 */
  origin: { x: number; z: number };
  ground: GroundPlane;
  anchors: GroundAnchor[];
  reference?: ScanScaleReference;
  updatedAt: number;
}

export const SITE_CALIBRATION_STORAGE_KEY = 'scendance.site-calibration.v1';

type CalibrationMap = Record<string, SiteCalibration>;

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

function readCalibrationMap(): CalibrationMap {
  const raw = storage()?.getItem(SITE_CALIBRATION_STORAGE_KEY);
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as CalibrationMap : {};
  } catch {
    return {};
  }
}

function normalizeAnchor(value: unknown): GroundAnchor | null {
  if (!value || typeof value !== 'object') return null;
  const anchor = value as Partial<GroundAnchor>;
  if (typeof anchor.id !== 'string' || !anchor.id) return null;
  if (!Number.isFinite(anchor.x) || !Number.isFinite(anchor.z)) return null;
  const kind: AnchorKind = anchor.kind === 'stage' || anchor.kind === 'entrance' ? anchor.kind : 'custom';
  return {
    id: anchor.id.slice(0, 48),
    label: typeof anchor.label === 'string' && anchor.label ? anchor.label.slice(0, 24) : '锚点',
    kind,
    x: anchor.x as number,
    z: anchor.z as number,
  };
}

function normalizeCalibration(value: unknown, assetId: string): SiteCalibration | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Partial<SiteCalibration>;
  const scale = typeof record.scale === 'number' && Number.isFinite(record.scale)
    ? Math.min(MAX_SCAN_SCALE, Math.max(MIN_SCAN_SCALE, record.scale))
    : 1;
  const yawDeg = typeof record.yawDeg === 'number' && Number.isFinite(record.yawDeg)
    ? ((record.yawDeg % 360) + 360) % 360
    : 0;
  const origin = {
    x: typeof record.origin?.x === 'number' && Number.isFinite(record.origin.x) ? roundTwo(record.origin.x) : 0,
    z: typeof record.origin?.z === 'number' && Number.isFinite(record.origin.z) ? roundTwo(record.origin.z) : 0,
  };
  const ground = record.ground && typeof record.ground === 'object'
    ? groundFromHeight(
        Number.isFinite(record.ground.y) ? record.ground.y : 0,
        record.ground.normal ?? UP,
      )
    : { ...DEFAULT_GROUND_PLANE };
  const anchors = Array.isArray(record.anchors)
    ? record.anchors.map(normalizeAnchor).filter((anchor): anchor is GroundAnchor => anchor !== null).slice(0, 24)
    : [];
  const reference = record.reference && typeof record.reference === 'object'
    && Number.isFinite(record.reference.knownMeters) && Number.isFinite(record.reference.measuredMeters)
    ? {
        axis: record.reference.axis === 'y' ? 'y' as const : record.reference.axis === 'z' ? 'z' as const : 'x' as const,
        knownMeters: record.reference.knownMeters as number,
        measuredMeters: record.reference.measuredMeters as number,
      }
    : undefined;
  return {
    version: 1,
    assetId,
    scale: roundTwo(scale) === 0 ? 1 : scale,
    yawDeg: Math.round(yawDeg * 10) / 10,
    origin,
    ground,
    anchors,
    ...(reference ? { reference } : {}),
    updatedAt: Number.isFinite(record.updatedAt) ? (record.updatedAt as number) : Date.now(),
  };
}

/** 没有记录时返回默认：比例 1、朝向 0、原点重合、水平基准面、无锚点。 */
export function defaultSiteCalibration(assetId: string): SiteCalibration {
  return { version: 1, assetId, scale: 1, yawDeg: 0, origin: { x: 0, z: 0 }, ground: { ...DEFAULT_GROUND_PLANE }, anchors: [], updatedAt: 0 };
}

export function readSiteCalibration(assetId: string): SiteCalibration | null {
  if (!assetId) return null;
  const map = readCalibrationMap();
  return normalizeCalibration(map[assetId], assetId);
}

export function writeSiteCalibration(record: SiteCalibration): void {
  const store = storage();
  if (!store || !record.assetId) return;
  const map = readCalibrationMap();
  map[record.assetId] = { ...record, version: 1, updatedAt: Date.now() };
  try {
    store.setItem(SITE_CALIBRATION_STORAGE_KEY, JSON.stringify(map));
  } catch {
    // 配额满 / 隐私模式：标定值仍在本次会话里生效，不因存储失败打断操作。
  }
}

export function clearSiteCalibration(assetId: string): void {
  const store = storage();
  if (!store || !assetId) return;
  const map = readCalibrationMap();
  delete map[assetId];
  try {
    store.setItem(SITE_CALIBRATION_STORAGE_KEY, JSON.stringify(map));
  } catch {
    // 同上：清不掉也不该抛错。
  }
}

/** 标定卡片的一行摘要：比例、朝向、基准面、锚点数与误差提示。 */
export function calibrationSummary(record: SiteCalibration | null): string {
  if (!record) return '未标定：扫描按 1:1 米制放置。';
  const pieces = [
    `比例 ${roundTwo(record.scale)}（偏差 ${record.scale >= 1 ? '+' : '−'}${roundOne(Math.abs(record.scale - 1) * 100)}%）`,
    record.yawDeg ? `朝向 ${roundOne(record.yawDeg)}°` : '朝向 0°',
    record.origin.x || record.origin.z ? `原点 (${roundTwo(record.origin.x)}, ${roundTwo(record.origin.z)}) m` : '原点重合',
    groundPlaneNote(record.ground),
    `${record.anchors.length} 个锚点`,
  ];
  return pieces.join(' · ');
}
