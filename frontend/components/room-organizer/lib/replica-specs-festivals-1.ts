/**
 * OnePlan 复刻规格 · 节庆类第一批（6 案）。
 * 布局按参考图整体观感近似复刻；锚点按真实案例地点（source 一律 'preset'）。
 * 参考：learning-library/oneplan-siteplans/<slug>.*（版权归 OnePlan，仅内部学习）。
 */

import type { ReplicaCaseSpec } from './replica-kit';
import { REPLICA_FLOW_COLOR } from './replica-kit';

const LINK = (slug: string) => `https://www.oneplan.io/inspiration/${slug}/`;

export const SCOTIABANK_HOCKEY_DAY_CANADA: ReplicaCaseSpec = {
  slug: 'scotiabank-hockey-day-canada',
  title: 'Scotiabank Hockey Day Canada',
  category: 'Festivals',
  region: 'North America',
  refImage: 'scotiabank-hockey-day-canada.png',
  refLink: LINK('scotiabank-hockey-day-canada'),
  anchor: { lng: -123.3716, lat: 48.4235 },
  zones: [
    { name: 'Bar 酒吧区', semantic: 'reserved', color: '#f5d716', rect: { cx: -120, cy: 30, w: 85, h: 36 } },
    { name: 'Rink 1 · NHL 街头冰球', semantic: 'stage', color: '#ec5fa8', rect: { cx: -65, cy: 22, w: 40, h: 22, rot: -35 } },
    { name: 'Rink 2 · 冰球', semantic: 'stage', color: '#ec5fa8', rect: { cx: -95, cy: -2, w: 28, h: 16, rot: -20 } },
    { name: 'Rink for All · 社区冰场', semantic: 'stage', color: '#1f4fd8', rect: { cx: 72, cy: 2, w: 42, h: 26, rot: -25 } },
    { name: 'Music Tent 音乐帐篷区', semantic: 'stage', color: '#3fb544', rect: { cx: -25, cy: -38, w: 62, h: 46 } },
    { name: 'VIP 区', semantic: 'vip', color: '#64c8e8', opacity: 0.3, rect: { cx: 50, cy: -22, w: 30, h: 20 } },
    { name: 'Hall of Fame', semantic: 'reserved', color: '#f08c2a', rect: { cx: -38, cy: 8, w: 14, h: 12 } },
    { name: 'Seating & Eating 座位餐饮', semantic: 'audience', color: '#f08c2a', rect: { cx: -52, cy: 2, w: 18, h: 12 } },
    { name: 'Container BBQ 集装箱餐区', semantic: 'reserved', color: '#35d0d8', rect: { cx: 42, cy: -8, w: 16, h: 10 } },
    { name: '停车区', semantic: 'parking', color: '#5e7fa6', rect: { cx: -120, cy: -55, w: 70, h: 45 } },
  ],
  facilities: [
    { templateId: 'oneplan:scale:pop-up-tent', name: 'Bar 帐篷', placement: { kind: 'grid', x: -150, y: 20, cols: 4, rows: 2, dx: 14, dy: 16 }, zoneIndex: 0 },
    { templateId: 'oneplan:scale:portable-toilet', name: '移动洗手间', placement: { kind: 'row', x: -128, y: 10, count: 6, dy: 3.2, rot: 90 } },
    { templateId: 'oneplan:scale:generator', name: '发电机', placement: { kind: 'scatter', at: [[-140, 6], [-135, 6]] } },
    { templateId: 'oneplan:scale:tent', name: '活动帐篷', placement: { kind: 'grid', x: 88, y: 20, cols: 2, rows: 2, dx: 9, dy: 10 } },
    { templateId: 'oneplan:scale:tent', name: '码头帐篷', placement: { kind: 'scatter', at: [[110, 45], [118, 45], [114, 38]] } },
    { templateId: 'food-truck-6x2.5', name: '餐车', placement: { kind: 'scatter', at: [[12, 12], [20, 12]] } },
    { templateId: 'stage-platform-8x6', name: '音乐舞台', placement: { kind: 'single', x: -25, y: -38 }, zoneIndex: 4 },
    { templateId: 'oneplan:scale:picnic-table', name: '野餐桌', placement: { kind: 'scatter', at: [[-40, -30], [-30, -28], [-20, -30], [-38, -44], [-28, -46], [-18, -44]] }, zoneIndex: 4 },
    { templateId: 'oneplan:scale:market-stall', name: '市集摊位', placement: { kind: 'row', x: -58, y: 18, count: 4, dy: 6 } },
    { templateId: 'trash-point-1.2x1.2', name: '垃圾收集点', placement: { kind: 'scatter', at: [[-70, 5], [30, 20], [60, -15]] } },
    { templateId: 'security-post-1.5x1.5', name: '安保岗亭', placement: { kind: 'scatter', at: [[-8, 55], [-168, 30]] } },
    { templateId: 'oneplan:icon:stanchion', name: '隔离柱 L', placement: { kind: 'row', x: -14, y: 48, count: 3, dy: -3 } },
    { templateId: 'oneplan:icon:stanchion', name: '隔离柱 R', placement: { kind: 'row', x: -2, y: 48, count: 3, dy: -3 } },
  ],
  routes: [
    { name: '人流 · 主入口→社区冰场', kind: 'pedestrian', carrier: 'walk', oneWay: true, widthM: 3, color: REPLICA_FLOW_COLOR, startNode: 0, points: [[-5, 66], [-5, 40], [0, 20], [30, 10], [55, 5]] },
    { name: '人流 · 西门→广场', kind: 'pedestrian', carrier: 'walk', oneWay: true, widthM: 3, color: REPLICA_FLOW_COLOR, startNode: 1, points: [[-176, 30], [-150, 32], [-120, 20], [-90, 10], [-60, 5], [-40, 0]] },
    { name: '人流 · 广场→音乐区→码头', kind: 'pedestrian', carrier: 'walk', oneWay: true, widthM: 3, color: REPLICA_FLOW_COLOR, points: [[0, 5], [-20, -20], [-25, -38], [-10, -55], [20, -70]] },
    { name: '车行 · 沿街维持通道', kind: 'vehicle', carrier: 'vehicle', oneWay: true, widthM: 4, points: [[-130, 84], [-60, 84], [0, 84], [60, 84], [120, 80]] },
  ],
  nodes: [
    { name: '主入口（政府街）', kind: 'both', x: -5, y: 68 },
    { name: '西侧入口', kind: 'both', x: -178, y: 30 },
    { name: '渡轮步道入口', kind: 'both', x: 120, y: -40 },
  ],
};

export const NORTH_AUSTRALIA_FESTIVAL_OF_THE_ARTS: ReplicaCaseSpec = {
  slug: 'north-australia-festival-of-the-arts',
  title: 'North Australia Festival of the Arts',
  category: 'Festivals',
  region: 'Australia & NZ',
  refImage: 'north-australia-festival-of-the-arts.png',
  refLink: LINK('north-australia-festival-of-the-arts'),
  anchor: { lng: 146.8003, lat: -19.2689 },
  locationNote: '镇级锚点：Townsville The Strand 海滨绿地',
  zones: [
    { name: 'Main Stage Marquee 主棚', semantic: 'stage', color: '#2e9e3e', circle: { cx: 0, cy: 10, r: 16 } },
    { name: 'Second Marquee 副棚', semantic: 'stage', color: '#2e9e3e', circle: { cx: -20, cy: 24, r: 12 } },
    { name: 'NAC / Silent Disco', semantic: 'audience', color: '#7fd0e8', opacity: 0.3, rect: { cx: 55, cy: 5, w: 45, h: 28 } },
    { name: 'Pinocchi Palace', semantic: 'reserved', color: '#ec5fa8', rect: { cx: 40, cy: -10, w: 18, h: 12 } },
    { name: 'Empire Theatre 大圆棚', semantic: 'stage', color: '#d93a2b', circle: { cx: 105, cy: 15, r: 15 } },
    { name: 'Bar 酒吧', semantic: 'reserved', color: '#f2f2f2', rect: { cx: 5, cy: -24, w: 20, h: 12 } },
    { name: 'Site Office / Box Office', semantic: 'checkin', color: '#f2d024', rect: { cx: 95, cy: -20, w: 16, h: 10 } },
    { name: 'Toilets 厕卫区', semantic: 'reserved', color: '#f2d024', rect: { cx: -62, cy: -16, w: 18, h: 10 } },
    { name: '市集摊位带', semantic: 'reserved', color: '#f0c0e0', opacity: 0.25, rect: { cx: -45, cy: -50, w: 40, h: 14 } },
  ],
  facilities: [
    { templateId: 'oneplan:scale:market-stall', name: '市集摊位', color: '#e8b838', placement: { kind: 'grid', x: -58, y: -55, cols: 4, rows: 2, dx: 2.6, dy: 4 } },
    { templateId: 'food-truck-6x2.5', name: '餐车（Burger Co / Pizza / Donuts）', placement: { kind: 'scatter', at: [[-8, 38], [42, 38], [-14, 28]] } },
    { templateId: 'oneplan:scale:portable-toilet', name: '移动洗手间', placement: { kind: 'row', x: -66, y: -12, count: 4, dy: 2.6, rot: 90 }, zoneIndex: 7 },
    { templateId: 'oneplan:scale:tent', name: '白帐篷', placement: { kind: 'scatter', at: [[-80, 45], [-72, 50], [-64, 54], [-58, 44]] } },
    { templateId: 'oneplan:scale:pop-up-tent', name: '黄棚', color: '#f2d024', placement: { kind: 'grid', x: 118, y: 34, cols: 2, rows: 2, dx: 4, dy: 4 } },
    { templateId: 'oneplan:icon:information-point', name: 'Box Office', placement: { kind: 'single', x: 82, y: 42 }, zoneIndex: 6 },
    { templateId: 'oneplan:icon:feather-flag', name: '道旗', placement: { kind: 'scatter', at: [[30, -18], [60, -18], [90, -4]] } },
  ],
  routes: [
    { name: '人流 · 海滩门→主线→Empire Theatre', kind: 'pedestrian', carrier: 'walk', oneWay: true, widthM: 3, color: REPLICA_FLOW_COLOR, startNode: 0, points: [[-30, 70], [-10, 40], [10, 20], [55, 15], [90, 15]] },
    { name: '人流 · 街门→市集带', kind: 'pedestrian', carrier: 'walk', oneWay: true, widthM: 3, color: REPLICA_FLOW_COLOR, startNode: 1, points: [[-95, -30], [-70, -40], [-50, -50]] },
  ],
  nodes: [
    { name: '海滩门', kind: 'both', x: -30, y: 72 },
    { name: '街门', kind: 'both', x: -97, y: -28 },
  ],
};

export const THE_NEWPORT_SHOW: ReplicaCaseSpec = {
  slug: 'the-newport-show',
  title: 'The Newport Show',
  category: 'Festivals',
  region: 'Europe',
  refImage: 'the-newport-show.png',
  refLink: LINK('the-newport-show'),
  anchor: { lng: -2.394, lat: 52.761 },
  locationNote: '镇级锚点：Newport（Shropshire）showground',
  zones: [
    { name: 'Trade Stand Lane 商贸棚列', semantic: 'reserved', color: '#f2d024', opacity: 0.25, rect: { cx: -60, cy: -5, w: 22, h: 70 } },
    { name: 'Marquee Matrix 主棚矩阵', semantic: 'reserved', color: '#bfe3c0', opacity: 0.2, rect: { cx: 45, cy: 0, w: 75, h: 60 } },
    { name: 'White Marquee Yard 白棚场', semantic: 'stage', color: '#e0e0e0', opacity: 0.25, rect: { cx: -18, cy: -8, w: 26, h: 40 } },
    { name: 'Entry Yard 入口场', semantic: 'checkin', color: '#b362c9', opacity: 0.25, rect: { cx: 105, cy: 40, w: 18, h: 14 } },
    { name: 'Family Area 家庭区', semantic: 'audience', color: '#7fb69a', opacity: 0.25, rect: { cx: 5, cy: -55, w: 40, h: 18 } },
  ],
  facilities: [
    { templateId: 'oneplan:scale:pop-up-tent', name: '绿棚', color: '#3fb544', placement: { kind: 'grid', x: 20, y: -10, cols: 4, rows: 3, dx: 6, dy: 6 } },
    { templateId: 'oneplan:scale:pop-up-tent', name: '黄棚', color: '#f2d024', placement: { kind: 'grid', x: 44, y: -10, cols: 4, rows: 3, dx: 6, dy: 6 } },
    { templateId: 'oneplan:scale:pop-up-tent', name: '红棚', color: '#d93a2b', placement: { kind: 'grid', x: 68, y: -10, cols: 3, rows: 3, dx: 6, dy: 6 } },
    { templateId: 'oneplan:scale:pop-up-tent', name: '蓝棚', color: '#2b5fd9', placement: { kind: 'grid', x: 92, y: -10, cols: 2, rows: 2, dx: 7, dy: 6 } },
    { templateId: 'oneplan:scale:pop-up-tent', name: '紫棚', color: '#b362c9', placement: { kind: 'scatter', at: [[105, 28], [112, 22]] } },
    { templateId: 'oneplan:scale:bell-tent', name: 'Trade 橙棚', color: '#e07b30', placement: { kind: 'row', x: -68, y: 20, count: 3, dy: -12 } },
    { templateId: 'oneplan:scale:bell-tent', name: 'Trade 黄棚', color: '#f2d024', placement: { kind: 'row', x: -52, y: 20, count: 3, dy: -12 } },
    { templateId: 'oneplan:scale:bell-tent', name: 'Trade 青棚', color: '#7fd0e8', placement: { kind: 'row', x: -52, y: -16, count: 3, dy: -12 } },
    { templateId: 'oneplan:scale:stretch-tent', name: '白长棚', placement: { kind: 'scatter', at: [[-18, 2], [-18, -14]] } },
    { templateId: 'oneplan:icon:entry-gate', name: '紫门', placement: { kind: 'single', x: 112, y: 42 }, zoneIndex: 3 },
    { templateId: 'oneplan:icon:feather-flag', name: '绿旗', placement: { kind: 'scatter', at: [[8, -30], [14, -62]] } },
    { templateId: 'food-truck-6x2.5', name: '餐车', placement: { kind: 'scatter', at: [[10, -48], [20, -48]] }, zoneIndex: 4 },
  ],
  routes: [
    { name: '车行 · 入场环线', kind: 'vehicle', carrier: 'vehicle', oneWay: true, widthM: 4, startNode: 0, points: [[112, 55], [80, 55], [40, 45], [0, 35], [-45, 25], [-80, 20], [-90, -20], [-60, -50], [0, -70], [60, -75], [105, 50]] },
    { name: '人流 · 入口→棚矩阵', kind: 'pedestrian', carrier: 'walk', oneWay: true, widthM: 3, color: REPLICA_FLOW_COLOR, startNode: 1, points: [[110, 38], [90, 25], [60, 10], [30, 0]] },
  ],
  nodes: [
    { name: '车道入口', kind: 'entry', x: 114, y: 56 },
    { name: '步道入口', kind: 'both', x: 112, y: 34 },
  ],
};

export const NORTHERN_NEVADA_PRIDE: ReplicaCaseSpec = {
  slug: 'northern-nevada-pride',
  title: 'Northern Nevada Pride',
  category: 'Festivals',
  region: 'North America',
  refImage: 'northern-nevada-pride.png',
  refLink: LINK('northern-nevada-pride'),
  anchor: { lng: -119.813, lat: 39.5306 },
  locationNote: '镇级锚点：Reno Wingfield Park 河滨公园',
  zones: [
    { name: 'Main Stage 主舞台', semantic: 'stage', color: '#4d7fd8', polygon: [[95, -5], [125, 5], [100, 25]] },
    { name: 'First St 摊位带', semantic: 'reserved', color: '#ec5fa8', opacity: 0.3, rect: { cx: -95, cy: 42, w: 70, h: 10, rot: -6 } },
    { name: '河滨摊位带', semantic: 'reserved', color: '#f2f2f2', opacity: 0.3, rect: { cx: -60, cy: 8, w: 80, h: 10, rot: -4 } },
    { name: 'Round Stage 圆台', semantic: 'stage', color: '#d93a2b', circle: { cx: 150, cy: 48, r: 12 } },
    { name: 'Wellness 区', semantic: 'medical', color: '#7fb69a', rect: { cx: 60, cy: -30, w: 18, h: 12 } },
    { name: 'Vendor Yard 东摊位', semantic: 'reserved', color: '#f2f2f2', opacity: 0.25, rect: { cx: 85, cy: -12, w: 34, h: 10 } },
  ],
  facilities: [
    { templateId: 'booth-2x2', name: '河滨白摊', color: '#f2f2f2', placement: { kind: 'row', x: -95, y: 8, count: 12, dx: 5.5 } },
    { templateId: 'booth-2x2', name: '南岸白摊', color: '#f2f2f2', placement: { kind: 'row', x: -20, y: -38, count: 8, dx: 5.5 } },
    { templateId: 'oneplan:scale:market-stall', name: 'First St 粉摊', color: '#ec5fa8', placement: { kind: 'row', x: -125, y: 42, count: 8, dx: 4.5 } },
    { templateId: 'oneplan:icon:first-aid-point', name: '急救点', placement: { kind: 'single', x: 62, y: -26 }, zoneIndex: 4 },
    { templateId: 'oneplan:icon:information-point', name: '信息点', placement: { kind: 'scatter', at: [[40, 20], [-10, -20]] } },
    { templateId: 'trash-point-1.2x1.2', name: '垃圾点', color: '#f2d024', placement: { kind: 'scatter', at: [[20, 15], [70, -10], [-40, 25]] } },
    { templateId: 'oneplan:icon:cone', name: '路锥', placement: { kind: 'row', x: -140, y: 30, count: 6, dx: 3 } },
  ],
  routes: [
    { name: '游行 · 河滨步道环线', kind: 'pedestrian', carrier: 'walk', oneWay: true, widthM: 3, color: REPLICA_FLOW_COLOR, startNode: 0, points: [[-140, 20], [-90, 5], [-30, -5], [30, 0], [70, 5], [110, 0], [145, 30], [110, 40], [40, 40], [-60, 35], [-130, 32]] },
  ],
  nodes: [
    { name: '桥北入口', kind: 'both', x: -142, y: 24 },
    { name: '桥南入口', kind: 'both', x: 100, y: -42 },
  ],
};

export const BASILDON_PRIDE: ReplicaCaseSpec = {
  slug: 'basildon-pride',
  title: 'Basildon Pride',
  category: 'Festivals',
  region: 'Europe',
  refImage: 'basildon-pride.png',
  refLink: LINK('basildon-pride'),
  anchor: { lng: 0.4887, lat: 51.5761 },
  locationNote: '镇级锚点：Basildon town centre（游行环线+市镇广场）',
  zones: [
    { name: 'Festival Park 节庆场', semantic: 'reserved', color: '#7fb69a', opacity: 0.3, rect: { cx: -30, cy: -55, w: 60, h: 30 } },
    { name: 'Staging Point A 集结点', semantic: 'queue', color: '#d93a2b', opacity: 0.4, circle: { cx: -45, cy: 12, r: 8 } },
    { name: 'Staging Point B 集结点', semantic: 'queue', color: '#d93a2b', opacity: 0.4, circle: { cx: 75, cy: 40, r: 8 } },
    { name: 'Assembly 集结带', semantic: 'queue', color: '#c9a22c', opacity: 0.3, rect: { cx: 40, cy: 65, w: 45, h: 12 } },
  ],
  facilities: [
    { templateId: 'oneplan:icon:stanchion', name: '隔离柱', placement: { kind: 'row', x: -60, y: -40, count: 6, dx: 3 } },
    { templateId: 'food-truck-6x2.5', name: '餐车', placement: { kind: 'scatter', at: [[-45, -60], [-30, -60]] }, zoneIndex: 0 },
    { templateId: 'oneplan:scale:market-stall', name: '市集摊位', placement: { kind: 'row', x: -50, y: -48, count: 6, dx: 2.6 }, zoneIndex: 0 },
    { templateId: 'oneplan:scale:portable-toilet', name: '移动洗手间', placement: { kind: 'row', x: -5, y: -66, count: 4, dx: 2.6, rot: 90 }, zoneIndex: 0 },
    { templateId: 'oneplan:icon:information-point', name: '信息点', placement: { kind: 'single', x: 12, y: -52 }, zoneIndex: 0 },
  ],
  routes: [
    { name: '游行 · 车队大环线', kind: 'vehicle', carrier: 'vehicle', oneWay: true, widthM: 5, startNode: 0, points: [[-45, 8], [-90, 0], [-95, -30], [-60, -40], [0, -42], [60, -40], [95, -20], [100, 15], [85, 38], [40, 62], [-10, 55], [-45, 20]] },
    { name: '人流 · Eastgate 步道', kind: 'pedestrian', carrier: 'walk', oneWay: false, widthM: 3, color: '#35c4e0', startNode: 1, points: [[95, 55], [60, 30], [30, 15], [0, 5], [-30, 5]] },
  ],
  nodes: [
    { name: '游行出发（Staging A）', kind: 'entry', x: -47, y: 10 },
    { name: '节庆场入口', kind: 'both', x: 12, y: -50 },
  ],
};

export const FIRE_IN_THE_MOUNTAIN: ReplicaCaseSpec = {
  slug: 'fire-in-the-mountain',
  title: 'Fire in the Mountain',
  category: 'Festivals',
  region: 'Europe',
  refImage: 'fire-in-the-mountain.png',
  refLink: LINK('fire-in-the-mountain'),
  anchor: { lng: -4.3, lat: 52.04 },
  locationNote: '镇级锚点：西威尔士 Ceredigion 农场',
  zones: [
    { name: 'Car Parking 停车场', semantic: 'parking', color: '#7fd0c8', opacity: 0.35, polygon: [[-160, 20], [-20, 55], [10, 15], [-90, -25], [-155, -10]] },
    { name: 'Crew Artist Vans 工作车带', semantic: 'parking', color: '#f2d744', opacity: 0.35, rect: { cx: -15, cy: 60, w: 70, h: 16, rot: -10 } },
    { name: 'Crew Camper 工作营带', semantic: 'parking', color: '#f2d744', opacity: 0.3, rect: { cx: 25, cy: 28, w: 75, h: 12, rot: -12 } },
    { name: 'Arena 主场', semantic: 'stage', color: '#c8894a', opacity: 0.35, polygon: [[10, 5], [90, -15], [110, -45], [55, -60], [-5, -35]] },
    { name: 'Family Camping 家庭营', semantic: 'reserved', color: '#5a5ad8', opacity: 0.3, polygon: [[-90, -60], [-10, -80], [10, -110], [-70, -120], [-110, -90]] },
    { name: 'Camping 露营区', semantic: 'reserved', color: '#a8d8e8', opacity: 0.3, rect: { cx: 45, cy: -70, w: 55, h: 25, rot: -12 } },
    { name: 'Crew Camping 工作营 A', semantic: 'reserved', color: '#b362c9', opacity: 0.3, rect: { cx: 130, cy: -5, w: 20, h: 22 } },
    { name: 'Crew Camping 工作营 B', semantic: 'reserved', color: '#b362c9', opacity: 0.3, rect: { cx: 155, cy: -10, w: 18, h: 20 } },
    { name: 'Drop Off 落客区', semantic: 'loading', color: '#e07b30', opacity: 0.35, rect: { cx: 52, cy: 62, w: 14, h: 9, rot: -12 } },
  ],
  facilities: [
    { templateId: 'oneplan:scale:pop-up-tent', name: '露营帐篷', color: '#e8e8f0', placement: { kind: 'grid', x: 25, y: -62, cols: 5, rows: 2, dx: 5, dy: 6 }, zoneIndex: 5 },
    { templateId: 'oneplan:scale:market-stall', name: '绿摊', color: '#3fb544', placement: { kind: 'grid', x: 120, y: -45, cols: 4, rows: 2, dx: 2.6, dy: 3.5 } },
    { templateId: 'oneplan:scale:portable-toilet', name: '移动洗手间', placement: { kind: 'row', x: 100, y: -30, count: 4, dy: 2.6, rot: 90 } },
    { templateId: 'oneplan:scale:water-refill-station', name: '加水点', placement: { kind: 'scatter', at: [[55, -50], [-30, -85]] } },
    { templateId: 'oneplan:icon:first-aid-point', name: '急救点', color: '#d93a2b', placement: { kind: 'scatter', at: [[85, -40], [128, -8]] } },
    { templateId: 'food-truck-6x2.5', name: '餐车', placement: { kind: 'single', x: 110, y: -55 } },
  ],
  routes: [
    { name: '人流 · 落客→主场', kind: 'pedestrian', carrier: 'walk', oneWay: true, widthM: 3, color: REPLICA_FLOW_COLOR, startNode: 0, points: [[50, 58], [60, 30], [70, 0], [60, -25], [45, -45]] },
    { name: '车行 · 停车场进出', kind: 'vehicle', carrier: 'vehicle', oneWay: false, widthM: 4, startNode: 1, points: [[8, 70], [-30, 45], [-80, 20], [-130, 5]] },
  ],
  nodes: [
    { name: '农场门', kind: 'both', x: 52, y: 66 },
    { name: '停车场口', kind: 'both', x: 8, y: 72 },
  ],
};
