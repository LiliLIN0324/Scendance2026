/**
 * OnePlan 复刻规格 · 路跑赛事（3 案）+ 固定场馆（1 案）。
 */

import type { ReplicaCaseSpec } from './replica-kit';
import { REPLICA_FLOW_COLOR } from './replica-kit';

const LINK = (slug: string) => `https://www.oneplan.io/inspiration/${slug}/`;

export const BUFFALO_MARATHON_WEEKEND: ReplicaCaseSpec = {
  slug: 'buffalo-marathon-weekend',
  title: 'Buffalo Marathon Weekend',
  category: 'Road Events',
  region: 'North America',
  refImage: 'buffalo-marathon-weekend.png',
  refLink: LINK('buffalo-marathon-weekend'),
  anchor: { lng: -78.892616, lat: 42.945626 },
  rotationDeg: 94,
  locationNote: '镇级锚点：Buffalo downtown（全城路线案）',
  zones: [
    { name: 'Start / Finish 起终点', semantic: 'stage', color: '#c0392b', opacity: 0.35, rect: { cx: -55, cy: -10, w: 26, h: 14 } },
    { name: 'Road Closure 道路封闭带', semantic: 'reserved', color: '#f2d024', opacity: 0.3, rect: { cx: -30, cy: -55, w: 130, h: 8 } },
    { name: 'Water Stop 补水点带', semantic: 'loading', color: '#7fd0e8', opacity: 0.3, rect: { cx: 40, cy: -22, w: 120, h: 8 } },
  ],
  facilities: [
    { templateId: 'stage-platform-8x6', name: '起点台', placement: { kind: 'single', x: -55, y: -10 }, zoneIndex: 0 },
    { templateId: 'oneplan:scale:water-refill-station', name: '补水站', color: '#2b5fd9', placement: { kind: 'row', x: -20, y: -18, count: 4, dx: 25 } },
    { templateId: 'oneplan:scale:portable-toilet', name: '移动洗手间', placement: { kind: 'row', x: -70, y: -2, count: 6, dy: 2.6, rot: 90 } },
    { templateId: 'oneplan:scale:tent', name: '医疗帐篷', color: '#c0392b', placement: { kind: 'single', x: -45, y: -2 } },
    { templateId: 'oneplan:scale:bus', name: '摆渡大巴', color: '#5b6470', placement: { kind: 'row', x: -80, y: -25, count: 3, dy: -6, rot: 90 } },
    { templateId: 'oneplan:icon:km-marker', name: '里程碑', color: '#d93a2b', placement: { kind: 'row', x: -10, y: -12, count: 6, dx: 30 } },
  ],
  routes: [
    { name: '全马 · 蓝色大环线', kind: 'pedestrian', carrier: 'walk', oneWay: true, widthM: 5, color: '#2b5fd9', startNode: 0, points: [[-42, -14], [-10, -30], [60, -30], [130, -15], [160, 10], [120, 40], [40, 45], [-20, 35], [-90, 20], [-140, -5], [-110, -25], [-60, -18]] },
    { name: '半马 · 棕色小环', kind: 'pedestrian', carrier: 'walk', oneWay: true, widthM: 4, color: '#8a5a2a', startNode: 0, points: [[-48, -8], [-20, -20], [30, -18], [70, -5], [30, 10], [-20, 12], [-45, 5]] },
    { name: '5K · 粉色环', kind: 'pedestrian', carrier: 'walk', oneWay: true, widthM: 3, color: '#e87ab8', startNode: 0, points: [[-58, -6], [-35, -15], [-10, -5], [-30, 8], [-52, 6]] },
    { name: '车辆 · 封闭维持线', kind: 'vehicle', carrier: 'vehicle', oneWay: true, widthM: 4, points: [[-160, -60], [-60, -58], [40, -58], [120, -55]] },
  ],
  nodes: [
    { name: '起点拱门', kind: 'entry', x: -55, y: -16 },
    { name: '终点拱门', kind: 'exit', x: -50, y: -4 },
  ],
};

export const FESTIVAL_FOODS_11_RUNNING_EVENTS: ReplicaCaseSpec = {
  slug: 'festival-foods-11-running-events-on-the-same-day',
  title: "Festival Foods' 11 Running Events on the Same Day",
  category: 'Road Events',
  region: 'North America',
  refImage: 'festival-foods-11-running-events-on-the-same-day.png',
  refLink: LINK('festival-foods-11-running-events-on-the-same-day'),
  anchor: { lng: -88.418, lat: 44.266 },
  locationNote: '镇级锚点：Appleton WI（Turkey Trot 多点位口径）',
  zones: [
    { name: 'Start / Finish 起终点', semantic: 'stage', color: '#c0392b', opacity: 0.3, rect: { cx: 70, cy: 20, w: 14, h: 10 } },
    { name: 'Woodside 补给带', semantic: 'loading', color: '#7fd0e8', opacity: 0.3, rect: { cx: 14, cy: -3, w: 8, h: 60 } },
    { name: 'Start Yard 起点集结', semantic: 'checkin', color: '#3fb544', opacity: 0.25, rect: { cx: 80, cy: 40, w: 30, h: 18 } },
  ],
  facilities: [
    { templateId: 'oneplan:scale:water-refill-station', name: '水站', color: '#e07b30', placement: { kind: 'row', x: 15, y: -5, count: 5, dy: -18 } },
    { templateId: 'oneplan:icon:cone', name: '路锥', color: '#e07b30', placement: { kind: 'row', x: 60, y: 8, count: 8, dx: 4 } },
    { templateId: 'oneplan:icon:km-marker', name: '里程牌', color: '#2b5fd9', placement: { kind: 'row', x: 0, y: 40, count: 4, dy: -20 } },
    { templateId: 'oneplan:scale:portable-toilet', name: '移动洗手间', placement: { kind: 'row', x: 62, y: 32, count: 4, dx: 2.6, rot: 90 } },
    { templateId: 'oneplan:icon:first-aid-point', name: '急救点', color: '#d93a2b', placement: { kind: 'single', x: 76, y: 26 } },
  ],
  routes: [
    { name: '5 Mile 虚线大环', kind: 'pedestrian', carrier: 'walk', oneWay: true, widthM: 4, color: '#2b5fd9', startNode: 0, points: [[68, 24], [10, 30], [-60, 28], [-70, -20], [-10, -45], [60, -48], [75, -10], [72, 18]] },
    { name: 'Green Dash 绿虚线环', kind: 'pedestrian', carrier: 'walk', oneWay: true, widthM: 3, color: '#3fb544', startNode: 0, points: [[66, 22], [20, 15], [-40, 0], [-55, -30], [0, -50], [50, -42], [64, -15]] },
    { name: 'Orange Dot 橙点路线', kind: 'pedestrian', carrier: 'walk', oneWay: true, widthM: 3, color: '#e07b30', points: [[40, 75], [35, 40], [30, 5], [10, -10], [-25, -25], [-65, -25], [-70, 20], [-45, 60], [-40, 90]] },
    { name: '人流 · 河滨步道段', kind: 'pedestrian', carrier: 'walk', oneWay: true, widthM: 3, color: '#3fb544', points: [[-105, 65], [-90, 40], [-80, 15], [-78, -5]] },
  ],
  nodes: [
    { name: '起终点拱门', kind: 'both', x: 70, y: 24 },
    { name: '北侧折返点', kind: 'exit', x: 62, y: -50 },
  ],
};

export const USA_TRIATHLON_NATIONALS_PTO: ReplicaCaseSpec = {
  slug: '2023-usa-triathlon-nationals-pto-us-open',
  title: 'USA Triathlon Nationals & PTO US Open',
  category: 'Road Events',
  region: 'North America',
  refImage: '2023-usa-triathlon-nationals-pto-us-open.png',
  refLink: LINK('2023-usa-triathlon-nationals-pto-us-open'),
  // 2026-11-17：锚点不再是「镇级」。做法是拿官方参考图（它本身就是一张卫星截图）
  // 与 Esri World Imagery 瓦片做四参数配准：比例(mpp) + 旋转 θ + 平移，灰度与 Sobel 边缘两套指标互相印证。
  // 实测结论：θ = 0°（这张参考图本来就是正北向上）；比例 **0.145 m/px**（原按比例尺读的 0.1367 小了 6%，
  // 所以之前铺到底图上「范围偏小」）。参考图中心落在 z19 瓦片 (1114, 1196)，mosaic 中心 (1152,1152)，
  // 即中心在旧锚点西 8.3 m、南 9.6 m 处，反算得下面这组经纬度。残差米级。
  // 改锚点或比例都要重跑 .tmp/geo 下的 prep → stitch → fit4 → geo-overlay，不要凭目测手改。
  anchor: { lng: -87.897354, lat: 43.036482 },
  rotationDeg: 0,
  locationNote: '影像配准锚点：Milwaukee Veterans Park 湖滨（四参数配准：θ=0°，0.145 m/px）',
  zones: [
    // 2026-11-17 用户：「直接描啊」，并在本地接了全球底图后要求「完全在地图上复刻」。
    // 全部按原图逐块描点：比例尺实测 **0.145 m/px**（四参数配准得出，1 px ≈ 14.5 cm）。
    // 坐标口径 = SitePlanData 的 ENU：x 向东、y 向北，原点 (0,0) 是参考图正中的那条地面点
    // （即上面 anchor 的经纬度）。描图时像素 y 向下，所以写进来时已取反；本图 θ=0° 无需旋转。
    // 区块名改用原图上的英文标签，不再自造「跑道带/帐篷村」。
    { name: 'Tent Village TT11–TT26 帐篷阵', semantic: 'reserved', color: '#f2d024', opacity: 0.3, polygon: [[-96.4, 90.9], [-42, 90.9], [-42, 61.9], [-96.4, 61.9]] },
    { name: 'Trike Transport 铁三转运', semantic: 'loading', color: '#a06a3a', opacity: 0.35, polygon: [[-133.3, 91.6], [-95.7, 90.5], [-95.7, 60.5], [-119.6, 59.4], [-132.7, 69.9]] },
    { name: 'Transition Field 转换场', semantic: 'stage', color: '#3fb544', opacity: 0.3, polygon: [[-95.7, 36.6], [1.5, 36.6], [1.5, -60.6], [-84.1, -62.1], [-95.7, -38.8]] },
    { name: 'LAS Compound 器材区', semantic: 'reserved', color: '#c0392b', opacity: 0.35, polygon: [[-147.7, 19.8], [-120.4, 16.2], [-120.1, -53.4], [-142.1, -53.4], [-147.7, -12.7]] },
    { name: 'Swim Start 下水区', semantic: 'reserved', color: '#f2d024', opacity: 0.4, polygon: [[34.8, 27.9], [69.6, 27.2], [68.8, -1.2], [35.5, -0.4]] },
    { name: 'Bay Check Tent 检录棚', semantic: 'checkin', color: '#8a8f96', opacity: 0.3, polygon: [[-49.3, 52.5], [-19.6, 52.5], [-19.6, 43.1], [-49.3, 43.1]] },
  ],
  facilities: [
    // 原图 TT11–TT26 是 4 行黄帐篷，行距/列距按图量（约 8.5 × 7.5 m），从北往南排。
    { templateId: 'oneplan:scale:pop-up-tent', name: 'TT 帐篷', color: '#f2d024', placement: { kind: 'grid', x: -92.8, y: 88, cols: 5, rows: 4, dx: 9, dy: -8 }, zoneIndex: 0 },
    // 转换场里那些绿色横线是车架位，按图铺成多排。
    { templateId: 'oneplan:scale:bike-rack', name: '转换车架', color: '#3fb544', placement: { kind: 'grid', x: -89.1, y: 29.7, cols: 2, rows: 9, dx: 65.8, dy: -9.5 }, zoneIndex: 2 },
    { templateId: 'oneplan:scale:stretch-tent', name: 'Bay Check 检录棚', color: '#f2f2f2', placement: { kind: 'single', x: -34.5, y: 47.7 }, zoneIndex: 5 },
    { templateId: 'oneplan:scale:portable-toilet', name: 'Bike TA 厕位', color: '#7fd0e8', placement: { kind: 'row', x: -90.2, y: -9.5, count: 3, dy: -3.4, rot: 90 } },
    { templateId: 'oneplan:icon:first-aid-point', name: '医疗点（Bike TA）', color: '#2b5fd9', placement: { kind: 'scatter', at: [[-87, 21.2], [-83.8, -31.8]] } },
    { templateId: 'oneplan:icon:camera-fixed', name: 'Broadcast Tower 1', color: '#111111', placement: { kind: 'single', x: -149.3, y: -74.4 } },
    { templateId: 'oneplan:scale:generator', name: '发电机', color: '#8a8f96', placement: { kind: 'single', x: -102.9, y: 42.4 } },
  ],
  routes: [
    // 粉线：转换场沿场西侧向北出场的骑行通道（按图描折点）。
    { name: 'Bike Out 骑行出场（粉）', kind: 'vehicle', carrier: 'vehicle', oneWay: true, widthM: 4, color: '#e87ab8', startNode: 0, points: [[-87, 29.3], [-85.5, 62.7], [-89.8, 82.9], [-100.8, 89.1]] },
    // 紫线：场底跑道带，按图沿南边界向东。
    { name: 'Run Lane 跑道（紫）', kind: 'pedestrian', carrier: 'walk', oneWay: true, widthM: 5, color: '#7a4fd8', points: [[-95.7, -76.6], [-53, -78], [0, -79.4], [35, -78.5]] },
    { name: '人流 · 检录棚→转换场', kind: 'pedestrian', carrier: 'walk', oneWay: true, widthM: 3, color: REPLICA_FLOW_COLOR, points: [[-35, 46.7], [-47.7, 38.2], [-74.3, 31.8]] },
  ],
  nodes: [
    { name: '转换区入口', kind: 'both', x: -87, y: 29.3 },
    { name: '跑道起端', kind: 'entry', x: -95.7, y: -77.3 },
    { name: '下水区岸', kind: 'entry', x: 35, y: 26.5 },
  ],
};

export const FRANKLINS_GARDENS_NORTHAMPTON_SAINTS: ReplicaCaseSpec = {
  slug: 'franklins-gardens-northampton-saints-stadium',
  title: "Franklin's Gardens – Northampton Saints Stadium",
  category: 'Venues',
  region: 'Europe',
  refImage: 'franklins-gardens-northampton-saints-stadium.jpg',
  refLink: LINK('franklins-gardens-northampton-saints-stadium'),
  anchor: { lng: -0.918841, lat: 52.239044 },
  rotationDeg: 309,
  locationNote: '精确锚点：Franklin\'s Gardens 球场',
  zones: [
    { name: 'Pitch 球场', semantic: 'stage', color: '#3fb544', opacity: 0.3, rect: { cx: -40, cy: 0, w: 55, h: 90 } },
    { name: 'West Stand 西看台', semantic: 'audience', color: '#c0392b', opacity: 0.25, rect: { cx: -12, cy: 0, w: 10, h: 90 } },
    { name: 'Bar Bar 品球台', semantic: 'reserved', color: '#f2d024', opacity: 0.35, rect: { cx: -32, cy: 12, w: 12, h: 10 } },
    { name: 'Pitch Perimeter 场边通道', semantic: 'reserved', color: '#2b5fd9', opacity: 0.2, rect: { cx: -28, cy: 0, w: 8, h: 92 } },
    { name: 'Plaza 中央广场', semantic: 'reserved', color: '#3fb544', opacity: 0.2, rect: { cx: 45, cy: 8, w: 50, h: 55 } },
    { name: 'Car Park 停车场', semantic: 'parking', color: '#8a8f96', opacity: 0.25, rect: { cx: 95, cy: 30, w: 30, h: 40 } },
    { name: 'Merchandise 商品棚', semantic: 'reserved', color: '#b362c9', opacity: 0.3, rect: { cx: 88, cy: -20, w: 16, h: 14 } },
  ],
  facilities: [
    { templateId: 'oneplan:scale:stretch-tent', name: '中央白帐', color: '#f2f2f2', placement: { kind: 'single', x: 42, y: 8 }, zoneIndex: 4 },
    { templateId: 'oneplan:icon:bar', name: '吧台点', color: '#c0392b', placement: { kind: 'scatter', at: [[-30, 8], [-30, 16], [25, 25], [30, -12]] }, zoneIndex: 3 },
    { templateId: 'oneplan:icon:first-aid-point', name: '急救点', color: '#3fb544', placement: { kind: 'scatter', at: [[-20, 40], [-20, -40]] } },
    { templateId: 'oneplan:icon:merchandise', name: '商品点', color: '#b362c9', placement: { kind: 'single', x: 88, y: -20 }, zoneIndex: 6 },
    { templateId: 'oneplan:icon:stanchion', name: '隔离柱', color: '#2b5fd9', placement: { kind: 'row', x: 60, y: -25, count: 8, dx: 2.5 } },
    { templateId: 'oneplan:scale:portable-toilet', name: '移动洗手间', placement: { kind: 'row', x: 115, y: 12, count: 4, dy: 2.6, rot: 90 } },
    { templateId: 'oneplan:icon:entry-gate', name: '门', color: '#2b5fd9', placement: { kind: 'scatter', at: [[-8, 45], [-8, -45], [22, 40]] } },
  ],
  routes: [
    { name: '人流 · 停车场→广场→看台', kind: 'pedestrian', carrier: 'walk', oneWay: true, widthM: 3, color: REPLICA_FLOW_COLOR, startNode: 0, points: [[112, 45], [90, 35], [60, 20], [20, 10], [-6, 5]] },
    { name: '人流 · 街侧→看台北', kind: 'pedestrian', carrier: 'walk', oneWay: true, widthM: 3, color: '#2b5fd9', startNode: 1, points: [[60, -60], [25, -50], [-5, -40]] },
  ],
  nodes: [
    { name: '停车场口', kind: 'both', x: 114, y: 48 },
    { name: '北街口', kind: 'both', x: 62, y: -62 },
  ],
};
