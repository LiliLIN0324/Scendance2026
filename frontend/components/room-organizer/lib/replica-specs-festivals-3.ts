/**
 * OnePlan 复刻规格 · 节庆类第三批（9 案，节庆类收口）。
 */

import type { ReplicaCaseSpec } from './replica-kit';
import { REPLICA_FLOW_COLOR } from './replica-kit';

const LINK = (slug: string) => `https://www.oneplan.io/inspiration/${slug}/`;

export const OUTFIELD_MUSIC_FOOD_ARTS_FESTIVAL: ReplicaCaseSpec = {
  slug: 'outfield-music-food-arts-festival',
  title: 'Outfield Music, Food & Arts Festival',
  category: 'Festivals',
  region: 'Australia & NZ',
  refImage: 'outfield-music-food-arts-festival.png',
  refLink: LINK('outfield-music-food-arts-festival'),
  anchor: { lng: 176.917, lat: -39.533 },
  locationNote: '镇级锚点：Te Awanga Downs（Hawke\'s Bay, NZ 农场山谷）',
  zones: [
    { name: 'Event Field 活动场', semantic: 'stage', color: '#3fb544', opacity: 0.3, rect: { cx: -60, cy: -60, w: 55, h: 45 } },
    { name: 'Camping 露营（橙）', semantic: 'reserved', color: '#c8894a', opacity: 0.35, polygon: [[-45, -110], [5, -95], [25, -135], [-25, -150]] },
    { name: 'Camping 露营（绿）', semantic: 'reserved', color: '#3fb544', opacity: 0.3, polygon: [[-95, -135], [-45, -145], [-40, -170], [-90, -165]] },
    { name: 'Hill Carpark 山坡停车', semantic: 'parking', color: '#3fb544', opacity: 0.3, polygon: [[95, 75], [115, 40], [135, 5], [155, -20], [175, -5], [160, 40], [140, 70]] },
    { name: 'Triangle Carpark 三角停车', semantic: 'parking', color: '#3fb544', opacity: 0.35, polygon: [[130, -15], [175, 5], [185, -45], [145, -60]] },
  ],
  facilities: [
    { templateId: 'oneplan:scale:stage', name: '主舞台', color: '#2b5fd9', placement: { kind: 'single', x: -70, y: -62 }, zoneIndex: 0 },
    { templateId: 'oneplan:scale:pop-up-tent', name: '活动棚', color: '#f2d024', placement: { kind: 'scatter', at: [[-52, -55], [-44, -48], [-60, -50]] }, zoneIndex: 0 },
    { templateId: 'oneplan:scale:market-stall', name: '餐摊', color: '#ec5fa8', placement: { kind: 'row', x: -68, y: -72, count: 3, dx: 2.6 }, zoneIndex: 0 },
    { templateId: 'oneplan:scale:pop-up-tent', name: '营帐', color: '#f2f2f2', placement: { kind: 'grid', x: -80, y: -150, cols: 5, rows: 2, dx: 4, dy: 5 }, zoneIndex: 2 },
    { templateId: 'oneplan:scale:portable-toilet', name: '移动洗手间', placement: { kind: 'row', x: 140, y: -12, count: 4, dy: 2.6, rot: 90 } },
  ],
  routes: [
    { name: '车行 · 进场山路', kind: 'vehicle', carrier: 'vehicle', oneWay: true, widthM: 4, color: '#f2d024', startNode: 0, points: [[120, 60], [110, 20], [135, -30], [120, -70], [40, -100], [-20, -120], [-60, -120]] },
    { name: '人流 · 营地→活动场', kind: 'pedestrian', carrier: 'walk', oneWay: true, widthM: 3, color: REPLICA_FLOW_COLOR, startNode: 1, points: [[-45, -140], [-55, -110], [-60, -85], [-62, -68]] },
  ],
  nodes: [
    { name: '山路口', kind: 'entry', x: 122, y: 62 },
    { name: '营地门', kind: 'both', x: -46, y: -142 },
  ],
};

export const DESERT_WINEFEST: ReplicaCaseSpec = {
  slug: 'desert-winefest',
  title: 'Desert WineFest',
  category: 'Festivals',
  region: 'North America',
  refImage: 'desert-winefest.png',
  refLink: LINK('desert-winefest'),
  anchor: { lng: -116.375, lat: 33.72 },
  locationNote: '镇级锚点：Civic Center Park, Palm Desert CA',
  zones: [
    { name: 'Tasting Matrix A 品酒阵 A', semantic: 'reserved', color: '#2b5fd9', opacity: 0.12, rect: { cx: 5, cy: 5, w: 55, h: 35 } },
    { name: 'Tasting Matrix B 品酒阵 B', semantic: 'reserved', color: '#2b5fd9', opacity: 0.12, rect: { cx: 70, cy: 5, w: 45, h: 30 } },
    { name: 'Tasting Matrix C 品酒阵 C', semantic: 'reserved', color: '#2b5fd9', opacity: 0.12, rect: { cx: 5, cy: -35, w: 55, h: 28 } },
    { name: 'Tasting Matrix D 品酒阵 D', semantic: 'reserved', color: '#2b5fd9', opacity: 0.12, rect: { cx: 70, cy: -38, w: 45, h: 22 } },
    { name: 'Stage 区', semantic: 'stage', color: '#f2d024', opacity: 0.25, rect: { cx: -50, cy: 25, w: 25, h: 14 } },
    { name: 'Food Trucks 餐车带', semantic: 'reserved', color: '#3fb544', opacity: 0.2, rect: { cx: 25, cy: 52, w: 60, h: 12 } },
    { name: 'Entry 入口', semantic: 'checkin', color: '#f2d024', opacity: 0.3, rect: { cx: 118, cy: -8, w: 14, h: 12 } },
  ],
  facilities: [
    { templateId: 'booth-2x2', name: '品酒摊（蓝）', color: '#2b5fd9', placement: { kind: 'grid', x: -12, y: -8, cols: 6, rows: 4, dx: 4, dy: 5 }, zoneIndex: 0 },
    { templateId: 'booth-2x2', name: '品酒摊（黄）', color: '#f2d024', placement: { kind: 'grid', x: 52, y: -8, cols: 5, rows: 4, dx: 4, dy: 5 }, zoneIndex: 1 },
    { templateId: 'booth-2x2', name: '品酒摊（蓝·南）', color: '#2b5fd9', placement: { kind: 'grid', x: -12, y: -45, cols: 6, rows: 3, dx: 4, dy: 4.5 }, zoneIndex: 2 },
    { templateId: 'booth-2x2', name: '品酒摊（黄·南）', color: '#f2d024', placement: { kind: 'grid', x: 52, y: -45, cols: 5, rows: 3, dx: 4, dy: 4.5 }, zoneIndex: 3 },
    { templateId: 'food-truck-6x2.5', name: 'Food Truck', placement: { kind: 'row', x: 0, y: 56, count: 4, dx: 12 }, zoneIndex: 5 },
    { templateId: 'oneplan:scale:stage', name: 'Stage', placement: { kind: 'single', x: -50, y: 25 }, zoneIndex: 4 },
    { templateId: 'oneplan:scale:pop-up-tent', name: '白大帐', color: '#f2f2f2', placement: { kind: 'single', x: 62, y: -70 } },
    { templateId: 'toilet-2.4x1.2', name: 'WC', placement: { kind: 'row', x: 45, y: -78, count: 3, dx: 2.6 } },
    { templateId: 'oneplan:icon:atm', name: 'ATM', placement: { kind: 'scatter', at: [[-40, 30], [-38, 20]] } },
  ],
  routes: [
    { name: '人流 · 入口→品酒阵', kind: 'pedestrian', carrier: 'walk', oneWay: true, widthM: 3, color: REPLICA_FLOW_COLOR, startNode: 0, points: [[115, -8], [85, 0], [45, 5], [0, 5], [-40, 10]] },
    { name: '人流 · 餐车带', kind: 'pedestrian', carrier: 'walk', oneWay: false, widthM: 3, color: '#d93a2b', points: [[-20, 45], [10, 50], [55, 52]] },
  ],
  nodes: [
    { name: '主入口', kind: 'both', x: 118, y: -8 },
    { name: '东出口', kind: 'exit', x: 112, y: -35 },
  ],
};

export const SPEARFISH_FESTIVAL_IN_THE_PARK: ReplicaCaseSpec = {
  slug: '45th-spearfish-festival-in-the-park',
  title: '45th Spearfish Festival in the Park',
  category: 'Festivals',
  region: 'North America',
  refImage: '45th-spearfish-festival-in-the-park.png',
  refLink: LINK('45th-spearfish-festival-in-the-park'),
  anchor: { lng: -103.855, lat: 44.488 },
  locationNote: '镇级锚点：Spearfish City Park (SD)',
  zones: [
    { name: 'Parking North 北停车', semantic: 'parking', color: '#a8d8e8', opacity: 0.35, rect: { cx: 0, cy: 55, w: 95, h: 10 } },
    { name: 'Parking Yellow 黄停车', semantic: 'parking', color: '#f2d024', opacity: 0.3, rect: { cx: 5, cy: 44, w: 85, h: 8 } },
    { name: 'Street Closure 街封闭', semantic: 'reserved', color: '#e07b30', opacity: 0.25, rect: { cx: 0, cy: 33, w: 130, h: 6 } },
    { name: 'Vendor Curve 摊位弧区', semantic: 'reserved', color: '#e07b30', opacity: 0.3, rect: { cx: 30, cy: 8, w: 22, h: 16 } },
    { name: 'Kids Zone 儿童区', semantic: 'audience', color: '#ec5fa8', opacity: 0.3, polygon: [[135, 22], [165, 15], [172, -5], [148, -12], [132, 0]] },
    { name: 'Food Court 餐饮区', semantic: 'reserved', color: '#e07b30', opacity: 0.25, rect: { cx: -15, cy: -30, w: 18, h: 12 } },
  ],
  facilities: [
    { templateId: 'booth-2x2', name: '白摊（西弧）', color: '#f2f2f2', placement: { kind: 'grid', x: -55, y: 5, cols: 4, rows: 3, dx: 5, dy: 6 } },
    { templateId: 'booth-2x2', name: '白摊（东弧）', color: '#f2f2f2', placement: { kind: 'grid', x: 65, y: -8, cols: 5, rows: 3, dx: 5, dy: 6 } },
    { templateId: 'oneplan:scale:tent', name: 'X 大帐', color: '#f2f2f2', placement: { kind: 'single', x: -12, y: 18 } },
    { templateId: 'oneplan:scale:pop-up-tent', name: '蓝小棚', color: '#2b5fd9', placement: { kind: 'single', x: -10, y: -5 } },
    { templateId: 'oneplan:icon:first-aid-point', name: '急救点', color: '#3fb544', placement: { kind: 'scatter', at: [[125, 12], [-88, -12]] } },
    { templateId: 'oneplan:scale:portable-toilet', name: '移动洗手间', placement: { kind: 'row', x: 88, y: 20, count: 3, dy: 2.6, rot: 90 } },
    { templateId: 'food-truck-6x2.5', name: '餐车', placement: { kind: 'scatter', at: [[-22, -34], [-10, -34]] }, zoneIndex: 5 },
  ],
  routes: [
    { name: '人流 · 南北穿越', kind: 'pedestrian', carrier: 'walk', oneWay: true, widthM: 3, color: REPLICA_FLOW_COLOR, startNode: 0, points: [[-40, -50], [-30, -25], [-15, 0], [5, 20], [25, 40]] },
    { name: '车行 · 北街绕行', kind: 'vehicle', carrier: 'vehicle', oneWay: true, widthM: 4, points: [[-70, 55], [0, 58], [70, 55]] },
  ],
  nodes: [
    { name: '南入口', kind: 'both', x: -42, y: -52 },
    { name: '北口', kind: 'exit', x: 27, y: 52 },
  ],
};

export const RIVERSIDE_FESTIVAL_QC: ReplicaCaseSpec = {
  slug: 'riverside-festival',
  title: 'Riverside Festival',
  category: 'Festivals',
  region: 'North America',
  refImage: 'riverside-festival.png',
  refLink: LINK('riverside-festival'),
  anchor: { lng: -73.531, lat: 45.558 },
  locationNote: '镇级锚点：Parc Jean-Drapeau（Montreal）门区特写',
  zones: [
    { name: 'Gate Yard 门区', semantic: 'checkin', color: '#d0d0d0', opacity: 0.2, rect: { cx: 30, cy: -10, w: 50, h: 25 } },
    { name: 'Truck Row 工作车列', semantic: 'loading', color: '#8a8f96', opacity: 0.3, rect: { cx: -55, cy: -25, w: 25, h: 50, rot: 12 } },
    { name: 'Production Yard 制作场', semantic: 'reserved', color: '#f2f2f2', opacity: 0.25, rect: { cx: 90, cy: -18, w: 30, h: 22 } },
  ],
  facilities: [
    { templateId: 'oneplan:scale:bus', name: '工作大巴', color: '#5b6470', placement: { kind: 'row', x: -60, y: -5, count: 4, dy: -12, rot: 100 }, zoneIndex: 1 },
    { templateId: 'oneplan:scale:tent', name: 'TL50 工作棚', color: '#f2f2f2', placement: { kind: 'scatter', at: [[8, 18], [-42, 45], [95, -5], [95, -30]] } },
    { templateId: 'oneplan:scale:food-trailer', name: '工作拖车', color: '#5b6470', placement: { kind: 'single', x: -38, y: -78 }, zoneIndex: 1 },
    { templateId: 'oneplan:icon:wifi', name: '通讯点', color: '#e87ab8', placement: { kind: 'scatter', at: [[18, 52], [88, 42], [-10, -60]] } },
    { templateId: 'oneplan:icon:bollard', name: '红桩', color: '#d93a2b', placement: { kind: 'scatter', at: [[2, 28], [-8, 10], [82, 30], [92, 5]] } },
    { templateId: 'oneplan:icon:stanchion', name: '隔离柱', color: '#2b5fd9', placement: { kind: 'row', x: 55, y: 5, count: 5, dx: 2.2 } },
    { templateId: 'oneplan:scale:picnic-table', name: '木凳排', color: '#a06a3a', placement: { kind: 'grid', x: 25, y: -50, cols: 3, rows: 4, dx: 4, dy: 7, rot: 15 } },
  ],
  routes: [
    { name: '车行 · 工作车进场', kind: 'vehicle', carrier: 'vehicle', oneWay: true, widthM: 4, startNode: 0, points: [[-95, 45], [-70, 20], [-55, -10], [-50, -45], [-20, -70]] },
    { name: '人流 · 门区通道', kind: 'pedestrian', carrier: 'walk', oneWay: true, widthM: 3, color: REPLICA_FLOW_COLOR, startNode: 1, points: [[70, -5], [50, -5], [32, -8], [15, -5]] },
  ],
  nodes: [
    { name: '车道口', kind: 'entry', x: -97, y: 47 },
    { name: '步道口', kind: 'both', x: 72, y: -5 },
  ],
};

export const NATIONAL_CHERRY_FESTIVAL: ReplicaCaseSpec = {
  slug: 'national-cherry-festival',
  title: 'National Cherry Festival',
  category: 'Festivals',
  region: 'North America',
  refImage: 'national-cherry-festival.png',
  refLink: LINK('national-cherry-festival'),
  anchor: { lng: -85.623882, lat: 44.766579 },
  rotationDeg: 349,
  locationNote: '镇级锚点：Traverse City Open Space Park（Bayfront）',
  zones: [
    { name: 'Pier Lawn 突堤草坪', semantic: 'audience', color: '#e07b30', opacity: 0.15, polygon: [[-15, 55], [40, 58], [45, 15], [10, 8], [-20, 20]] },
    { name: 'Center Lawn 中草坪', semantic: 'audience', color: '#e07b30', opacity: 0.15, polygon: [[-120, -10], [-20, -18], [5, -45], [-90, -50], [-140, -30]] },
    { name: 'Marina Lawn 游艇草坪', semantic: 'reserved', color: '#e07b30', opacity: 0.12, polygon: [[95, -35], [165, -45], [175, 5], [110, 12]] },
    { name: 'Old Town 西园区', semantic: 'reserved', color: '#e07b30', opacity: 0.12, polygon: [[-160, -35], [-105, -62], [-95, -110], [-165, -95]] },
    { name: 'VIP 台', semantic: 'vip', color: '#b3628c', opacity: 0.3, rect: { cx: -62, cy: -38, w: 16, h: 10 } },
    { name: 'Main Stage 主舞台', semantic: 'stage', color: '#2b5fd9', opacity: 0.4, rect: { cx: -95, cy: -72, w: 22, h: 12 } },
  ],
  facilities: [
    { templateId: 'oneplan:scale:pop-up-tent', name: '突堤白帐', color: '#f2f2f2', placement: { kind: 'grid', x: 8, y: 42, cols: 4, rows: 2, dx: 6, dy: 7 }, zoneIndex: 0 },
    { templateId: 'oneplan:scale:stretch-tent', name: 'X 大白帐', color: '#f2f2f2', placement: { kind: 'single', x: 8, y: 32 }, zoneIndex: 0 },
    { templateId: 'booth-2x2', name: '蓝摊排', color: '#2b5fd9', placement: { kind: 'grid', x: -70, y: -22, cols: 5, rows: 2, dx: 4, dy: 4.5 }, zoneIndex: 1 },
    { templateId: 'oneplan:scale:picnic-table', name: '野餐桌', color: '#a06a3a', placement: { kind: 'grid', x: 18, y: -60, cols: 5, rows: 4, dx: 3, dy: 4 } },
    { templateId: 'food-truck-6x2.5', name: '红餐车', color: '#c0392b', placement: { kind: 'row', x: -118, y: -18, count: 3, dx: 7 } },
    { templateId: 'oneplan:scale:tent', name: '红长棚', color: '#c0392b', placement: { kind: 'scatter', at: [[-125, -35], [-88, -95]] } },
    { templateId: 'oneplan:scale:stage', name: '蓝舞台', color: '#2b5fd9', placement: { kind: 'single', x: -95, y: -72 }, zoneIndex: 5 },
    { templateId: 'oneplan:scale:portable-toilet', name: '移动洗手间', color: '#2b5fd9', placement: { kind: 'row', x: -30, y: -30, count: 6, dy: 2.6, rot: 90 } },
    { templateId: 'oneplan:icon:boat', name: '码头', placement: { kind: 'single', x: 55, y: 60 } },
    { templateId: 'trash-point-1.2x1.2', name: '垃圾点', color: '#f2d024', placement: { kind: 'scatter', at: [[-50, 25], [60, -40], [130, 30]] } },
  ],
  routes: [
    { name: '人流 · 西园→中草坪→突堤', kind: 'pedestrian', carrier: 'walk', oneWay: true, widthM: 3, color: REPLICA_FLOW_COLOR, startNode: 0, points: [[-155, -80], [-120, -45], [-70, -15], [-20, 10], [15, 30]] },
    { name: '人流 · 街东→游艇草坪', kind: 'pedestrian', carrier: 'walk', oneWay: true, widthM: 3, color: '#2b5fd9', startNode: 1, points: [[95, -70], [120, -45], [140, -25]] },
  ],
  nodes: [
    { name: '西园口', kind: 'both', x: -158, y: -84 },
    { name: '东街口', kind: 'both', x: 96, y: -74 },
  ],
};

export const ASHFIELD_DAY: ReplicaCaseSpec = {
  slug: 'ashfield-day',
  title: 'Ashfield Day',
  category: 'Festivals',
  region: 'Europe',
  refImage: 'ashfield-day.png',
  refLink: LINK('ashfield-day'),
  anchor: { lng: -1.248605, lat: 53.124678 },
  rotationDeg: 6,
  locationNote: '镇级锚点：Sutton Lawn, Sutton-in-Ashfield (UK)',
  zones: [
    { name: 'Fun For All Zone 全龄游乐区', semantic: 'audience', color: '#f2d024', opacity: 0.25, polygon: [[-95, 25], [-30, 35], [-25, -40], [-90, -45]] },
    { name: 'Entertainment Zone 演出区', semantic: 'stage', color: '#2b5fd9', opacity: 0.25, polygon: [[-8, 15], [60, 20], [80, -35], [10, -45], [-15, -20]] },
    { name: 'Green Zone 绿区', semantic: 'reserved', color: '#3fb544', opacity: 0.25, polygon: [[5, 45], [45, 48], [50, 22], [8, 20]] },
    { name: 'Skate Zone 轮滑区', semantic: 'audience', color: '#a8d8e8', opacity: 0.3, polygon: [[130, 55], [175, 50], [170, 15], [135, 20]] },
    { name: 'Xtreme Bike 极限单车区', semantic: 'reserved', color: '#c0392b', opacity: 0.25, polygon: [[85, 42], [120, 38], [125, 12], [88, 15]] },
    { name: 'Fun Fair 游乐区（粉）', semantic: 'reserved', color: '#ec5fa8', opacity: 0.25, rect: { cx: 110, cy: 2, w: 22, h: 20 } },
    { name: 'Water Safety 水上安全', semantic: 'medical', color: '#3aa08c', opacity: 0.3, polygon: [[175, -10], [215, -18], [210, -50], [172, -42]] },
    { name: 'Heliweb 停机坪', semantic: 'loading', color: '#e07b30', opacity: 0.3, rect: { cx: 60, cy: -85, w: 22, h: 14 } },
  ],
  facilities: [
    { templateId: 'oneplan:scale:market-stall', name: '粉摊', color: '#ec5fa8', placement: { kind: 'scatter', at: [[-80, 15], [-70, 8], [-58, 12], [-46, 5], [-38, -10], [-52, -18], [-66, -25], [-80, -22]] }, zoneIndex: 0 },
    { templateId: 'oneplan:icon:carnival', name: '游乐设施', color: '#e07b30', placement: { kind: 'scatter', at: [[-35, 0], [-20, -25], [-45, -30]] }, zoneIndex: 0 },
    { templateId: 'oneplan:scale:stage', name: '白棚舞台', color: '#f2f2f2', placement: { kind: 'single', x: 22, y: 30 }, zoneIndex: 2 },
    { templateId: 'oneplan:icon:themepark', name: '摩天轮', color: '#e8b838', placement: { kind: 'single', x: -45, y: 18 }, zoneIndex: 0 },
    { templateId: 'oneplan:icon:bouncy-castle', name: '充气堡', color: '#ec5fa8', placement: { kind: 'scatter', at: [[15, -10], [45, -15], [75, -5]] }, zoneIndex: 1 },
    { templateId: 'oneplan:icon:first-aid-point', name: '急救点', color: '#d93a2b', placement: { kind: 'scatter', at: [[-30, -42], [88, -20], [178, -25]] } },
    { templateId: 'oneplan:scale:portable-toilet', name: '移动洗手间', color: '#2b5fd9', placement: { kind: 'row', x: -12, y: -35, count: 4, dy: 2.6, rot: 90 } },
    { templateId: 'oneplan:icon:information-point', name: '信息点', color: '#3fb544', placement: { kind: 'scatter', at: [[-95, 30], [55, 45]] } },
  ],
  routes: [
    { name: '人流 · 大门→游乐区→演出区', kind: 'pedestrian', carrier: 'walk', oneWay: true, widthM: 3, color: REPLICA_FLOW_COLOR, startNode: 0, points: [[-115, -60], [-95, -35], [-75, -10], [-55, 10], [-30, 25]] },
    { name: '人流 · 分流线（蓝）', kind: 'pedestrian', carrier: 'walk', oneWay: false, widthM: 3, color: '#35c4e0', startNode: 1, points: [[-135, 10], [-105, 20], [-80, 35]] },
  ],
  nodes: [
    { name: '主入口', kind: 'both', x: -118, y: -62 },
    { name: '西侧步道口', kind: 'both', x: -138, y: 8 },
  ],
};

export const SPILTROCK_SUMMERJAM: ReplicaCaseSpec = {
  slug: 'spiltrock-summerjam',
  title: 'Spiltrock Summerjam',
  category: 'Festivals',
  region: 'North America',
  refImage: 'spiltrock-summerjam.png',
  refLink: LINK('spiltrock-summerjam'),
  anchor: { lng: -116.95, lat: 34.24 },
  locationNote: '镇级锚点：南加州沙漠山地营区（Big Bear 一带口径）',
  zones: [
    { name: 'West Pines Parking', semantic: 'parking', color: '#3fb544', opacity: 0.25, polygon: [[-15, 45], [45, 60], [75, 30], [40, 5], [-5, 15]] },
    { name: 'Private Parking Day Passes', semantic: 'parking', color: '#f2d024', opacity: 0.25, polygon: [[85, 40], [150, 55], [175, 10], [115, -5], [80, 10]] },
    { name: 'West Parking Weekend', semantic: 'parking', color: '#3fb544', opacity: 0.25, polygon: [[-70, 20], [-10, 25], [-15, -20], [-75, -25]] },
    { name: 'Boulders Parking', semantic: 'parking', color: '#3fb544', opacity: 0.25, polygon: [[-25, -35], [45, -30], [55, -65], [-20, -70]] },
    { name: 'RockTan Parking', semantic: 'parking', color: '#3fb544', opacity: 0.25, polygon: [[-130, -40], [-55, -45], [-60, -85], [-140, -80]] },
    { name: 'Peaceful Valley Weekend', semantic: 'parking', color: '#3fb544', opacity: 0.25, polygon: [[145, -55], [215, -45], [220, -85], [150, -95]] },
    { name: 'Central Camp 中央营', semantic: 'reserved', color: '#b362c9', opacity: 0.35, polygon: [[20, -5], [55, 5], [60, -20], [35, -30], [15, -20]] },
    { name: 'General Camping Tender 通用营', semantic: 'reserved', color: '#c8894a', opacity: 0.3, polygon: [[10, -85], [90, -75], [105, -115], [25, -125], [-5, -100]] },
  ],
  facilities: [
    { templateId: 'oneplan:icon:feather-flag', name: '旗标', color: '#ec5fa8', placement: { kind: 'scatter', at: [[30, 40], [100, 45], [175, 20], [150, -70], [40, -100]] } },
    { templateId: 'oneplan:scale:pop-up-tent', name: '营帐', color: '#f2f2f2', placement: { kind: 'grid', x: 22, y: -95, cols: 5, rows: 2, dx: 4.5, dy: 5 }, zoneIndex: 7 },
    { templateId: 'oneplan:icon:information-point', name: '服务点', color: '#2b5fd9', placement: { kind: 'row', x: 25, y: 0, count: 3, dx: 3 }, zoneIndex: 6 },
    { templateId: 'oneplan:scale:water-refill-station', name: '加水点', placement: { kind: 'scatter', at: [[38, -18], [-60, -60]] } },
  ],
  routes: [
    { name: '车行 · 黄土路主线', kind: 'vehicle', carrier: 'vehicle', oneWay: true, widthM: 4, color: '#f2d024', startNode: 0, points: [[-165, -90], [-120, -60], [-70, -40], [-10, -20], [60, -10], [120, -35], [190, -60]] },
    { name: '人流 · 营区连线', kind: 'pedestrian', carrier: 'walk', oneWay: false, widthM: 3, color: '#f2d024', startNode: 1, points: [[0, -70], [20, -50], [35, -30], [40, -60], [30, -90]] },
  ],
  nodes: [
    { name: '西口', kind: 'entry', x: -167, y: -92 },
    { name: '营口', kind: 'both', x: 2, y: -72 },
  ],
};

export const START_ON_THE_STREET: ReplicaCaseSpec = {
  slug: 'start-on-the-street',
  title: 'stART on the Street',
  category: 'Festivals',
  region: 'North America',
  refImage: 'start-on-the-street.png',
  refLink: LINK('start-on-the-street'),
  anchor: { lng: -71.8023, lat: 42.2626 },
  locationNote: '镇级锚点：Worcester MA 街区节（Park Ave 口径）',
  zones: [
    { name: 'Food Truck Court 餐车广场', semantic: 'reserved', color: '#c8894a', opacity: 0.3, rect: { cx: 95, cy: -8, w: 62, h: 16 } },
    { name: 'Shop Parking 商户停车', semantic: 'parking', color: '#b362c9', opacity: 0.3, rect: { cx: 148, cy: -10, w: 16, h: 22 } },
    { name: 'Booth Row East 东摊带', semantic: 'reserved', color: '#3fb544', opacity: 0.25, rect: { cx: 20, cy: -6, w: 55, h: 7 } },
    { name: 'Booth Row West 西摊带', semantic: 'reserved', color: '#ec5fa8', opacity: 0.25, rect: { cx: -60, cy: -2, w: 55, h: 7 } },
  ],
  facilities: [
    { templateId: 'booth-2x2', name: '绿摊', color: '#3fb544', placement: { kind: 'row', x: -5, y: -4, count: 10, dx: 4.2 }, zoneIndex: 2 },
    { templateId: 'booth-2x2', name: '粉摊', color: '#ec5fa8', placement: { kind: 'row', x: -5, y: -9, count: 10, dx: 4.2 }, zoneIndex: 2 },
    { templateId: 'booth-2x2', name: '西绿大帐', color: '#3fb544', placement: { kind: 'grid', x: -92, y: -6, cols: 3, rows: 1, dx: 5 }, zoneIndex: 3 },
    { templateId: 'booth-2x2', name: '西粉大帐', color: '#ec5fa8', placement: { kind: 'grid', x: -92, y: -12, cols: 3, rows: 1, dx: 5 }, zoneIndex: 3 },
    { templateId: 'oneplan:scale:round-table-and-chairs', name: '圆桌座', color: '#f2d024', placement: { kind: 'grid', x: 68, y: -8, cols: 8, rows: 2, dx: 6, dy: 7 }, zoneIndex: 0 },
    { templateId: 'oneplan:scale:bus', name: '蓝食巴', color: '#2b5fd9', placement: { kind: 'single', x: -32, y: -8 } },
    { templateId: 'oneplan:icon:ticket-check', name: '入口核票', color: '#3fb544', placement: { kind: 'single', x: 55, y: -14 }, zoneIndex: 0 },
    { templateId: 'oneplan:scale:car', name: '门店车', color: '#2b5fd9', placement: { kind: 'single', x: 145, y: -10 }, zoneIndex: 1 },
  ],
  routes: [
    { name: '人流 · 街道主动线', kind: 'pedestrian', carrier: 'walk', oneWay: true, widthM: 3, color: REPLICA_FLOW_COLOR, startNode: 0, points: [[-135, -8], [-90, -6], [-30, -5], [30, -5], [90, -5], [140, -5]] },
    { name: '人流 · 餐车广场环', kind: 'pedestrian', carrier: 'walk', oneWay: false, widthM: 3, color: '#e07b30', points: [[70, 5], [95, 8], [120, 5], [135, -2]] },
  ],
  nodes: [
    { name: '西门', kind: 'both', x: -137, y: -8 },
    { name: '东门', kind: 'both', x: 142, y: -5 },
  ],
};

export const HALLOWEEN_FIREWORK_SPOOKTACULAR: ReplicaCaseSpec = {
  slug: 'halloween-firework-spooktacular',
  title: 'Halloween Firework Spooktacular',
  category: 'Festivals',
  region: 'Europe',
  refImage: 'halloween-firework-spooktacular.png',
  refLink: LINK('halloween-firework-spooktacular'),
  anchor: { lng: -1.2389, lat: 51.6743 },
  locationNote: '镇级锚点：Abingdon Airfield, Oxfordshire（机场草坪烟火夜）',
  zones: [
    { name: 'Runway Parking 跑道停车', semantic: 'parking', color: '#c0392b', opacity: 0.35, polygon: [[-200, 8], [10, 8], [10, -6], [-200, -8]] },
    { name: 'Compound 制作围场', semantic: 'reserved', color: '#ec5fa8', opacity: 0.3, polygon: [[14, 6], [55, 6], [60, -8], [14, -8]] },
    { name: 'Crowd Wedge A 观演楔 A', semantic: 'audience', color: '#7fd0e8', opacity: 0.3, polygon: [[62, 6], [95, 2], [120, 8], [95, 14], [65, 12]] },
    { name: 'Crowd Wedge B 观演楔 B', semantic: 'audience', color: '#7fd0e8', opacity: 0.3, polygon: [[66, -10], [100, -14], [125, -8], [100, -2], [68, -2]] },
    { name: 'Grass Field 草场停车', semantic: 'parking', color: '#f2d024', opacity: 0.3, polygon: [[130, 12], [175, 18], [180, -60], [135, -65]] },
    { name: 'Fireworks 发射区', semantic: 'reserved', color: '#e07b30', opacity: 0.3, rect: { cx: 100, cy: -25, w: 16, h: 8 } },
  ],
  facilities: [
    { templateId: 'oneplan:scale:portable-toilet', name: '移动洗手间', color: '#7fd0e8', placement: { kind: 'row', x: 88, y: 6, count: 6, dx: 2.6, rot: 90 }, zoneIndex: 2 },
    { templateId: 'oneplan:scale:portable-toilet', name: '移动洗手间 B', color: '#7fd0e8', placement: { kind: 'row', x: 88, y: -6, count: 6, dx: 2.6, rot: 90 }, zoneIndex: 3 },
    { templateId: 'food-truck-6x2.5', name: '餐车', color: '#e07b30', placement: { kind: 'single', x: 72, y: -18 } },
    { templateId: 'oneplan:scale:pop-up-tent', name: '橙棚', color: '#e07b30', placement: { kind: 'single', x: 82, y: -12 } },
    { templateId: 'oneplan:icon:feather-flag', name: '黄旗', color: '#f2d024', placement: { kind: 'row', x: 80, y: 12, count: 6, dx: 3.5 } },
    { templateId: 'security-post-1.5x1.5', name: '安保岗亭', placement: { kind: 'single', x: 18, y: 2 }, zoneIndex: 1 },
    { templateId: 'oneplan:icon:first-aid-point', name: '急救点', color: '#d93a2b', placement: { kind: 'single', x: 20, y: -2 }, zoneIndex: 1 },
  ],
  routes: [
    { name: '人流 · 跑道→观演楔', kind: 'pedestrian', carrier: 'walk', oneWay: true, widthM: 3, color: '#2b5fd9', startNode: 0, points: [[12, 0], [30, -2], [50, -4], [70, -5], [90, -4]] },
    { name: '车行 · 草场停车进出', kind: 'vehicle', carrier: 'vehicle', oneWay: true, widthM: 4, startNode: 1, points: [[150, 30], [148, 0], [145, -30], [140, -58]] },
  ],
  nodes: [
    { name: '跑道口', kind: 'both', x: 12, y: 2 },
    { name: '草场口', kind: 'entry', x: 152, y: 32 },
  ],
};
