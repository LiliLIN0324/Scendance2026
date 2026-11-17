/**
 * OnePlan 复刻规格 · 政府/社区类第二批（5 案）。
 */

import type { ReplicaCaseSpec } from './replica-kit';
import { REPLICA_FLOW_COLOR } from './replica-kit';

const LINK = (slug: string) => `https://www.oneplan.io/inspiration/${slug}/`;

export const TRUNK_OR_TREAT_KUNA: ReplicaCaseSpec = {
  slug: 'trunk-or-treat',
  title: 'Trunk or Treat',
  category: 'Local Governments',
  region: 'North America',
  refImage: 'trunk-or-treat.png',
  refLink: LINK('trunk-or-treat'),
  anchor: { lng: -116.42, lat: 43.382 },
  locationNote: '镇级锚点：Kuna, Idaho',
  zones: [
    { name: 'Green Lot 绿场', semantic: 'reserved', color: '#3fb544', opacity: 0.3, rect: { cx: -45, cy: -10, w: 45, h: 40 } },
    { name: 'Red Lot 红场', semantic: 'reserved', color: '#c0392b', opacity: 0.3, rect: { cx: 5, cy: -15, w: 55, h: 50 } },
    { name: 'City Green 城市绿地', semantic: 'reserved', color: '#3fb544', opacity: 0.3, polygon: [[45, 75], [90, 78], [95, 55], [50, 52]] },
    { name: 'Trail Path 步道带', semantic: 'reserved', color: '#e07b30', opacity: 0.2, rect: { cx: 40, cy: -70, w: 80, h: 12 } },
  ],
  facilities: [
    { templateId: 'booth-2x2', name: 'Trunk 车摊', color: '#f2f2f2', placement: { kind: 'row', x: 25, y: -68, count: 12, dx: 4 } },
    { templateId: 'oneplan:scale:portable-toilet', name: '移动洗手间', color: '#3fb544', placement: { kind: 'row', x: 88, y: -60, count: 4, dy: 2.6, rot: 90 } },
    { templateId: 'oneplan:icon:cone', name: '路锥', color: '#e07b30', placement: { kind: 'row', x: 95, y: -78, count: 6, dx: 3 } },
    { templateId: 'oneplan:icon:traffic-lights', name: '路口管控', color: '#e07b30', placement: { kind: 'single', x: 78, y: -62 } },
    { templateId: 'oneplan:icon:first-aid-point', name: '急救点', color: '#c0392b', placement: { kind: 'single', x: -48, y: 25 } },
  ],
  routes: [
    { name: '人流 · 黄色寻糖线', kind: 'pedestrian', carrier: 'walk', oneWay: true, widthM: 3, color: REPLICA_FLOW_COLOR, startNode: 0, points: [[80, 55], [75, 30], [70, 0], [60, -25], [35, -45], [0, -55], [-40, -60], [-55, -40], [-50, -10], [-40, 10]] },
    { name: '车行 · 进出场环线', kind: 'vehicle', carrier: 'vehicle', oneWay: true, widthM: 4, points: [[-90, 40], [-40, 55], [20, 60], [85, 45], [110, 10], [100, -30], [70, -60]] },
  ],
  nodes: [
    { name: '主入口', kind: 'both', x: 82, y: 57 },
    { name: '步道口', kind: 'both', x: -88, y: 42 },
  ],
};

export const WINTERSKOL_ASPEN: ReplicaCaseSpec = {
  slug: 'winterskol',
  title: 'Wintersköl',
  category: 'Local Governments',
  region: 'North America',
  refImage: 'winterskol.png',
  refLink: LINK('winterskol'),
  anchor: { lng: -106.819, lat: 39.1917 },
  locationNote: '镇级锚点：Aspen Wagner Park',
  zones: [
    { name: 'Event Field 活动场', semantic: 'reserved', color: '#e07b30', opacity: 0.15, rect: { cx: -15, cy: 0, w: 75, h: 85 } },
    { name: 'Stage 圆台', semantic: 'stage', color: '#e07b30', opacity: 0.4, circle: { cx: -8, cy: -25, r: 8 } },
    { name: 'Ice Rink 冰场', semantic: 'audience', color: '#f2f2f2', opacity: 0.25, rect: { cx: 85, cy: -55, w: 55, h: 30 } },
    { name: 'Pink Alley 粉巷', semantic: 'queue', color: '#ec5fa8', opacity: 0.3, rect: { cx: -75, cy: 55, w: 22, h: 14 } },
    { name: 'Purple Block 紫块', semantic: 'reserved', color: '#b362c9', opacity: 0.35, rect: { cx: 42, cy: -42, w: 10, h: 8 } },
  ],
  facilities: [
    { templateId: 'booth-2x2', name: '绿摊排', color: '#3fb544', placement: { kind: 'grid', x: -42, y: 20, cols: 5, rows: 4, dx: 3.4, dy: 7 } },
    { templateId: 'booth-2x2', name: '蓝块', color: '#2b5fd9', placement: { kind: 'grid', x: -45, y: -18, cols: 5, rows: 2, dx: 3.6, dy: 4 } },
    { templateId: 'oneplan:scale:large-screen', name: '黑屏', placement: { kind: 'single', x: 12, y: 35 } },
    { templateId: 'oneplan:icon:first-aid-point', name: '急救点', color: '#3fb544', placement: { kind: 'scatter', at: [[-52, 48], [25, 45]] } },
    { templateId: 'oneplan:icon:information-point', name: '信息点', color: '#7fd0e8', placement: { kind: 'scatter', at: [[-45, 42], [20, 38]] } },
    { templateId: 'oneplan:scale:portable-toilet', name: '移动洗手间', color: '#2b5fd9', placement: { kind: 'row', x: 55, y: 38, count: 6, dy: 2.6, rot: 90 } },
    { templateId: 'oneplan:scale:bus', name: '摆渡大巴', color: '#f2f2f2', placement: { kind: 'row', x: -40, y: -62, count: 4, dx: 8 } },
    { templateId: 'oneplan:icon:feather-flag', name: '黄灯旗', color: '#f2d024', placement: { kind: 'scatter', at: [[-55, 5], [-58, -25], [35, 5], [38, -30]] } },
  ],
  routes: [
    { name: '人流 · 主街穿越', kind: 'pedestrian', carrier: 'walk', oneWay: true, widthM: 3, color: REPLICA_FLOW_COLOR, startNode: 0, points: [[-75, -70], [-60, -40], [-45, -10], [-30, 20], [-10, 45], [15, 60], [45, 70]] },
    { name: '人流 · 冰场连线', kind: 'pedestrian', carrier: 'walk', oneWay: false, widthM: 3, color: '#2b5fd9', points: [[60, 40], [75, 15], [85, -15], [90, -40]] },
  ],
  nodes: [
    { name: '北街口', kind: 'both', x: -77, y: -72 },
    { name: '东口', kind: 'both', x: 62, y: 42 },
  ],
};

export const HIGH_CHAPARRAL_PARK_ECLIPSE: ReplicaCaseSpec = {
  slug: 'high-chaparral-park',
  title: 'High Chaparral Park（日全食观测营地）',
  category: 'Market, Fairs & Shows',
  region: 'North America',
  refImage: 'high-chaparral-park.png',
  refLink: LINK('high-chaparral-park'),
  anchor: { lng: -97.796, lat: 31.135 },
  locationNote: '镇级锚点：Copperas Cove, TX（2024-04-08 日全食）',
  zones: [
    { name: 'Fence 场地围栏', semantic: 'queue', color: '#e07b30', opacity: 0.12, rect: { cx: 5, cy: -15, w: 130, h: 120 } },
    { name: 'RV Strip 房车带', semantic: 'parking', color: '#e07b30', opacity: 0.3, rect: { cx: 0, cy: 48, w: 55, h: 12 } },
    { name: 'Trailer Rows 拖车排', semantic: 'parking', color: '#8a8f96', opacity: 0.25, rect: { cx: -5, cy: -20, w: 105, h: 70 } },
    { name: 'Toilet Row 厕卫带', semantic: 'reserved', color: '#2b5fd9', opacity: 0.2, rect: { cx: -8, cy: 32, w: 60, h: 8 } },
    { name: 'Blue Tent 蓝帐区', semantic: 'reserved', color: '#2b5fd9', opacity: 0.3, rect: { cx: 55, cy: -40, w: 14, h: 12 } },
  ],
  facilities: [
    { templateId: 'oneplan:scale:caravan', name: '拖车排', color: '#8a8f96', placement: { kind: 'grid', x: -55, y: -50, cols: 10, rows: 6, dx: 6.5, dy: 12 } },
    { templateId: 'oneplan:scale:caravan', name: '房车排', color: '#e8b838', placement: { kind: 'row', x: -22, y: 48, count: 8, dx: 7 }, zoneIndex: 1 },
    { templateId: 'oneplan:scale:portable-toilet', name: '移动洗手间', color: '#2b5fd9', placement: { kind: 'row', x: -36, y: 32, count: 8, dx: 2.6 }, zoneIndex: 3 },
    { templateId: 'oneplan:scale:pop-up-tent', name: '蓝帐', color: '#2b5fd9', placement: { kind: 'single', x: 55, y: -40 }, zoneIndex: 4 },
    { templateId: 'oneplan:scale:tent', name: '橙帐', color: '#e07b30', placement: { kind: 'scatter', at: [[62, 22], [68, 14]] } },
    { templateId: 'oneplan:icon:wifi', name: '紫通讯车', color: '#b362c9', placement: { kind: 'scatter', at: [[52, -18], [58, -26]] } },
    { templateId: 'oneplan:icon:feather-flag', name: '红旗', color: '#c0392b', placement: { kind: 'row', x: -20, y: 20, count: 6, dx: 2 } },
    { templateId: 'oneplan:icon:first-aid-point', name: '急救点', color: '#c0392b', placement: { kind: 'scatter', at: [[62, 30], [-78, -55]] } },
    { templateId: 'oneplan:scale:water-refill-station', name: '加水点', color: '#7fd0e8', placement: { kind: 'scatter', at: [[-60, 32], [-20, 32], [20, 32]] } },
  ],
  routes: [
    { name: '车行 · 场内环线（黄）', kind: 'vehicle', carrier: 'vehicle', oneWay: true, widthM: 4, color: '#f2d024', startNode: 0, points: [[-70, 60], [-40, 40], [-30, 20], [-30, -5], [-20, -30], [0, -45], [30, -40], [60, -25], [70, 0], [68, 25], [50, 45], [20, 55]] },
    { name: '人流 · 外围步道', kind: 'pedestrian', carrier: 'walk', oneWay: false, widthM: 3, color: '#f2d024', startNode: 1, points: [[-105, -80], [-80, -60], [-75, -30], [-80, 5], [-70, 35], [-45, 55]] },
  ],
  nodes: [
    { name: '场内口', kind: 'both', x: -72, y: 62 },
    { name: '外围口', kind: 'both', x: -107, y: -82 },
  ],
};

export const HALLOWEEN_CARNIVAL_MANHEIM: ReplicaCaseSpec = {
  slug: 'halloween-carnival',
  title: 'Halloween Carnival',
  category: 'Local Governments',
  region: 'North America',
  refImage: 'halloween-carnival.png',
  refLink: LINK('halloween-carnival'),
  anchor: { lng: -76.317, lat: 40.093 },
  locationNote: '镇级锚点：Manheim Township, Lancaster PA',
  zones: [
    { name: 'Rec Center 活动中心', semantic: 'reserved', color: '#2b5fd9', opacity: 0.2, rect: { cx: 5, cy: 5, w: 55, h: 45 } },
    { name: 'Booth Plaza 摊位广场', semantic: 'reserved', color: '#c0392b', opacity: 0.12, rect: { cx: 20, cy: 5, w: 80, h: 60 } },
    { name: 'Orange Zone 橙区', semantic: 'reserved', color: '#e07b30', opacity: 0.3, rect: { cx: -60, cy: 55, w: 30, h: 22 } },
    { name: 'Red Parking 红停车', semantic: 'parking', color: '#c0392b', opacity: 0.3, polygon: [[155, 35], [185, 25], [178, -5], [148, 0]] },
    { name: 'Blue Parking 蓝停车', semantic: 'parking', color: '#2b5fd9', opacity: 0.3, polygon: [[-55, -60], [-10, -68], [-18, -95], [-62, -88]] },
    { name: 'Golf Route 高尔夫车道', semantic: 'reserved', color: '#f2d024', opacity: 0.12, rect: { cx: 105, cy: -35, w: 60, h: 10, rot: 25 } },
  ],
  facilities: [
    { templateId: 'booth-2x2', name: '红 X 摊', color: '#c0392b', placement: { kind: 'grid', x: 0, y: 18, cols: 4, rows: 4, dx: 4.5, dy: 5 } },
    { templateId: 'booth-2x2', name: '红 X 摊 B', color: '#c0392b', placement: { kind: 'grid', x: 28, y: 20, cols: 4, rows: 4, dx: 4.5, dy: 5 } },
    { templateId: 'oneplan:icon:photo-point', name: '拍照点', color: '#f2d024', placement: { kind: 'scatter', at: [[-2, -12], [8, -14]] } },
    { templateId: 'oneplan:scale:food-trailer', name: '木餐拖', color: '#a06a3a', placement: { kind: 'single', x: -35, y: -32 } },
    { templateId: 'oneplan:icon:first-aid-point', name: '急救点', color: '#c0392b', placement: { kind: 'scatter', at: [[30, -25], [-70, 45]] } },
    { templateId: 'oneplan:scale:portable-toilet', name: '移动洗手间', color: '#3fb544', placement: { kind: 'row', x: -42, y: -38, count: 4, dx: 2.6 } },
  ],
  routes: [
    { name: '人流 · 广场环线', kind: 'pedestrian', carrier: 'walk', oneWay: true, widthM: 3, color: REPLICA_FLOW_COLOR, startNode: 0, points: [[-60, -50], [-40, -30], [-30, 0], [-20, 25], [0, 40], [30, 45], [60, 30], [75, 5], [70, -20], [40, -40], [10, -55], [-30, -60]] },
    { name: '车行 · 高尔夫车道（黄虚）', kind: 'vehicle', carrier: 'vehicle', oneWay: false, widthM: 3, color: '#f2d024', points: [[75, -10], [95, -25], [115, -40], [140, -55]] },
  ],
  nodes: [
    { name: '西门', kind: 'both', x: -62, y: -52 },
    { name: '东口', kind: 'both', x: 78, y: 2 },
  ],
};

export const NATIONAL_NIGHT_OUT_OLNEY: ReplicaCaseSpec = {
  slug: 'olney-maryland-national-night-out',
  title: 'National Night Out (Olney, Maryland)',
  category: 'Local Governments',
  region: 'North America',
  refImage: 'olney-maryland-national-night-out.png',
  refLink: LINK('olney-maryland-national-night-out'),
  anchor: { lng: -77.065, lat: 39.1551 },
  locationNote: '镇级锚点：Olney, MD 停车场市集',
  zones: [
    { name: 'HT Drive Thru 绿带', semantic: 'reserved', color: '#3fb544', opacity: 0.3, rect: { cx: -55, cy: 55, w: 70, h: 10, rot: -8 } },
    { name: 'SSVFD 红块', semantic: 'reserved', color: '#c0392b', opacity: 0.35, rect: { cx: 55, cy: -8, w: 55, h: 20 } },
    { name: 'Fire House 消防站', semantic: 'reserved', color: '#c0392b', opacity: 0.35, rect: { cx: 62, cy: -42, w: 45, h: 12 } },
    { name: 'SSVFD B 红块', semantic: 'reserved', color: '#c0392b', opacity: 0.35, rect: { cx: 40, cy: -68, w: 45, h: 12 } },
    { name: 'Stage 舞台', semantic: 'stage', color: '#b362c9', opacity: 0.35, rect: { cx: -78, cy: -45, w: 22, h: 10, rot: -30 } },
    { name: 'Rect 紫区', semantic: 'reserved', color: '#b362c9', opacity: 0.25, rect: { cx: -92, cy: 22, w: 12, h: 18 } },
    { name: 'Kid Attraction 儿童区', semantic: 'audience', color: '#c0392b', opacity: 0.3, rect: { cx: -108, cy: 32, w: 22, h: 8, rot: -20 } },
    { name: 'Dunk Tank 水靶区', semantic: 'reserved', color: '#7fd0e8', opacity: 0.3, rect: { cx: -88, cy: 8, w: 18, h: 8, rot: -20 } },
    { name: 'Police Trailer 绿区', semantic: 'reserved', color: '#3fb544', opacity: 0.25, polygon: [[-120, -25], [-75, -30], [-80, -60], [-125, -55]] },
    { name: 'Park Police 蓝绿区', semantic: 'reserved', color: '#3fb544', opacity: 0.3, rect: { cx: -8, cy: -62, w: 35, h: 10 } },
  ],
  facilities: [
    { templateId: 'booth-2x2', name: '白摊排', color: '#f2f2f2', placement: { kind: 'grid', x: -50, y: 25, cols: 5, rows: 4, dx: 4.5, dy: 4.5 } },
    { templateId: 'oneplan:icon:bar', name: '餐车圆', color: '#3fb544', placement: { kind: 'row', x: 18, y: 45, count: 4, dy: -14, rot: 80 } },
    { templateId: 'oneplan:icon:information-point', name: 'E 点', color: '#2b5fd9', placement: { kind: 'scatter', at: [[-58, 55], [-35, 20], [30, -55]] } },
    { templateId: 'oneplan:scale:bus', name: 'command bus', color: '#111111', placement: { kind: 'scatter', at: [[-70, 40], [-25, 50], [5, 52]] } },
    { templateId: 'oneplan:icon:cone', name: '锥排', color: '#e07b30', placement: { kind: 'row', x: 18, y: -20, count: 5, dx: 3 } },
    { templateId: 'oneplan:icon:first-aid-point', name: '急救点', color: '#c0392b', placement: { kind: 'single', x: -25, y: -30 } },
    { templateId: 'oneplan:scale:car', name: 'police car', color: '#2b5fd9', placement: { kind: 'scatter', at: [[-5, -52], [8, -50]] } },
    { templateId: 'trash-point-1.2x1.2', name: 'dining 点', color: '#f2d024', placement: { kind: 'scatter', at: [[8, 55], [30, 30]] } },
  ],
  routes: [
    { name: '人流 · 停车场穿越（蓝点）', kind: 'pedestrian', carrier: 'walk', oneWay: false, widthM: 3, color: '#2b5fd9', startNode: 0, points: [[-55, 70], [-40, 50], [-25, 35], [-10, 20], [5, 5], [15, -10], [25, -25], [35, -45]] },
    { name: '人流 · 南北街过街', kind: 'pedestrian', carrier: 'walk', oneWay: true, widthM: 3, color: '#e07b30', points: [[75, 80], [70, 50], [62, 20], [55, -10], [50, -40], [45, -70]] },
  ],
  nodes: [
    { name: '北口', kind: 'both', x: -57, y: 72 },
    { name: '南口', kind: 'both', x: 47, y: -78 },
  ],
};
