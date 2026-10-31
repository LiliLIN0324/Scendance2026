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
