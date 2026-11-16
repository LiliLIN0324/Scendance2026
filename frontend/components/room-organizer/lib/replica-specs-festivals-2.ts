/**
 * OnePlan 复刻规格 · 节庆类第二批（4 案）。
 */

import type { ReplicaCaseSpec } from './replica-kit';
import { REPLICA_FLOW_COLOR } from './replica-kit';

const LINK = (slug: string) => `https://www.oneplan.io/inspiration/${slug}/`;

export const NEW_FOREST_FOLK_FESTIVAL: ReplicaCaseSpec = {
  slug: 'new-forest-folk-festival',
  title: 'New Forest Folk Festival',
  category: 'Festivals',
  region: 'Europe',
  refImage: 'new-forest-folk-festival.png',
  refLink: LINK('new-forest-folk-festival'),
  anchor: { lng: -1.63, lat: 50.885 },
  locationNote: '镇级锚点：New Forest（Hampshire）农场田块',
  zones: [
    { name: 'Day Parking 日间停车', semantic: 'parking', color: '#7a4d9d', opacity: 0.35, polygon: [[-95, 25], [-50, 40], [-42, -30], [-70, -45], [-98, -20]] },
    { name: 'Camping Field 露营田', semantic: 'reserved', color: '#a06a5a', opacity: 0.35, polygon: [[-18, 45], [40, 45], [55, 5], [38, -25], [-12, -20], [-25, 15]] },
    { name: 'Accessible Camping 无障碍营', semantic: 'reserved', color: '#3aa08c', opacity: 0.4, rect: { cx: 8, cy: -32, w: 52, h: 10 } },
    { name: 'Caravan Field 房车田', semantic: 'parking', color: '#f2d024', opacity: 0.35, polygon: [[62, 45], [108, 48], [112, -25], [80, -28], [60, 5]] },
    { name: 'North Field 北田', semantic: 'reserved', color: '#2b5fd9', opacity: 0.25, rect: { cx: 30, cy: 62, w: 50, h: 18 } },
    { name: 'Artists & Helpers Compound 艺人营', semantic: 'reserved', color: '#c0392b', opacity: 0.3, polygon: [[-8, -45], [50, -48], [58, -80], [0, -85]] },
    { name: 'Stage Field 舞台田', semantic: 'stage', color: '#9a8a4a', opacity: 0.4, polygon: [[-22, -88], [30, -90], [36, -118], [-28, -115]] },
  ],
  facilities: [
    { templateId: 'stage-platform-8x6', name: 'Stage 舞台', placement: { kind: 'single', x: 2, y: -102 }, zoneIndex: 6 },
    { templateId: 'oneplan:scale:tent', name: '蓝棚', color: '#2b5fd9', placement: { kind: 'single', x: -8, y: -98 }, zoneIndex: 6 },
    { templateId: 'oneplan:scale:pop-up-tent', name: '绿小棚', color: '#3fb544', placement: { kind: 'single', x: -14, y: -96 }, zoneIndex: 6 },
    { templateId: 'oneplan:scale:pop-up-tent', name: '艺人营帐篷', color: '#f2d024', placement: { kind: 'scatter', at: [[10, -60], [22, -62], [34, -58], [44, -64]] }, zoneIndex: 5 },
    { templateId: 'oneplan:scale:portable-toilet', name: '移动洗手间', placement: { kind: 'row', x: 62, y: 18, count: 5, dy: 3.5, rot: 90 } },
    { templateId: 'oneplan:scale:accessible-portable-toilet', name: '无障碍厕位', placement: { kind: 'row', x: 62, y: -8, count: 2, dy: 3 } },
    { templateId: 'oneplan:scale:water-refill-station', name: '加水点', placement: { kind: 'scatter', at: [[58, 30], [50, -40], [-55, -35]] } },
    { templateId: 'oneplan:scale:caravan', name: '房车', placement: { kind: 'grid', x: 70, y: -18, cols: 3, rows: 2, dx: 6, dy: 8 }, zoneIndex: 3 },
  ],
  routes: [
    { name: '人流 · 农场门→舞台田→露营田', kind: 'pedestrian', carrier: 'walk', oneWay: true, widthM: 3, color: REPLICA_FLOW_COLOR, startNode: 0, points: [[-30, -125], [-15, -105], [0, -88], [-5, -60], [0, -35], [5, -10], [10, 20]] },
    { name: '车行 · 房车田进出', kind: 'vehicle', carrier: 'vehicle', oneWay: false, widthM: 4, startNode: 1, points: [[75, 58], [80, 30], [78, 0], [72, -20]] },
  ],
  nodes: [
    { name: '农场步道门', kind: 'both', x: -32, y: -126 },
    { name: '房车田口', kind: 'entry', x: 74, y: 60 },
  ],
};

export const MUGSTOCK: ReplicaCaseSpec = {
  slug: 'mugstock',
  title: 'MugStock',
  category: 'Festivals',
  region: 'Europe',
  refImage: 'mugstock.png',
  refLink: LINK('mugstock'),
  anchor: { lng: -4.335, lat: 55.937 },
  locationNote: '镇级锚点：Mugdock Country Park（Glasgow）',
  zones: [
    { name: 'Arena 主场', semantic: 'stage', color: '#3fb544', opacity: 0.3, polygon: [[-20, 55], [30, 70], [55, 45], [30, 30], [-10, 35]] },
    { name: 'Red Field 红田', semantic: 'reserved', color: '#c0392b', opacity: 0.3, circle: { cx: 32, cy: 20, r: 12 } },
    { name: 'Big Field 大田', semantic: 'reserved', color: '#a06a3a', opacity: 0.3, rect: { cx: 35, cy: -8, w: 42, h: 36 } },
    { name: 'Purple Field 紫田', semantic: 'reserved', color: '#b362c9', opacity: 0.3, rect: { cx: 88, cy: 12, w: 36, h: 30 } },
    { name: 'Yellow Field 黄田', semantic: 'parking', color: '#f2d024', opacity: 0.3, rect: { cx: 105, cy: 38, w: 20, h: 18 } },
    { name: 'Teal Fields 青田', semantic: 'reserved', color: '#3aa08c', opacity: 0.3, polygon: [[-70, 25], [-45, 30], [-45, -15], [-70, -10]] },
    { name: 'Camping 白帐篷营', semantic: 'reserved', color: '#e8e8f0', opacity: 0.3, rect: { cx: -12, cy: -52, w: 34, h: 30 } },
    { name: 'South Parking 南停车', semantic: 'parking', color: '#f2d024', opacity: 0.25, rect: { cx: 62, cy: -85, w: 24, h: 10 } },
  ],
  facilities: [
    { templateId: 'oneplan:scale:pop-up-tent', name: '露营帐篷', color: '#f2f2f2', placement: { kind: 'grid', x: -24, y: -62, cols: 6, rows: 4, dx: 4, dy: 5 }, zoneIndex: 6 },
    { templateId: 'oneplan:icon:camping', name: '营火点', color: '#c0392b', placement: { kind: 'scatter', at: [[32, 20], [-38, -108]] }, zoneIndex: 1 },
    { templateId: 'oneplan:scale:market-stall', name: '摊位', color: '#e8b838', placement: { kind: 'grid', x: 10, y: -18, cols: 3, rows: 2, dx: 2.6, dy: 3.5 }, zoneIndex: 2 },
    { templateId: 'food-truck-6x2.5', name: '餐车', placement: { kind: 'scatter', at: [[55, -5], [70, 30]] } },
    { templateId: 'oneplan:icon:feather-flag', name: '彩旗', color: '#b362c9', placement: { kind: 'scatter', at: [[-5, -30], [30, -35], [60, -70]] } },
  ],
  routes: [
    { name: '人流 · 主径（南门→营地→大田→主场）', kind: 'pedestrian', carrier: 'walk', oneWay: true, widthM: 3, color: REPLICA_FLOW_COLOR, startNode: 0, points: [[-45, -85], [-25, -65], [-10, -40], [5, -20], [20, 0], [15, 25], [5, 45]] },
    { name: '人流 · 东门→紫田', kind: 'pedestrian', carrier: 'walk', oneWay: true, widthM: 3, color: '#b362c9', startNode: 1, points: [[108, 55], [95, 35], [85, 15]] },
  ],
  nodes: [
    { name: '南门', kind: 'both', x: -47, y: -88 },
    { name: '东门', kind: 'both', x: 110, y: 57 },
  ],
};

export const PARKENFESTIVALEN: ReplicaCaseSpec = {
  slug: 'parkenfestivalen-2023',
  title: 'Parkenfestivalen',
  category: 'Festivals',
  region: 'Europe',
  refImage: 'parkenfestivalen-2023.png',
  refLink: LINK('parkenfestivalen-2023'),
  anchor: { lng: 14.405, lat: 67.28 },
  locationNote: '镇级锚点：Bodø 城市公园',
  zones: [
    { name: 'Festival Field 节庆场', semantic: 'audience', color: '#3fb544', opacity: 0.3, polygon: [[-35, 30], [40, 42], [55, 5], [20, -25], [-30, -15]] },
    { name: 'Main Stage Area 主舞台区', semantic: 'stage', color: '#a06a3a', opacity: 0.4, rect: { cx: 8, cy: 18, w: 32, h: 22 } },
    { name: 'Backstage 后台', semantic: 'reserved', color: '#2b5fd9', opacity: 0.3, rect: { cx: -6, cy: 44, w: 38, h: 12 } },
    { name: 'Red Zone West 西红区', semantic: 'reserved', color: '#d93a2b', opacity: 0.3, rect: { cx: -62, cy: -8, w: 26, h: 34 } },
    { name: 'Red Zone South 南红区', semantic: 'reserved', color: '#d93a2b', opacity: 0.3, rect: { cx: -12, cy: -48, w: 36, h: 15 } },
    { name: 'Green Stage 东绿台', semantic: 'stage', color: '#3fb544', opacity: 0.4, rect: { cx: 58, cy: 22, w: 18, h: 18 } },
  ],
  facilities: [
    { templateId: 'oneplan:scale:pop-up-tent', name: '绿棚', color: '#3fb544', placement: { kind: 'row', x: 48, y: 8, count: 4, dy: 4, rot: 90 } },
    { templateId: 'oneplan:scale:tent', name: '粉 X 棚', color: '#e87ab8', placement: { kind: 'scatter', at: [[98, 32], [96, 38], [-78, -42]] } },
    { templateId: 'oneplan:scale:tent', name: '白棚', placement: { kind: 'single', x: 25, y: -18 } },
    { templateId: 'oneplan:icon:bar', name: '酒吧点', color: '#f2d024', placement: { kind: 'scatter', at: [[-58, -30], [12, -52], [40, -10]] } },
    { templateId: 'oneplan:icon:first-aid-point', name: '急救点', color: '#d93a2b', placement: { kind: 'scatter', at: [[-20, 5], [50, -30]] } },
    { templateId: 'oneplan:scale:generator', name: '发电机', placement: { kind: 'row', x: -20, y: 42, count: 3, dx: 3 } },
    { templateId: 'oneplan:icon:cone', name: '路锥', placement: { kind: 'row', x: -55, y: 25, count: 5, dy: -4 } },
  ],
  routes: [
    { name: '围栏 · 场地环线', kind: 'pedestrian', carrier: 'walk', oneWay: false, widthM: 2, color: '#e07b30', points: [[-80, 30], [-45, 48], [20, 55], [80, 45], [110, 20], [100, -25], [40, -60], [-40, -62], [-85, -35], [-95, 5]] },
    { name: '人流 · 入口→主舞台', kind: 'pedestrian', carrier: 'walk', oneWay: true, widthM: 3, color: REPLICA_FLOW_COLOR, startNode: 0, points: [[-52, -55], [-30, -25], [-10, 0], [5, 12]] },
  ],
  nodes: [
    { name: '南门', kind: 'both', x: -54, y: -58 },
    { name: '东门', kind: 'both', x: 100, y: 38 },
  ],
};

export const RIVERBEND_MUSIC_FESTIVAL: ReplicaCaseSpec = {
  slug: 'riverbend-music-festival',
  title: 'Riverbend Music Festival',
  category: 'Festivals',
  region: 'North America',
  refImage: 'riverbend-music-festival.png',
  refLink: LINK('riverbend-music-festival'),
  anchor: { lng: -85.309, lat: 35.056 },
  locationNote: '镇级锚点：Chattanooga 河滨公园（Coolidge Park 一带）',
  zones: [
    { name: 'Site Park 场地园', semantic: 'audience', color: '#e07b30', opacity: 0.12, polygon: [[-120, -20], [-30, -45], [60, -40], [140, -30], [175, 5], [150, 45], [40, 55], [-60, 40], [-135, 20]] },
    { name: 'Artist Compound 艺人村', semantic: 'reserved', color: '#c0392b', opacity: 0.3, polygon: [[-135, -55], [-60, -60], [-55, -95], [-130, -90]] },
    { name: 'Green Room 绿屋区', semantic: 'reserved', color: '#3fb544', opacity: 0.3, polygon: [[-160, 25], [-120, 35], [-118, 5], [-155, 0]] },
    { name: 'Main Stage A 主舞台', semantic: 'stage', color: '#2b5fd9', opacity: 0.4, rect: { cx: 30, cy: 15, w: 34, h: 10 } },
    { name: 'Main Stage B 主舞台', semantic: 'stage', color: '#2b5fd9', opacity: 0.4, rect: { cx: 95, cy: 28, w: 12, h: 20 } },
    { name: 'VIP 区', semantic: 'vip', color: '#f2d024', opacity: 0.35, rect: { cx: 110, cy: -18, w: 40, h: 14 } },
    { name: 'Red Tent 红棚', semantic: 'reserved', color: '#c0392b', opacity: 0.35, rect: { cx: -15, cy: -22, w: 16, h: 10 } },
    { name: 'Lawn 绿地', semantic: 'audience', color: '#3fb544', opacity: 0.15, rect: { cx: -10, cy: 12, w: 40, h: 22 } },
  ],
  facilities: [
    { templateId: 'oneplan:scale:picnic-table', name: '野餐桌', color: '#f2d024', placement: { kind: 'grid', x: 30, y: -30, cols: 8, rows: 3, dx: 3.5, dy: 5 } },
    { templateId: 'oneplan:scale:pop-up-tent', name: '白棚', placement: { kind: 'scatter', at: [[65, -5], [80, -5], [-70, -50], [-75, -45]] } },
    { templateId: 'oneplan:scale:market-stall', name: '餐摊', color: '#3fb544', placement: { kind: 'row', x: -35, y: -35, count: 5, dx: 2.6 } },
    { templateId: 'oneplan:scale:large-screen', name: '大屏', placement: { kind: 'single', x: 68, y: -32 } },
    { templateId: 'security-post-1.5x1.5', name: '安保岗亭', placement: { kind: 'scatter', at: [[-125, -70], [145, 15]] } },
    { templateId: 'oneplan:icon:boat', name: '码头', placement: { kind: 'single', x: 40, y: 78 } },
    { templateId: 'trash-point-1.2x1.2', name: '垃圾点', placement: { kind: 'scatter', at: [[-20, -8], [60, 5], [120, -5]] } },
  ],
  routes: [
    { name: '人流 · 桥西→主街→主舞台', kind: 'pedestrian', carrier: 'walk', oneWay: true, widthM: 3, color: REPLICA_FLOW_COLOR, startNode: 0, points: [[-125, -80], [-100, -50], [-60, -25], [0, -10], [50, 5], [95, 15]] },
    { name: '人流 · 东侧→VIP', kind: 'pedestrian', carrier: 'walk', oneWay: true, widthM: 3, color: REPLICA_FLOW_COLOR, startNode: 1, points: [[170, 30], [145, 5], [125, -12]] },
  ],
  nodes: [
    { name: '桥西入口', kind: 'both', x: -128, y: -85 },
    { name: '东入口', kind: 'both', x: 172, y: 32 },
  ],
};
