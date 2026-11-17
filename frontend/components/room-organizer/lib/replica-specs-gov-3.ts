/**
 * OnePlan 复刻规格 · 政府/社区类第三批（4 案，政府类收口）。
 */

import type { ReplicaCaseSpec } from './replica-kit';
import { REPLICA_FLOW_COLOR } from './replica-kit';

const LINK = (slug: string) => `https://www.oneplan.io/inspiration/${slug}/`;

export const CAROLS_IN_THE_PARK: ReplicaCaseSpec = {
  slug: 'carols-in-the-park',
  title: 'Carols in the Park',
  category: 'Local Governments',
  region: 'Australia & NZ',
  refImage: 'carols-in-the-park.png',
  refLink: LINK('carols-in-the-park'),
  anchor: { lng: 115.715119, lat: -32.534176 },
  rotationDeg: 108,
  locationNote: '镇级锚点：Mandurah (WA) 海滨公园',
  zones: [
    { name: 'Event Lawn 活动草坪', semantic: 'audience', color: '#a8d8e8', opacity: 0.25, polygon: [[-70, 45], [20, 50], [30, -10], [-5, -35], [-60, -25]] },
    { name: 'Festival Field 节庆大场', semantic: 'reserved', color: '#c8894a', opacity: 0.35, rect: { cx: 85, cy: 0, w: 85, h: 70 } },
    { name: 'Parking 停车带（右）', semantic: 'parking', color: '#c0392b', opacity: 0.25, polygon: [[185, 30], [200, 25], [195, -40], [180, -35]] },
    { name: 'Stage Block 舞台块', semantic: 'stage', color: '#2b5fd9', opacity: 0.4, rect: { cx: -12, cy: -28, w: 14, h: 9 } },
    { name: 'Orange Tent 橙棚', semantic: 'reserved', color: '#e07b30', opacity: 0.35, rect: { cx: 22, cy: 32, w: 14, h: 12 } },
  ],
  facilities: [
    { templateId: 'oneplan:scale:ambulance', name: '急救车', color: '#3fb544', placement: { kind: 'row', x: -66, y: 40, count: 8, dy: -9 } },
    { templateId: 'oneplan:scale:portable-toilet', name: '移动洗手间', color: '#2b5fd9', placement: { kind: 'row', x: -18, y: -20, count: 4, dx: 2.6 } },
    { templateId: 'oneplan:scale:water-refill-station', name: '加水点', color: '#2b5fd9', placement: { kind: 'scatter', at: [[5, -25], [-45, 5]] } },
    { templateId: 'oneplan:scale:stage', name: '舞台台', placement: { kind: 'single', x: -12, y: -28 }, zoneIndex: 3 },
    { templateId: 'oneplan:scale:pop-up-tent', name: '白棚', placement: { kind: 'scatter', at: [[-30, -30], [8, -32]] } },
    { templateId: 'oneplan:icon:wifi', name: '场内点', color: '#2b5fd9', placement: { kind: 'single', x: 85, y: 0 } },
    { templateId: 'oneplan:scale:caravan', name: '红色补给块', color: '#c0392b', placement: { kind: 'single', x: 55, y: 22 }, zoneIndex: 1 },
    { templateId: 'oneplan:icon:feather-flag', name: '入口旗', color: '#f2d024', placement: { kind: 'single', x: 68, y: 40 } },
  ],
  routes: [
    { name: '人流 · 入口旗→大场', kind: 'pedestrian', carrier: 'walk', oneWay: true, widthM: 3, color: REPLICA_FLOW_COLOR, startNode: 0, points: [[68, 48], [70, 30], [75, 10]] },
    { name: '人流 · 草坪→舞台', kind: 'pedestrian', carrier: 'walk', oneWay: false, widthM: 3, color: '#a8d8e8', points: [[-30, 40], [-20, 15], [-12, -20]] },
  ],
  nodes: [
    { name: '主入口', kind: 'both', x: 70, y: 50 },
    { name: '草坪口', kind: 'both', x: -32, y: 42 },
  ],
};

export const MANDURAH_CHRISTMAS_PAGEANT: ReplicaCaseSpec = {
  slug: 'mandurah-christmas-pageant',
  title: 'Mandurah Christmas Pageant',
  category: 'Local Governments',
  region: 'Australia & NZ',
  refImage: 'mandurah-christmas-pageant.png',
  refLink: LINK('mandurah-christmas-pageant'),
  anchor: { lng: 115.720312, lat: -32.532123 },
  rotationDeg: 251,
  locationNote: '镇级锚点：Mandurah 镇中心巡游线',
  zones: [
    { name: 'Staging 花车集结带', semantic: 'queue', color: '#c0392b', opacity: 0.3, rect: { cx: -80, cy: 40, w: 18, h: 55 } },
    { name: 'Float Marshalling 花车排', semantic: 'reserved', color: '#c0392b', opacity: 0.2, rect: { cx: -78, cy: -10, w: 16, h: 40 } },
    { name: 'Foreshore Event 海滨活动区', semantic: 'reserved', color: '#e07b30', opacity: 0.25, rect: { cx: 10, cy: -55, w: 90, h: 25 } },
  ],
  facilities: [
    { templateId: 'oneplan:scale:food-trailer', name: '花车（白）', color: '#f2f2f2', placement: { kind: 'grid', x: -84, y: -22, cols: 2, rows: 6, dx: 4, dy: 6 }, zoneIndex: 1 },
    { templateId: 'oneplan:scale:pop-up-tent', name: '海滨棚', color: '#e07b30', placement: { kind: 'scatter', at: [[-15, -55], [5, -52], [25, -52], [45, -55]] }, zoneIndex: 2 },
    { templateId: 'oneplan:icon:information-point', name: 'E 点', color: '#2b5fd9', placement: { kind: 'scatter', at: [[75, -55], [120, -52]] } },
    { templateId: 'oneplan:icon:first-aid-point', name: '急救点', color: '#c0392b', placement: { kind: 'single', x: 55, y: -50 }, zoneIndex: 2 },
    { templateId: 'oneplan:scale:portable-toilet', name: '移动洗手间', placement: { kind: 'row', x: -95, y: -5, count: 3, dy: 2.6, rot: 90 } },
  ],
  routes: [
    { name: '巡游 · 主线（集结→镇中心→海滨）', kind: 'vehicle', carrier: 'vehicle', oneWay: true, widthM: 5, color: '#e07b30', startNode: 0, points: [[-78, 55], [-70, 30], [-70, 0], [-60, -20], [-30, -35], [10, -40], [60, -42], [110, -45]] },
    { name: '人流 · 海滨散场线', kind: 'pedestrian', carrier: 'walk', oneWay: true, widthM: 3, color: '#2b5fd9', startNode: 1, points: [[115, -40], [100, -30], [70, -28], [40, -32]] },
  ],
  nodes: [
    { name: '集结出发点', kind: 'entry', x: -80, y: 57 },
    { name: '海滨散场口', kind: 'exit', x: 117, y: -42 },
  ],
};

export const HALLOWEEN_TOWN: ReplicaCaseSpec = {
  slug: 'halloween-town',
  title: 'Halloween Town',
  category: 'Local Governments',
  region: 'North America',
  refImage: 'halloween-town.png',
  refLink: LINK('halloween-town'),
  anchor: { lng: -104.9903, lat: 39.7392 },
  locationNote: '原案城市未核实，锚点为示意（镇级）',
  zones: [
    { name: 'Vendor Booths 摊位海', semantic: 'reserved', color: '#a06a3a', opacity: 0.35, polygon: [[-70, 40], [10, 45], [35, 5], [25, -40], [-40, -50], [-75, -20]] },
    { name: 'Car Show 车展区', semantic: 'reserved', color: '#f2d024', opacity: 0.3, rect: { cx: -15, cy: -62, w: 45, h: 18 } },
    { name: 'Food Row 绿食列', semantic: 'reserved', color: '#3fb544', opacity: 0.3, polygon: [[45, -35], [60, -15], [50, 20], [35, 5]] },
    { name: 'Petting Zoo 宠物园', semantic: 'reserved', color: '#3aa08c', opacity: 0.3, polygon: [[80, 30], [110, 28], [112, 5], [85, 5]] },
    { name: 'First Aid 急救弧', semantic: 'medical', color: '#c0392b', opacity: 0.3, polygon: [[55, 38], [75, 42], [70, 25], [55, 25]] },
    { name: 'Sheriff 警务区', semantic: 'reserved', color: '#2b5fd9', opacity: 0.3, rect: { cx: 78, cy: 52, w: 18, h: 12 } },
    { name: 'Vendor Parking 摊贩停车', semantic: 'parking', color: '#e07b30', opacity: 0.25, rect: { cx: -105, cy: 62, w: 40, h: 12 } },
    { name: 'Vendor Parking B', semantic: 'parking', color: '#e07b30', opacity: 0.25, rect: { cx: 135, cy: 55, w: 14, h: 45 } },
  ],
  facilities: [
    { templateId: 'booth-2x2', name: '橙 X 摊', color: '#e07b30', placement: { kind: 'grid', x: -60, y: 30, cols: 5, rows: 4, dx: 9, dy: 9 }, zoneIndex: 0 },
    { templateId: 'oneplan:scale:car', name: '车展车', color: '#f2f2f2', placement: { kind: 'grid', x: -30, y: -64, cols: 6, rows: 1, dx: 3.4, rot: 90 }, zoneIndex: 1 },
    { templateId: 'oneplan:scale:market-stall', name: '绿食棚', color: '#3fb544', placement: { kind: 'row', x: 52, y: -30, count: 6, dy: 8, rot: 90 }, zoneIndex: 2 },
    { templateId: 'oneplan:icon:first-aid-point', name: '急救', color: '#c0392b', placement: { kind: 'single', x: 62, y: 34 }, zoneIndex: 4 },
    { templateId: 'oneplan:icon:information-point', name: 'WC/信息', color: '#2b5fd9', placement: { kind: 'scatter', at: [[95, 45], [72, 55], [-38, 48], [-28, 42]] } },
    { templateId: 'oneplan:icon:photo-point', name: '宠物园点', color: '#a06a3a', placement: { kind: 'single', x: 95, y: 17 } },
    { templateId: 'oneplan:scale:police-car', name: '警车', color: '#2b5fd9', placement: { kind: 'single', x: 40, y: 42 }, zoneIndex: 0 },
    { templateId: 'oneplan:scale:pop-up-tent', name: '紫棚', color: '#b362c9', placement: { kind: 'single', x: 52, y: 30 } },
  ],
  routes: [
    { name: '人流 · 停车→摊位海→食列', kind: 'pedestrian', carrier: 'walk', oneWay: true, widthM: 3, color: REPLICA_FLOW_COLOR, startNode: 0, points: [[-108, 50], [-85, 35], [-60, 15], [-30, -5], [0, -20], [35, -30], [52, -20], [58, 0]] },
    { name: '人流 · 东门→宠物园', kind: 'pedestrian', carrier: 'walk', oneWay: true, widthM: 3, color: '#e07b30', startNode: 1, points: [[138, 45], [120, 40], [100, 35], [88, 30]] },
  ],
  nodes: [
    { name: '西门', kind: 'both', x: -110, y: 52 },
    { name: '东门', kind: 'both', x: 140, y: 47 },
  ],
};

export const SPRINGVALE_SNOW_FEST: ReplicaCaseSpec = {
  slug: 'springvale-snow-fest',
  title: 'Springvale Snow Fest',
  category: 'Local Governments',
  region: 'Australia & NZ',
  refImage: 'springvale-snow-fest.png',
  refLink: LINK('springvale-snow-fest'),
  anchor: { lng: 145.151384, lat: -37.949319 },
  rotationDeg: 262,
  locationNote: '镇级锚点：Springvale (VIC) 商业街',
  zones: [
    { name: 'Street Market 街市带', semantic: 'reserved', color: '#f2d024', opacity: 0.15, rect: { cx: 0, cy: -12, w: 130, h: 10 } },
    { name: 'Snow Play A 玩雪区', semantic: 'audience', color: '#a8d8e8', opacity: 0.3, polygon: [[135, -35], [165, -35], [165, -60], [135, -60]] },
    { name: 'Snow Play B 玩雪区 B', semantic: 'audience', color: '#3fb544', opacity: 0.25, polygon: [[135, -8], [162, -8], [162, -28], [135, -28]] },
    { name: 'Pink Block 粉块', semantic: 'stage', color: '#ec5fa8', opacity: 0.35, rect: { cx: 148, cy: 55, w: 12, h: 40 } },
    { name: 'Orange Strip 橙条', semantic: 'reserved', color: '#e07b30', opacity: 0.3, rect: { cx: 148, cy: 22, w: 16, h: 12 } },
  ],
  facilities: [
    { templateId: 'booth-2x2', name: '红摊', color: '#c0392b', placement: { kind: 'row', x: -55, y: -8, count: 8, dx: 3.4 } },
    { templateId: 'booth-2x2', name: '绿摊', color: '#3fb544', placement: { kind: 'row', x: -55, y: -16, count: 8, dx: 3.4 } },
    { templateId: 'booth-2x2', name: '黄摊', color: '#f2d024', placement: { kind: 'row', x: 0, y: -8, count: 8, dx: 3.4 } },
    { templateId: 'booth-2x2', name: '蓝摊', color: '#2b5fd9', placement: { kind: 'row', x: -70, y: 22, count: 6, dx: 3.4 } },
    { templateId: 'oneplan:scale:large-waste-container', name: '垃圾大桶', color: '#e07b30', placement: { kind: 'single', x: 15, y: 45 } },
    { templateId: 'toilet-2.4x1.2', name: 'WC 大点', color: '#7fd0e8', placement: { kind: 'scatter', at: [[-15, 42], [135, -2], [60, 48]] } },
    { templateId: 'oneplan:icon:fireworks', name: '气球点', color: '#f2d024', placement: { kind: 'single', x: -8, y: 40 } },
    { templateId: 'stage-platform-8x6', name: '街舞台', placement: { kind: 'single', x: 40, y: 22 } },
    { templateId: 'oneplan:icon:cone', name: '路障条', color: '#e07b30', placement: { kind: 'row', x: 40, y: -45, count: 6, dx: 2.5 } },
    { templateId: 'oneplan:icon:first-aid-point', name: '急救点', color: '#c0392b', placement: { kind: 'scatter', at: [[88, 35], [105, 45]] } },
    { templateId: 'oneplan:icon:information-point', name: '信息点', color: '#3fb544', placement: { kind: 'scatter', at: [[95, 42], [130, 5]] } },
  ],
  routes: [
    { name: '人流 · 商业主街', kind: 'pedestrian', carrier: 'walk', oneWay: true, widthM: 3, color: REPLICA_FLOW_COLOR, startNode: 0, points: [[-80, -12], [-40, -12], [0, -10], [50, -12], [100, -10], [130, -12]] },
    { name: '人流 · 玩雪支线', kind: 'pedestrian', carrier: 'walk', oneWay: false, widthM: 3, color: '#a8d8e8', startNode: 1, points: [[130, -5], [140, -20], [148, -45]] },
  ],
  nodes: [
    { name: '西街口', kind: 'both', x: -82, y: -12 },
    { name: '玩雪口', kind: 'both', x: 132, y: -3 },
  ],
};
