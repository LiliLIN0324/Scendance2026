const gardenReport = 'https://feng.ifeng.com/c/8xl12iv5JVJ';
const hangzhouReport = 'https://ori.hangzhou.com.cn/ornews/content/2026-11/03/content_9366688.htm';
const traveler = 'https://hk.trip.com/moments/detail/hangzhou-14-156687742/';

export const survey = 'https://zjjcmspublic.oss-cn-hangzhou-zwynet-d01-a.internet.cloud.zj.gov.cn/jcms_files/jcms1/web3028/site/attach/0/130d29cd6c7e4a758eca7b4cde84df84.pdf';
export const existingPlan = 'https://www.fx361.com/page/2022/0211/13999637.shtml';

export const photoSources = [
  { title: '杭州植物园供稿 · 四类展陈图集', note: '看「主会场」段落。品种菊、菊艺装置、生态阳台、微花园分组。', url: gardenReport },
  { title: '浙江在线 · 记者陈天怀开幕日组图', note: '7 张记者照片及一段视频。包括《东坡打卡记》和现场陈列。', url: 'https://zjnews.zjol.com.cn/yc/qmt/202611/t20261103_32006615.shtml?mode=m2pc' },
  { title: '杭州网 · 从鱼乐园长廊到玉泉园内', note: '把开幕现场组图与鱼乐园长廊、晴空细雨池、古珍珠泉的文字说明对照。', url: hangzhouReport },
  { title: '杭州日报 · 玉泉鱼跃主会场', note: '开幕日摄影与展区说明。确认三处品种菊展点的名称。', url: 'https://hznews.hangzhou.com.cn/wenti/content/2026-11/04/content_9366713.htm' },
  { title: '都市快报 · 从北门走到玉泉', note: '报道沿途菊艺布置及《摩登都市》，可做外围观展动线参照。', url: 'https://hznews.hangzhou.com.cn/chengshi/content/2026-11/04/content_9366749.htm' },
  { title: '潮新闻 · 四类主会场展区', note: '展陈现场报道。部分主题也见于其他媒体，按出处交叉核对。', url: 'https://tidenews.com.cn/news.html?id=3604498' },
  { title: '玉泉鱼跃 · 淳安园室内布置', note: '人文园林作品报道的转载。重点看入口、厅内花艺和取景框，先核对配图再引用。', url: 'https://www.sohu.com/a/1097036369_121123883' },
  { title: '游客机位 · 玉泉亭廊、鱼池与室内布展', note: '11 月 8 日游记。优先看首图及第 4–7 张，文字给出具体机位。', url: traveler },
  { title: '游客记录 · 展区分布和南门路线', note: '5 张图。展区分布用于找路，位置和尺寸依实地核对。', url: 'https://hk.trip.com/moments/detail/hangzhou-14-156417108/' },
  { title: '浙江在线 · 雨天开幕现场', note: '同届开幕视频，从雨天画面观察人流和临时布置的关系。', url: 'https://zjnews.zjol.com.cn/zjnews/202611/t20261104_32007236.shtml' },
] as const;

export const points = [
  { id: '01', label: '鱼乐园长廊', note: '调查表将题匾定位在主池南面亭廊。开幕报道确认长廊有品种菊，花盆逐件位置待查。', sources: [photoSources[2], photoSources[7]] },
  { id: '02', label: '晴空细雨池', note: '调查表记录南北两池，各 7.2 × 6.2 米。原图的几处小池无法可靠对号，暂不落图。', sources: [photoSources[0], photoSources[3]] },
  { id: '03', label: '古珍珠泉', note: '位于主池西侧内园，池体 6.1 × 2.2 米。开幕报道确认泉畔有品种菊，池体在原图上的具体落点待核。', sources: [photoSources[2], photoSources[3]] },
] as const;

export type Point = { x: number; y: number };
export const site = { width: 132, height: 113 };

// Pixel picks from figure 1 at its published size of 1772 × 661.
// The rectangular main pool is the sole length reference. Its long and short
// edges in the image agree at roughly 2.73 px/m using the survey dimensions.
export function fromSource(x: number, y: number): Point {
  return { x: (x - 1330) / 2.73, y: (y - 70) / 2.73 };
}

const trace = (coordinates: readonly (readonly [number, number])[]) => coordinates.map(([x, y]) => fromSource(x, y));

export const mainPool = trace([[1527, 215], [1601, 230], [1592, 271], [1518, 256]]);
export const hallMarker = fromSource(1558, 281);

export const traces = [
  { id: 'south-hall', kind: 'hall', points: trace([[1518, 256], [1592, 271], [1589, 290], [1513, 275]]) },
  { id: 'west-hall', kind: 'hall', points: trace([[1509, 208], [1527, 215], [1518, 256], [1501, 252]]) },
  { id: 'east-hall', kind: 'hall', points: trace([[1592, 271], [1610, 275], [1603, 310], [1586, 307]]) },
  { id: 'north-court-west', kind: 'line', points: trace([[1481, 82], [1458, 200], [1475, 203], [1464, 258], [1501, 266]]) },
  { id: 'north-court-east', kind: 'line', points: trace([[1522, 90], [1547, 96], [1544, 112], [1599, 123], [1585, 190], [1578, 211]]) },
  { id: 'inner-court', kind: 'line', points: trace([[1488, 94], [1537, 104], [1519, 195], [1469, 185], [1488, 94]]) },
  { id: 'west-building-edge', kind: 'line', points: trace([[1441, 220], [1437, 262], [1426, 281], [1509, 297], [1515, 275]]) },
  { id: 'south-outline', kind: 'line', points: trace([[1426, 282], [1421, 314], [1415, 334], [1507, 351], [1513, 324], [1518, 296]]) },
  { id: 'east-path', kind: 'path', points: trace([[1683, 139], [1663, 148], [1654, 155], [1655, 170], [1656, 188], [1650, 205], [1634, 219]]) },
  { id: 'southeast-path', kind: 'path', points: trace([[1650, 235], [1644, 248], [1634, 253], [1626, 261], [1620, 281], [1613, 295], [1605, 303], [1609, 315], [1604, 333]]) },
] as const;

export const boothTypes = [
  { id: 'desk', label: '服务台', width: 2, height: 2, color: '#235b52' },
  { id: 'stall', label: '标准摊位', width: 3, height: 3, color: '#245d82' },
  { id: 'double', label: '连排摊位', width: 6, height: 3, color: '#6c5481' },
  { id: 'flower', label: '花坛', width: 4, height: 2, color: '#815b2d' },
  { id: 'sign', label: '导视', width: 1, height: 0.5, color: '#315a64' },
] as const;
export type BoothType = (typeof boothTypes)[number]['id'];
export type Booth = { id: number; type: BoothType; x: number; y: number; rotated: boolean };
type Rect = Point & { width: number; height: number };

export function boothBox(booth: Booth): Rect {
  const spec = boothTypes.find(type => type.id === booth.type)!;
  const width = booth.rotated ? spec.height : spec.width;
  const height = booth.rotated ? spec.width : spec.height;
  return { x: booth.x - width / 2, y: booth.y - height / 2, width, height };
}

export function placeAt(booth: Booth, point: Point): Booth {
  const { width, height } = boothBox(booth);
  return {
    ...booth,
    x: Math.min(site.width - width / 2, Math.max(width / 2, Math.round(point.x * 2) / 2)),
    y: Math.min(site.height - height / 2, Math.max(height / 2, Math.round(point.y * 2) / 2)),
  };
}

function overlaps(a: Rect, b: Rect) {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

export function boothNotice(booth: Booth, booths: readonly Booth[]): string {
  const a = boothBox(booth);
  const corners = [
    { x: a.x, y: a.y }, { x: a.x + a.width, y: a.y },
    { x: a.x + a.width, y: a.y + a.height }, { x: a.x, y: a.y + a.height },
  ];
  const poolAxes = mainPool.slice(0, 2).map((p, i) => ({ x: mainPool[i + 1].y - p.y, y: p.x - mainPool[i + 1].x }));
  if ([{ x: 1, y: 0 }, { x: 0, y: 1 }, ...poolAxes].every(axis => {
    const a = corners.map(point => point.x * axis.x + point.y * axis.y);
    const b = mainPool.map(point => point.x * axis.x + point.y * axis.y);
    return Math.min(...a) < Math.max(...b) && Math.min(...b) < Math.max(...a);
  })) return '与已转绘水面重叠';
  if (booths.some(other => other.id !== booth.id && overlaps(a, boothBox(other)))) return '与其他摊位重叠';
  return '';
}

export const initialBooths: Booth[] = [];

export function readBooths(value: string | null): Booth[] {
  if (value === null) return initialBooths;
  const stored: unknown = JSON.parse(value);
  if (!Array.isArray(stored) || stored.length > 100) return initialBooths;
  const ids = new Set<number>();
  const booths: Booth[] = [];
  for (const item of stored) {
    if (!item || !Number.isSafeInteger(item.id) || item.id < 1 || ids.has(item.id) ||
      !boothTypes.some(type => type.id === item.type) || !Number.isFinite(item.x) || !Number.isFinite(item.y) ||
      typeof item.rotated !== 'boolean') return initialBooths;
    ids.add(item.id);
    booths.push(placeAt(item, item));
  }
  return booths;
}
