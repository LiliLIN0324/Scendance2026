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
  anchor: { lng: -78.8784, lat: 42.8864 },
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
  anchor: { lng: -87.907, lat: 43.034 },
  locationNote: '镇级锚点：Milwaukee Veterans Park 湖滨',
  zones: [
    { name: 'Transition / Finish Field 转换终点场', semantic: 'stage', color: '#3fb544', opacity: 0.3, polygon: [[-60, 20], [40, 25], [55, -30], [20, -60], [-50, -50], [-70, -10]] },
    { name: 'Swim Start 下水区', semantic: 'reserved', color: '#f2d024', opacity: 0.4, rect: { cx: 95, cy: -35, w: 35, h: 25 } },
    { name: 'Run Lane 跑道带（红）', semantic: 'reserved', color: '#c0392b', opacity: 0.35, rect: { cx: -110, cy: -5, w: 12, h: 70 } },
    { name: 'Parking 停车场', semantic: 'parking', color: '#a06a3a', opacity: 0.35, polygon: [[-135, 45], [-85, 55], [-75, 30], [-125, 25]] },
    { name: 'Tent Village 帐篷村', semantic: 'reserved', color: '#f2d024', opacity: 0.3, rect: { cx: 15, cy: 55, w: 55, h: 14 } },
    { name: 'Finish Chute 终点道（紫）', semantic: 'reserved', color: '#b3628c', opacity: 0.35, rect: { cx: 0, cy: -70, w: 80, h: 8 } },
  ],
  facilities: [
    { templateId: 'oneplan:scale:pop-up-tent', name: '黄帐篷', color: '#f2d024', placement: { kind: 'grid', x: -8, y: 50, cols: 8, rows: 2, dx: 6, dy: 5 }, zoneIndex: 4 },
    { templateId: 'oneplan:scale:tent', name: ' registration 棚', color: '#f2f2f2', placement: { kind: 'scatter', at: [[-78, 18], [-58, 14]] } },
    { templateId: 'oneplan:scale:bike-rack', name: '转换区车架', color: '#3fb544', placement: { kind: 'grid', x: -45, y: -20, cols: 2, rows: 8, dx: 30, dy: 5 } },
    { templateId: 'oneplan:icon:first-aid-point', name: '医疗点', color: '#2b5fd9', placement: { kind: 'scatter', at: [[10, -55], [-55, 5]] } },
    { templateId: 'oneplan:scale:portable-toilet', name: '移动洗手间', color: '#2b5fd9', placement: { kind: 'row', x: 48, y: -40, count: 4, dy: 2.6, rot: 90 } },
    { templateId: 'oneplan:scale:gantry', name: '终点拱门', color: '#111111', placement: { kind: 'single', x: 0, y: -66 }, zoneIndex: 5 },
    { templateId: 'oneplan:icon:timing-point', name: '计时点', color: '#111111', placement: { kind: 'scatter', at: [[-8, -62], [55, -20]] } },
  ],
  routes: [
    { name: 'Bike · 骑行出环线（粉）', kind: 'vehicle', carrier: 'vehicle', oneWay: true, widthM: 4, color: '#e87ab8', startNode: 0, points: [[50, 10], [75, 0], [70, -25], [95, -45], [40, -75], [-20, -80], [-80, -70], [-110, -40], [-115, 5], [-70, 18], [0, 22]] },
    { name: 'Run · 跑步进环线（紫）', kind: 'pedestrian', carrier: 'walk', oneWay: true, widthM: 3, color: '#b3628c', startNode: 1, points: [[-40, -78], [-20, -70], [10, -68], [40, -68], [70, -62], [30, -55], [-10, -50], [-40, -45]] },
    { name: '人流 · 停车场→转换区', kind: 'pedestrian', carrier: 'walk', oneWay: true, widthM: 3, color: REPLICA_FLOW_COLOR, startNode: 2, points: [[-105, 28], [-85, 15], [-60, 0]] },
  ],
  nodes: [
    { name: '骑行出口', kind: 'exit', x: 52, y: 12 },
    { name: '跑步进口', kind: 'entry', x: -42, y: -80 },
    { name: '停车场口', kind: 'both', x: -108, y: 30 },
  ],
};

export const FRANKLINS_GARDENS_NORTHAMPTON_SAINTS: ReplicaCaseSpec = {
  slug: 'franklins-gardens-northampton-saints-stadium',
  title: "Franklin's Gardens – Northampton Saints Stadium",
  category: 'Venues',
  region: 'Europe',
  refImage: 'franklins-gardens-northampton-saints-stadium.jpg',
  refLink: LINK('franklins-gardens-northampton-saints-stadium'),
  anchor: { lng: -0.9046, lat: 52.2386 },
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
