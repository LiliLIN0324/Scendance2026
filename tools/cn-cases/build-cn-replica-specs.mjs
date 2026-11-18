/**
 * 生成 `frontend/components/room-organizer/lib/replica-specs-cn.ts`。
 *
 * 2026-11-18 用户：「我们的官网也有很多中国的案例，尝试按照海外案例的逻辑去做做看」，
 * 随后：「我的官网已经描过轮廓线了，不用再搞一次」。
 * 所以这里**只复用官网已经描好的数据**，不重新描图：
 * - `assets/site-cases.mjs`：官网 4 个「地图试排」案例的 tile / cite / seeds（区块、物料、流线、节点）；
 * - `assets/site-activity-cases.mjs` / `assets/site-inspiration-maps.mjs`：其余案例已描好的场馆轮廓
 *   （existingAreas）与卫星瓦片。
 *
 * 换算口径（与 assets/site-cases.mjs 的 lonLat/groundScale 逐字一致）：
 * - 官网坐标是「该瓦片左上角起算的瓦片像素」，不是米；
 * - 米/像素 = 2πR·cos(锚点纬度) / (256·2^z)；
 * - 工作台平面是 ENU（x 东、y 北），官网 y 向南，故平面 y 取地理差值（向北为正）；
 * - 官网用 WGS-84 卫星图（ArcGIS/OSM），工作台锚点写 GCJ-02，故锚点过一次 wgs84→gcj02；
 *   局部几何按米平移，不随经纬度偏移变形。
 *
 * 有 seeds 的 4 案：原样搬区块/物料/流线。
 * 只有轮廓的其它案：轮廓原样搬成场地参照区；场外集结区、导视、入场线、待核入口
 * 按轮廓**最长边的中点**派生，并写明「长边不必然是实际门位」——这是起手位，不是主办方门位。
 *
 * 运行：node tools/cn-cases/build-cn-replica-specs.mjs
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
const OUT = resolve(ROOT, 'frontend/components/room-organizer/lib/replica-specs-cn.ts');

const EARTH = 6378137;

/** 直接读官网数据（纯数据模块，去掉 export 后求值，避免复制粘贴走样）。 */
function loadSiteData(relativePath, exportName) {
  const text = readFileSync(resolve(ROOT, relativePath), 'utf8');
  const stripped = text.replace(new RegExp(`export const ${exportName}\\s*=`), 'return');
  return new Function(stripped)();
}

const activityCases = loadSiteData('assets/site-activity-cases.mjs', 'activityCases');
const researchMaps = loadSiteData('assets/site-inspiration-maps.mjs', 'researchMaps');

/** 瓦片像素 → 经纬度（assets/site-cases.mjs 的 lonLat）。 */
function lngLatOf([level, col, row], x, y) {
  const span = 256 * 2 ** level;
  return {
    lng: ((col * 256 + x) / span) * 360 - 180,
    lat: (Math.atan(Math.sinh(Math.PI * (1 - (2 * (row * 256 + y)) / span))) * 180) / Math.PI,
  };
}

/** WGS-84 → GCJ-02（与 frontend/.../lib/geo-coords.ts 同一套算法，仅此处离线用）。 */
function wgs84ToGcj02(lng, lat) {
  const a = 6378245.0;
  const ee = 0.00669342162296594323;
  if (lng < 72.004 || lng > 137.8347 || lat < 0.8293 || lat > 55.8271) return { lng, lat };
  const transformLat = (x, y) => {
    let ret = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
    ret += ((20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0) / 3.0;
    ret += ((20.0 * Math.sin(y * Math.PI) + 40.0 * Math.sin((y / 3.0) * Math.PI)) * 2.0) / 3.0;
    ret += ((160.0 * Math.sin((y / 12.0) * Math.PI) + 320 * Math.sin((y * Math.PI) / 30.0)) * 2.0) / 3.0;
    return ret;
  };
  const transformLng = (x, y) => {
    let ret = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
    ret += ((20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0) / 3.0;
    ret += ((20.0 * Math.sin(x * Math.PI) + 40.0 * Math.sin((x / 3.0) * Math.PI)) * 2.0) / 3.0;
    ret += ((150.0 * Math.sin((x / 12.0) * Math.PI) + 300.0 * Math.sin((x / 30.0) * Math.PI)) * 2.0) / 3.0;
    return ret;
  };
  let dLat = transformLat(lng - 105.0, lat - 35.0);
  let dLng = transformLng(lng - 105.0, lat - 35.0);
  const radLat = (lat / 180.0) * Math.PI;
  let magic = Math.sin(radLat);
  magic = 1 - ee * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  dLat = (dLat * 180.0) / (((a * (1 - ee)) / (magic * sqrtMagic)) * Math.PI);
  dLng = (dLng * 180.0) / ((a / sqrtMagic) * Math.cos(radLat) * Math.PI);
  return { lng: lng + dLng, lat: lat + dLat };
}

const round = (n) => Math.round(n * 100) / 100;
const round6 = (n) => Math.round(n * 1e6) / 1e6;

/** 官网 seed 物品 → 工作台物料模板（尺寸一律用官网给的宽×深）。 */
function templateFor(name) {
  if (name.includes('展台')) return 'booth-2x2';
  if (name.includes('帐篷')) return 'oneplan:scale:tent';
  if (name.includes('服务台')) return 'oneplan:icon:information-point';
  if (name.includes('导视')) return 'oneplan:icon:information-point';
  if (name.includes('护栏')) return 'oneplan:icon:stanchion';
  if (name.includes('花箱')) return 'oneplan:scale:market-stall';
  if (name.includes('座椅') || name.includes('椅')) return 'oneplan:scale:bench';
  throw new Error(`未映射的官网物料：${name}`);
}

const ZONE_STYLE = {
  等候: { semantic: 'queue', color: '#bca783' },
  签到: { semantic: 'checkin', color: '#bca783' },
  展陈: { semantic: 'reserved', color: '#8d9b62' },
  服务: { semantic: 'reserved', color: '#bca783' },
};

function zoneStyleFor(name) {
  if (name.includes('签到')) return ZONE_STYLE['签到'];
  if (name.includes('等候') || name.includes('集结')) return ZONE_STYLE['等候'];
  if (name.includes('展陈') || name.includes('展示')) return ZONE_STYLE['展陈'];
  return ZONE_STYLE['服务'];
}

/** 把官网瓦片像素环换算成「以锚点为原点的 ENU 米」环。 */
function ringToPlan(tile, anchorWgs, ring) {
  return ring.map(([x, y]) => {
    const p = lngLatOf(tile, x, y);
    return [
      round((p.lng - anchorWgs.lng) * (111320 * Math.cos((anchorWgs.lat * Math.PI) / 180))),
      round((p.lat - anchorWgs.lat) * 111132.92),
    ];
  });
}

function ringCentroidWgs(tile, ring) {
  let sx = 0;
  let sy = 0;
  let slng = 0;
  let slat = 0;
  for (const [x, y] of ring) {
    const p = lngLatOf(tile, x, y);
    sx += x;
    sy += y;
    slng += p.lng;
    slat += p.lat;
  }
  void sx;
  void sy;
  return { lng: slng / ring.length, lat: slat / ring.length };
}

function pointInRing([x, y], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * 轮廓最长边中点 → 场外集结区 + 导视 + 入场线 + 待核入口。
 * 只做「贴着这栋建筑最长的那个立面」这一件事；不声称那是真门位。
 */
function facadeSkeleton(ring) {
  let best = null;
  for (let i = 0; i < ring.length; i += 1) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (!best || len > best.len) best = { a, b, len };
  }
  const { a, b, len } = best;
  const mx = (a[0] + b[0]) / 2;
  const my = (a[1] + b[1]) / 2;
  let ux = (b[0] - a[0]) / len;
  let uy = (b[1] - a[1]) / len;
  // 法线两个方向里，取「离开轮廓」的那一个。
  let px = -uy;
  let py = ux;
  if (pointInRing([mx + px * 5, my + py * 5], ring)) {
    px = -px;
    py = -py;
    ux = -ux;
    uy = -uy;
  }
  const w = Math.min(48, Math.max(12, len * 0.4));
  const d = 12;
  const offset = 6;
  const rect = [
    [mx + ux * (w / 2) + px * offset, my + uy * (w / 2) + py * offset],
    [mx - ux * (w / 2) + px * offset, my - uy * (w / 2) + py * offset],
    [mx - ux * (w / 2) + px * (offset + d), my - uy * (w / 2) + py * (offset + d)],
    [mx + ux * (w / 2) + px * (offset + d), my + uy * (w / 2) + py * (offset + d)],
  ].map(([x, y]) => [round(x), round(y)]);
  return {
    zone: rect,
    signAt: [round(mx + px * 3), round(my + py * 3)],
    route: [
      [round(mx + px * (offset + d + 8)), round(my + py * (offset + d + 8))],
      [round(mx + px * 1.5), round(my + py * 1.5)],
    ],
    nodeAt: [round(mx + px * 1.5), round(my + py * 1.5)],
    frame: {
      origin: [round(mx + px * 1.5), round(my + py * 1.5)],
      normal: [round(px * 1000) / 1000, round(py * 1000) / 1000],
      lateral: [round(ux * 1000) / 1000, round(uy * 1000) / 1000],
    },
  };
}

/** 顶点均值（几何形心）。 */
function centroidOf(points) {
  const sx = points.reduce((sum, p) => sum + p[0], 0);
  const sy = points.reduce((sum, p) => sum + p[1], 0);
  return [round(sx / points.length), round(sy / points.length)];
}

/** 点集的轴对齐包围环（顺时针）。 */
function bboxRing(points) {
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
}

/** 有官网 seed 的案：入口取已有流线终点，法线取「离开整套几何形心」的方向。 */
function seededFrame(spec) {
  const route = spec.routes[0];
  const last = route.points[route.points.length - 1];
  const pts = [
    ...spec.zones.flatMap((z) => z.polygon),
    ...spec.facilities.map((f) => [f.placement.x, f.placement.y]),
  ];
  const c = centroidOf(pts);
  let nx = last[0] - c[0];
  let ny = last[1] - c[1];
  const len = Math.hypot(nx, ny) || 1;
  nx = round((nx / len) * 1000) / 1000;
  ny = round((ny / len) * 1000) / 1000;
  return { origin: last, normal: [nx, ny], lateral: [-ny, nx] };
}

/**
 * 补全到「整套案」门槛：分区≥3、物料≥5、流线≥2（人行+后勤）、节点≥2（入口+后勤口）。
 * 新增内容一律以「拟设/拟放」命名，位置从入口立面或场地形心派生，并写进 locationNote。
 * 不声称门位：入口本来就没有实测依据，定位属起手位。
 */
function completeSpec(spec, frame, ring) {
  const [ex, ey] = frame.origin;
  const [nx, ny] = frame.normal;
  const [ux, uy] = frame.lateral;
  const at = (fwd, lat) => [round(ex + nx * fwd + ux * lat), round(ey + ny * fwd + uy * lat)];
  const added = [];

  if (!spec.zones.some((z) => z.name.includes('安检'))) {
    spec.zones.push({
      name: '拟设 · 安检区',
      semantic: 'checkin',
      color: '#bca783',
      opacity: 0.28,
      polygon: [at(2, 7), at(2, -7), at(-2.5, -7), at(-2.5, 7)],
    });
    added.push('安检区');
  }

  const addFacility = (templateId, name, width, depth, fwd, lat) => {
    if (spec.facilities.some((f) => f.name === name)) return;
    const [x, y] = at(fwd, lat);
    spec.facilities.push({
      templateId,
      name,
      size: { width, depth },
      placement: { kind: 'single', x, y, rot: 0 },
    });
    added.push(name.replace('拟放 · ', ''));
  };
  addFacility('oneplan:icon:security-checkpoint', '拟放 · 安检棚', 2, 2, 0.5, 0);
  addFacility('oneplan:icon:information-point', '拟放 · 服务台', 1.8, 0.8, -6, 6);
  addFacility('oneplan:icon:first-aid-point', '拟放 · 医疗点', 3, 3, -14, -12);
  // 饮水点与第二导视一律推到立面外侧 8 m（往里推会落在建筑轮廓里，2026-11-18 对账发现）。
  addFacility('oneplan:icon:water-refill-point', '拟放 · 饮水点', 1, 1, 8, 16);
  addFacility('oneplan:icon:information-point', '拟放 · 导视牌 B', 1.2, 0.5, 8, -18);

  if (!spec.nodes.some((n) => Math.hypot(n.x - ex, n.y - ey) < 4)) {
    spec.nodes.push({ name: '拟设 · 观众入口', kind: 'both', x: ex, y: ey });
    added.push('观众入口');
  }

  const far = ring.reduce(
    (best, p) => (Math.hypot(p[0] - ex, p[1] - ey) > Math.hypot(best[0] - ex, best[1] - ey) ? p : best),
    ring[0],
  );
  if (!spec.nodes.some((n) => Math.hypot(n.x - far[0], n.y - far[1]) < 4)) {
    spec.nodes.push({ name: '待核 · 后勤口', kind: 'both', x: far[0], y: far[1] });
    added.push('后勤口');
  }

  if (!spec.routes.some((r) => r.name.includes('后勤'))) {
    const dest = centroidOf(spec.zones.flatMap((z) => z.polygon));
    if (Math.hypot(dest[0] - far[0], dest[1] - far[1]) > 3) {
      spec.routes.push({
        name: '拟设 · 后勤补给线',
        kind: 'service',
        carrier: 'trolley',
        color: '#8fa3b8',
        widthM: 4,
        points: [[far[0], far[1]], dest],
      });
      added.push('后勤补给线');
    }
  }

  if (spec.zones.length < 3) {
    spec.zones.push({
      name: '拟设 · 后勤集货区',
      semantic: 'loading',
      color: '#8fa3b8',
      opacity: 0.25,
      polygon: [
        [round(far[0] - 5), round(far[1] - 4)],
        [round(far[0] + 5), round(far[1] - 4)],
        [round(far[0] + 5), round(far[1] + 4)],
        [round(far[0] - 5), round(far[1] + 4)],
      ],
    });
    added.push('后勤集货区');
  }

  if (added.length) {
    spec.locationNote +=
      '另按入口立面与场地形心补了' + added.join('、') + '——这些是起手位，不是主办方公布的位置。';
  }
  return spec;
}

/** 官网「地图试排」4 案：区块/物料/流线原样搬。 */
const SEEDED_CASES = [
  {
    slug: 'cn-yuquan-chrysanthemum',
    title: '杭州植物园菊花展',
    category: '花卉展',
    region: '浙江 · 杭州',
    sourceName: '杭州网 · 第十二届杭州菊花艺术展',
    refLink: 'https://ori.hangzhou.com.cn/ornews/content/2026-11/03/content_9366688.htm',
    tile: [19, 437074, 215874],
    cite: [120.11608, 30.25723],
    existing: { name: '玉泉主池可辨水面', semantic: 'reserved', polygon: [[451, 225], [544, 245], [531, 290], [438, 269]] },
    seeds: [
      { kind: 'area', name: '拟设 · 展陈区', points: [[448, 282], [514, 297], [510, 312], [445, 298]] },
      { kind: 'item', name: '拟放 · 展台 A', width: 3, depth: 1.4, angle: 12, points: [[474, 296]] },
      { kind: 'line', name: '拟设 · 换花线', points: [[343, 314], [389, 324], [426, 334], [452, 323], [468, 309]] },
      { kind: 'item', name: '拟放 · 导视牌', width: 0.7, depth: 0.5, points: [[423, 329]] },
    ],
  },
  {
    slug: 'cn-waic-2026',
    title: 'WAIC 2026 世界人工智能大会',
    category: '科技大会',
    region: '上海 · 浦东',
    sourceName: '上海市政府 · WAIC 2026',
    refLink: 'https://www.shanghai.gov.cn/nw15343/20260722/4514c99cfd364c3ba7d1b81790a09163.html',
    tile: [18, 219533, 107150],
    cite: [121.48548, 31.18451],
    existing: { name: '世博展览馆可见屋顶', semantic: 'indoor', polygon: [[187, 389], [745, 288], [816, 710], [264, 812]] },
    seeds: [
      { kind: 'area', name: '拟设 · 等候区', points: [[276, 284], [363, 269], [367, 291], [280, 307]] },
      { kind: 'item', name: '拟放 · 导视牌', width: 0.7, depth: 0.5, points: [[372, 293]] },
      { kind: 'area', name: '拟设 · 服务区', points: [[456, 276], [500, 269], [506, 287], [462, 294]] },
      { kind: 'line', name: '拟设 · 观众动线', points: [[257, 327], [341, 314], [398, 303], [445, 295], [471, 295]] },
      { kind: 'item', name: '拟放 · 服务台', width: 2, depth: 0.8, angle: 345, points: [[486, 283]] },
    ],
  },
  {
    slug: 'cn-keqiao-convention-center',
    title: '绍兴国际会展中心',
    category: '场馆空间',
    region: '浙江 · 绍兴',
    sourceName: '中国纺织工业联合会 · 柯桥纺博会',
    refLink: 'https://www.cntac.org.cn/zixun/hangye/202611/t20261106_4424820.html',
    tile: [17, 109414, 54033],
    cite: [120.516063, 30.104293],
    derivedRoute: true,
    existing: {
      name: '展馆建筑外轮廓',
      semantic: 'indoor',
      polygon: [
        [-26.1, -83.0], [-49.7, 17.3], [-44.4, 19.2], [-50.3, 45.2], [55.9, 71.4],
        [38.1, 146.9], [244.1, 195.2], [261.3, 120.9], [297.7, 129.1], [304.8, 102.3],
        [312.1, 103.9], [339.5, -7.1], [277.7, -10.9], [279.6, -20.4], [219.1, -25.4],
        [221.0, -34.8], [159.7, -39.3], [162.1, -48.8], [98.7, -53.7], [102.3, -63.7],
        [40.7, -68.3], [42.2, -77.4], [-26.1, -83.0],
      ],
    },
    seeds: [
      { kind: 'area', name: '拟设 · 等候区', points: [[-113, 47], [-69, 57], [-76, 83], [-119, 73]] },
      { kind: 'item', name: '拟放 · 导视牌', width: 1.2, depth: 0.6, angle: 14, points: [[-61, 73]] },
    ],
  },
  {
    slug: 'cn-yanguan-tide-music',
    title: '盐官古城 · 潮乐之城',
    category: '文旅节庆',
    region: '浙江 · 海宁',
    sourceName: '太合音乐 · 盐官大潮季',
    refLink: 'https://www.tahemusic.cn/news/2221',
    tile: [18, 218844, 107806],
    cite: [120.53689, 30.412482],
    existing: null,
    seeds: [
      { kind: 'area', name: '拟设 · 签到等候区', points: [[72.83, 193.39], [110.76, 193.39], [110.76, 213.82], [72.83, 213.82]] },
      { kind: 'line', name: '拟设 · 接驳步行引导', points: [[65.53, 96.37], [66.99, 131.38], [68.45, 172.97], [45.83, 192.66]] },
      { kind: 'item', name: '拟放 · 导视牌', width: 0.7, depth: 0.5, points: [[46.56, 194.85]] },
      { kind: 'label', name: '待核 · 入口与接驳点', points: [[115.87, 213.82]] },
    ],
  },
];

/**
 * 只有官网描好轮廓的其余案：轮廓原样搬，场外起手位按最长边派生。
 * 标题/分类/来源逐字取自 assets/site-inspiration.mjs 与 site-activity-cases.mjs。
 */
const OUTLINE_CASES = [
  {
    slug: 'cn-canton-fair-139',
    title: '第139届广交会',
    category: '产业展会',
    region: '广东 · 广州',
    sourceName: '第139届广交会进口展参展手册',
    refLink: 'https://cmsfile.cantonfair.org.cn/fileserver/cms/2026-03/202603131141324132894.pdf',
    tile: activityCases.canton.tile,
    cite: activityCases.canton.cite.split(',').map(Number),
    outline: activityCases.canton.existingAreas[0],
    outlineName: '广交会展馆地块外轮廓',
  },
  {
    slug: 'cn-ciie-9',
    title: '第九届中国国际进口博览会',
    category: '产业展会',
    region: '上海 · 虹桥',
    sourceName: '进博会 · 展务服务流程',
    refLink:
      'https://www.ciie.org/resource/static/zbh/default/assets-2025/download/PDF/CIIE2026ExhibitionServiceFlow%28C%29.pdf',
    tile: activityCases.ciie.tile,
    cite: activityCases.ciie.cite.split(',').map(Number),
    outline: activityCases.ciie.existingAreas[0],
    outlineName: '国家会展中心建筑外轮廓',
  },
  {
    slug: 'cn-baima-20',
    title: '第二十届杭州文博会',
    category: '文化展会',
    region: '浙江 · 杭州',
    sourceName: '杭州网 · 第二十届杭州文博会',
    refLink: 'https://z.hangzhou.com.cn/2026/hzwhcycyblh/index.html',
    tile: researchMaps.baima.tile,
    outline: researchMaps.baima.existingAreas[0],
    outlineName: '白马湖会展中心 A 馆外轮廓',
  },
  {
    slug: 'cn-aosen-music-festival',
    title: '2026 奥森计划 · 漾音乐节',
    category: '音乐节',
    region: '北京 · 奥森南园',
    sourceName: '北京市文旅局 · 营业性演出许可',
    refLink: 'https://banshi.whlyj.beijing.gov.cn/publish/7762441938632923.pdf',
    tile: researchMaps.aosen.tile,
    outline: researchMaps.aosen.existingAreas[0],
    outlineName: '露天剧场草坪轮廓',
  },
  {
    slug: 'cn-wuzhen-internet-light',
    title: '2026 乌镇「互联网之光」博览会',
    category: '科技大会',
    region: '浙江 · 桐乡乌镇',
    sourceName: '乌镇峰会 · 招展公告',
    refLink: 'https://www.zjwx.gov.cn/col/col1677996/art/2026/art_b6cac5708de74cac83c941115ea2f8f1.html',
    tile: researchMaps.wuzhen.tile,
    outline: researchMaps.wuzhen.existingAreas[0],
    outlineName: 'A / B 馆组团外轮廓',
  },
  {
    slug: 'cn-yiwu-fair-31',
    title: '第31届义博会 · 出口商品展',
    category: '产业展会',
    region: '浙江 · 义乌',
    sourceName: '义博会 · 参展手册',
    refLink: 'https://www.yiwufair.com/Views/ybhh/sys/202503/866227161330696.pdf',
    tile: researchMaps.yiwu.tile,
    outline: researchMaps.yiwu.existingAreas[0],
    outlineName: '义乌国际博览中心外轮廓',
  },
  {
    slug: 'cn-plastics-expo-27',
    title: '第二十七届中国塑料博览会',
    category: '产业展会',
    region: '浙江 · 余姚',
    sourceName: '中塑在线 · 展会地图',
    refLink: 'https://cpe.21cp.com/noticeToVisitor/exhibitionMap.html',
    tile: researchMaps.plastics.tile,
    outline: researchMaps.plastics.existingAreas[0],
    outlineName: '中塑国际会展中心地块轮廓',
  },
  {
    slug: 'cn-taizhou-icec',
    title: '台州国际博览中心',
    category: '场馆空间',
    region: '浙江 · 台州',
    sourceName: '台州国际博览中心 · 交通与报馆',
    refLink: 'https://www.tzicec.com/how_to_reach/',
    tile: researchMaps.taizhou.tile,
    outline: researchMaps.taizhou.existingAreas[0],
    outlineName: '展览建筑外轮廓',
  },
];

function buildSeededCase(siteCase) {
  const { tile, cite } = siteCase;
  const anchor = wgs84ToGcj02(cite[0], cite[1]);
  const toPlan = ([x, y]) => {
    const p = lngLatOf(tile, x, y);
    return [
      round((p.lng - cite[0]) * (111320 * Math.cos((cite[1] * Math.PI) / 180))),
      round((p.lat - cite[1]) * 111132.92),
    ];
  };

  const zones = [];
  const facilities = [];
  const routes = [];
  const nodes = [];

  if (siteCase.existing) {
    zones.push({
      name: siteCase.existing.name,
      semantic: siteCase.existing.semantic,
      color: '#5f6b63',
      opacity: 0.2,
      polygon: siteCase.existing.polygon.map(toPlan),
    });
  }

  for (const seed of siteCase.seeds) {
    if (seed.kind === 'area') {
      const style = zoneStyleFor(seed.name);
      zones.push({ name: seed.name, semantic: style.semantic, color: style.color, opacity: 0.3, polygon: seed.points.map(toPlan) });
      continue;
    }
    if (seed.kind === 'line') {
      routes.push({
        name: seed.name, kind: 'pedestrian', carrier: 'walk', color: '#f2c744', widthM: 3,
        points: seed.points.map(toPlan),
      });
      continue;
    }
    if (seed.kind === 'item') {
      for (const [i, at] of seed.points.entries()) {
        facilities.push({
          templateId: templateFor(seed.name),
          name: seed.points.length > 1 ? `${seed.name} ${i + 1}` : seed.name,
          size: { width: seed.width, depth: seed.depth },
          placement: { kind: 'single', x: toPlan(at)[0], y: toPlan(at)[1], rot: seed.angle ?? 0 },
        });
      }
      continue;
    }
    if (seed.kind === 'label') {
      for (const at of seed.points) {
        const [x, y] = toPlan(at);
        nodes.push({ name: seed.name, kind: 'both', x, y });
      }
      continue;
    }
    throw new Error(`未映射的官网 seed：${seed.kind}`);
  }

  if (!routes.length && siteCase.derivedRoute) {
    const zone = zones.find(z => z.name.includes('拟设'));
    const facility = facilities[0];
    if (!zone || !facility) throw new Error(`${siteCase.slug} 派生流线缺少起终点`);
    const cx = zone.polygon.reduce((sum, p) => sum + p[0], 0) / zone.polygon.length;
    const cy = zone.polygon.reduce((sum, p) => sum + p[1], 0) / zone.polygon.length;
    routes.push({
      name: '拟设 · 等候到导视（派生）', kind: 'pedestrian', carrier: 'walk', color: '#f2c744', widthM: 3,
      points: [[round(cx), round(cy)], [facility.placement.x, facility.placement.y]],
    });
  }
  if (!routes.length) throw new Error(`${siteCase.slug} 没有流线，复刻案至少要一条`);

  return {
    slug: siteCase.slug,
    title: siteCase.title,
    category: siteCase.category,
    region: siteCase.region,
    origin: 'cn',
    refImage: '',
    refLink: siteCase.refLink,
    anchor: { lng: round6(anchor.lng), lat: round6(anchor.lat) },
    locationNote:
      `官网案例 · ${siteCase.sourceName}；卫星锚点 cite ${cite[0]},${cite[1]}（WGS-84 → GCJ-02）。` +
      '区块/物料/流线为官网「拟设 · 拟放」演示，非现场实测，出摊前按当届图纸与现场复尺。' +
      (siteCase.derivedRoute ? '本案官网未画流线，图上的「等候到导视」由这两件的位置派生。' : ''),
    confirmedView: { lng: round6(anchor.lng), lat: round6(anchor.lat), zoom: tile[0], rotationDeg: 0 },
    officialPlan: {
      caption: '官网案例图（按官网描图数据复现）',
      areas: siteCase.existing
        ? [{ name: siteCase.existing.name, polygon: siteCase.existing.polygon.map(toPlan) }]
        : [],
      seeds: siteCase.seeds.map((seed) => ({
        name: seed.name,
        kind: seed.kind,
        points: seed.points.map(toPlan),
      })),
    },
    zones,
    facilities,
    routes,
    nodes,
  };
}

/** 平面环最多 64 点（site-plan 契约）；超过就按形状简化，不丢轮廓大体。 */
function simplifyRing(ring, maxPoints = 64) {
  if (ring.length <= maxPoints) return { ring, simplified: false };
  const rdp = (points, eps) => {
    if (points.length < 3) return points;
    const [ax, ay] = points[0];
    const [bx, by] = points[points.length - 1];
    const dx = bx - ax;
    const dy = by - ay;
    const norm = Math.hypot(dx, dy) || 1;
    let index = 0;
    let maxDist = 0;
    for (let i = 1; i < points.length - 1; i += 1) {
      const [px, py] = points[i];
      const dist = Math.abs(dy * (px - ax) - dx * (py - ay)) / norm;
      if (dist > maxDist) {
        maxDist = dist;
        index = i;
      }
    }
    if (maxDist <= eps) return [points[0], points[points.length - 1]];
    const left = rdp(points.slice(0, index + 1), eps);
    const right = rdp(points.slice(index), eps);
    return [...left.slice(0, -1), ...right];
  };
  let eps = 0.5;
  let simplified = ring;
  while (eps < 50) {
    // 闭合环不能直接首尾同点跑 RDP（A→A 是零长度线，结果会塔成 1 点）：
    // 先从离首点最远的顶点拆成两段开口折线，各自简化后再接回去。
    let far = 1;
    let farDist = -1;
    for (let i = 1; i < ring.length; i += 1) {
      const d = Math.hypot(ring[i][0] - ring[0][0], ring[i][1] - ring[0][1]);
      if (d > farDist) {
        farDist = d;
        far = i;
      }
    }
    const first = rdp(ring.slice(0, far + 1), eps);
    const second = rdp(ring.slice(far), eps);
    simplified = [...first.slice(0, -1), ...second];
    if (simplified.length >= 3 && simplified.length <= maxPoints) return { ring: simplified, simplified: true };
    eps *= 1.6;
  }
  // 极端情况兜底：均匀取点，保首点。
  const step = ring.length / maxPoints;
  return { ring: Array.from({ length: maxPoints }, (_, i) => ring[Math.floor(i * step)]), simplified: true };
}

function buildOutlineBase(siteCase) {
  const { tile, outline } = siteCase;
  // 轮廓是闭合环（首尾同点）时去掉重复尾点。
  const ring = outline.length > 3
    && outline[0][0] === outline[outline.length - 1][0]
    && outline[0][1] === outline[outline.length - 1][1]
    ? outline.slice(0, -1)
    : outline;
  const anchorWgs = siteCase.cite
    ? { lng: siteCase.cite[0], lat: siteCase.cite[1] }
    : ringCentroidWgs(tile, ring);
  const anchor = wgs84ToGcj02(anchorWgs.lng, anchorWgs.lat);
  const planRingRaw = ringToPlan(tile, anchorWgs, ring);
  const { ring: planRing, simplified } = simplifyRing(planRingRaw);
  const skeleton = facadeSkeleton(planRing);

  const zones = [
    {
      name: `${siteCase.outlineName}（官网描图）`,
      semantic: 'indoor',
      color: '#5f6b63',
      opacity: 0.18,
      polygon: planRing,
    },
    {
      name: '拟设 · 场外集结区',
      semantic: 'queue',
      color: '#bca783',
      opacity: 0.3,
      polygon: skeleton.zone,
    },
  ];

  return {
    slug: siteCase.slug,
    title: siteCase.title,
    category: siteCase.category,
    region: siteCase.region,
    origin: 'cn',
    refImage: '',
    refLink: siteCase.refLink,
    anchor: { lng: round6(anchor.lng), lat: round6(anchor.lat) },
    locationNote:
      `官网案例 · ${siteCase.sourceName}；场馆轮廓为官网已描好的底图，锚点` +
      `${siteCase.cite ? `取官网 cite ${siteCase.cite[0]},${siteCase.cite[1]}` : '取轮廓形心'}` +
      '（WGS-84 → GCJ-02）。场外集结区/导视/入场线按轮廓最长边中点派生，' +
      '长边不必然是实际门位，属起手位；非现场实测，办证与卸货按当届手册核对。' +
      (simplified ? '轮廓超过 64 点，已按形状简化到契约上限。' : ''),
    confirmedView: { lng: round6(anchor.lng), lat: round6(anchor.lat), zoom: tile[0], rotationDeg: 0 },
    officialPlan: {
      caption: '官网案例图（按官网描图数据复现）',
      areas: [{ name: siteCase.outlineName, polygon: planRingRaw }],
      seeds: [],
    },
    zones,
    facilities: [
      {
        templateId: 'oneplan:icon:information-point',
        name: '拟放 · 导视牌',
        size: { width: 1.2, depth: 0.5 },
        placement: { kind: 'single', x: skeleton.signAt[0], y: skeleton.signAt[1], rot: 0 },
      },
    ],
    routes: [
      {
        name: '拟设 · 观众入场线',
        kind: 'pedestrian',
        carrier: 'walk',
        color: '#f2c744',
        widthM: 3,
        points: skeleton.route,
      },
    ],
    nodes: [{ name: '待核 · 主场入口', kind: 'both', x: skeleton.nodeAt[0], y: skeleton.nodeAt[1] }],
    __frame: skeleton.frame,
    __ring: planRing,
  };
}

/** 有官网 seed 的案：入口取官网流线终点，环取既有轮廓或整体包围盒。 */
function finishSeeded(base, siteCase) {
  const toPlan = ([x, y]) => {
    const p = lngLatOf(siteCase.tile, x, y);
    return [
      round((p.lng - siteCase.cite[0]) * (111320 * Math.cos((siteCase.cite[1] * Math.PI) / 180))),
      round((p.lat - siteCase.cite[1]) * 111132.92),
    ];
  };
  const ring = siteCase.existing
    ? siteCase.existing.polygon.map(toPlan)
    : bboxRing(base.zones.flatMap((z) => z.polygon));
  return completeSpec(base, seededFrame(base), ring);
}

/** 只有轮廓的案：轮廓原样搬，起手位按最长边派生，再补到整套门槛。 */
function buildOutlineCase(siteCase) {
  const base = buildOutlineBase(siteCase);
  const frame = base.__frame;
  const ring = base.__ring;
  delete base.__frame;
  delete base.__ring;
  return completeSpec(base, frame, ring);
}

const specs = [
  ...SEEDED_CASES.map((c) => finishSeeded(buildSeededCase(c), c)),
  ...OUTLINE_CASES.map(buildOutlineCase),
];

const header = `/**
 * 官网中国案例复刻规格（生成文件，勿手改）。
 *
 * 生成器：tools/cn-cases/build-cn-replica-specs.mjs
 * 数据源：assets/site-cases.mjs（4 个「地图试排」案的拟设种子）、
 *         assets/site-activity-cases.mjs 与 assets/site-inspiration-maps.mjs（其余案已描好的轮廓）。
 * 口径：真实地点锚点（WGS-84 → GCJ-02）+ 官网已有内容；只有轮廓的案，场外起手位按最长边派生。
 * 布置一律「拟设」，不是现场实测，也不替主办方补造展位。
 */

import type { ReplicaCaseSpec } from './replica-kit';

`;

writeFileSync(OUT, header + `export const CN_SPECS: ReplicaCaseSpec[] = ${JSON.stringify(specs, null, 2)};\n`, 'utf8');
console.log(`wrote ${OUT} (${specs.length} cases)`);
for (const spec of specs) {
  console.log(`- ${spec.slug}: zones=${spec.zones.length} facilities=${spec.facilities.length} routes=${spec.routes.length} nodes=${spec.nodes.length}`);
}
void pointInRing;
