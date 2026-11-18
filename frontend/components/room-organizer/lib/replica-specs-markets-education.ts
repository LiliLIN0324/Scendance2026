/**
 * OnePlan 复刻规格 · 市集/展会（6 案）+ 教育（2 案）——45 案收口。
 */

import type { ReplicaCaseSpec } from './replica-kit';
import { REPLICA_FLOW_COLOR } from './replica-kit';

const LINK = (slug: string) => `https://www.oneplan.io/inspiration/${slug}/`;

export const CHRISTMAS_IN_JULY: ReplicaCaseSpec = {
  slug: 'christmas-in-july',
  title: 'Christmas in July',
  category: 'Market, Fairs & Shows',
  region: 'North America',
  refImage: 'christmas-in-july.png',
  refLink: LINK('christmas-in-july'),
  anchor: { lng: -77.586, lat: 38.202 },
  locationNote: '精确锚点：Revatone Farm, Spotsylvania VA',
  zones: [
    { name: 'Accessible Parking 无障碍停车', semantic: 'parking', color: '#2b5fd9', opacity: 0.3, rect: { cx: 75, cy: -18, w: 60, h: 12 } },
    { name: 'Farm Yard 农场院', semantic: 'reserved', color: '#a06a3a', opacity: 0.2, rect: { cx: -5, cy: 25, w: 40, h: 35 } },
    { name: 'Booth Fields 摊位田', semantic: 'reserved', color: '#f2f2f2', opacity: 0.12, rect: { cx: 25, cy: -40, w: 110, h: 70 } },
  ],
  facilities: [
    { templateId: 'booth-2x2', name: '白摊排 A', color: '#f2f2f2', placement: { kind: 'grid', x: 45, y: -30, cols: 3, rows: 2, dx: 5, dy: 8 } },
    { templateId: 'booth-2x2', name: '白摊排 B', color: '#f2f2f2', placement: { kind: 'grid', x: 70, y: -35, cols: 3, rows: 2, dx: 5, dy: 8 } },
    { templateId: 'booth-2x2', name: '白摊排 C', color: '#f2f2f2', placement: { kind: 'grid', x: -20, y: -50, cols: 4, rows: 1, dx: 5 } },
    { templateId: 'booth-2x2', name: '白摊排 D', color: '#f2f2f2', placement: { kind: 'grid', x: -35, y: -20, cols: 3, rows: 2, dx: 5, dy: 7 } },
    { templateId: 'oneplan:scale:pop-up-tent', name: '橙大帐', color: '#e07b30', placement: { kind: 'single', x: -10, y: -35 } },
    { templateId: 'oneplan:scale:pop-up-tent', name: '红块', color: '#c0392b', placement: { kind: 'single', x: -30, y: -28 } },
    { templateId: 'oneplan:icon:camping', name: '营火点', color: '#e07b30', placement: { kind: 'single', x: 5, y: -15 } },
    { templateId: 'oneplan:icon:first-aid-point', name: '急救点', color: '#c0392b', placement: { kind: 'scatter', at: [[68, 30], [55, -90]] } },
    { templateId: 'oneplan:icon:information-point', name: '信息点', color: '#2b5fd9', placement: { kind: 'scatter', at: [[-8, 38], [-18, 30]] } },
    { templateId: 'oneplan:icon:photo-point', name: '花点', color: '#3aa08c', placement: { kind: 'single', x: -65, y: -5 } },
  ],
  routes: [
    { name: '人流 · 农场院→摊位田', kind: 'pedestrian', carrier: 'walk', oneWay: true, widthM: 3, color: REPLICA_FLOW_COLOR, startNode: 0, points: [[-5, 45], [0, 20], [10, -10], [30, -35], [70, -50]] },
  ],
  nodes: [
    { name: '农场门', kind: 'both', x: -7, y: 47 },
  ],
};

export const GC_LIVE_STARRY_NIGHTS: ReplicaCaseSpec = {
  slug: 'gc-live-starry-nights-at-dean-castle',
  title: 'GC Live: Starry Nights at Dean Castle',
  category: 'Market, Fairs & Shows',
  region: 'Europe',
  refImage: 'gc-live-starry-nights-at-dean-castle.png',
  refLink: LINK('gc-live-starry-nights-at-dean-castle'),
  anchor: { lng: -4.493, lat: 55.612 },
  locationNote: '镇级锚点：Dean Castle Country Park, Kilmarnock（参考图为灯光隧道实景，按灯光小径复刻）',
  zones: [
    { name: 'Light Tunnel 灯光隧道段', semantic: 'audience', color: '#2b5fd9', opacity: 0.2, rect: { cx: 0, cy: 0, w: 80, h: 14 } },
    { name: 'Star Canopy 星幕段', semantic: 'audience', color: '#7fd0e8', opacity: 0.2, rect: { cx: 60, cy: 20, w: 45, h: 12, rot: 30 } },
    { name: 'Food Shed 餐饮棚', semantic: 'reserved', color: '#e07b30', opacity: 0.3, rect: { cx: -50, cy: -18, w: 22, h: 12 } },
    { name: 'Castle Yard 城堡院', semantic: 'stage', color: '#f2d024', opacity: 0.2, rect: { cx: -85, cy: 15, w: 40, h: 30 } },
  ],
  facilities: [
    { templateId: 'oneplan:icon:street-lamp', name: '灯柱', color: '#7fd0e8', placement: { kind: 'row', x: -35, y: -6, count: 14, dx: 5 } },
    { templateId: 'oneplan:icon:street-lamp', name: '灯柱（星幕）', color: '#f2f2f2', placement: { kind: 'row', x: 45, y: 12, count: 8, dx: 4, rot: 30 } },
    { templateId: 'food-truck-6x2.5', name: '餐车', placement: { kind: 'single', x: -50, y: -18 }, zoneIndex: 2 },
    { templateId: 'oneplan:icon:first-aid-point', name: '急救点', color: '#c0392b', placement: { kind: 'single', x: -55, y: -10 } },
    { templateId: 'oneplan:scale:portable-toilet', name: '移动洗手间', placement: { kind: 'row', x: -70, y: -25, count: 3, dx: 2.6 } },
    { templateId: 'oneplan:scale:pop-up-tent', name: '城堡院棚', color: '#f2d024', placement: { kind: 'scatter', at: [[-92, 8], [-80, 20]] }, zoneIndex: 3 },
  ],
  routes: [
    { name: '灯光小径 · 主线', kind: 'pedestrian', carrier: 'walk', oneWay: true, widthM: 3, color: '#2b5fd9', startNode: 0, points: [[-70, -8], [-40, -3], [0, 0], [40, 8], [80, 20], [110, 35]] },
    { name: '人流 · 停车→城堡院', kind: 'pedestrian', carrier: 'walk', oneWay: true, widthM: 3, color: '#f2d024', startNode: 1, points: [[-115, -40], [-100, -15], [-88, 5]] },
  ],
  nodes: [
    { name: '小径入口', kind: 'entry', x: -72, y: -10 },
    { name: '停车场口', kind: 'both', x: -117, y: -42 },
  ],
};

export const ROCKET_CITY_FAIR: ReplicaCaseSpec = {
  slug: 'rocket-city-fair',
  title: 'Rocket City Fair',
  category: 'Market, Fairs & Shows',
  region: 'North America',
  refImage: 'rocket-city-fair.png',
  refLink: LINK('rocket-city-fair'),
  anchor: { lng: -86.5861, lat: 34.7304 },
  locationNote: '镇级锚点：Huntsville, AL 停车场嘉年华',
  zones: [
    { name: 'Fair Field 嘉年华场', semantic: 'reserved', color: '#3fb544', opacity: 0.25, polygon: [[35, 30], [150, 35], [155, -25], [95, -35], [45, -25]] },
    { name: 'Red Lot A 红停车 A', semantic: 'parking', color: '#c0392b', opacity: 0.3, polygon: [[-130, 30], [-45, 40], [-40, -5], [-125, -15]] },
    { name: 'Red Lot B 红停车 B', semantic: 'parking', color: '#c0392b', opacity: 0.3, polygon: [[-135, -45], [-55, -40], [-60, -85], [-140, -80]] },
    { name: 'Red Lot C 红停车 C', semantic: 'parking', color: '#c0392b', opacity: 0.25, polygon: [[-15, -55], [45, -50], [45, -90], [-20, -95]] },
    { name: 'Main Stage 主舞台', semantic: 'stage', color: '#2b5fd9', opacity: 0.4, rect: { cx: 65, cy: 5, w: 22, h: 14 } },
    { name: 'Entrance Yard 入口场', semantic: 'checkin', color: '#ec5fa8', opacity: 0.3, rect: { cx: 32, cy: -32, w: 12, h: 10 } },
  ],
  facilities: [
    { templateId: 'oneplan:icon:themepark', name: '游乐设施', color: '#c0392b', placement: { kind: 'scatter', at: [[55, 25], [85, 25], [115, 20], [60, -5], [95, -8], [130, -5]] }, zoneIndex: 0 },
    { templateId: 'oneplan:icon:carnival', name: '转盘', color: '#f2d024', placement: { kind: 'scatter', at: [[110, -15], [130, 15]] }, zoneIndex: 0 },
    { templateId: 'oneplan:scale:pop-up-tent', name: '绿棚', color: '#3fb544', placement: { kind: 'row', x: 100, y: 32, count: 5, dx: 4 } },
    { templateId: 'oneplan:scale:pop-up-tent', name: '粉棚', color: '#ec5fa8', placement: { kind: 'scatter', at: [[38, 28], [42, -30]] }, zoneIndex: 5 },
    { templateId: 'oneplan:scale:stage', name: '蓝舞台', color: '#2b5fd9', placement: { kind: 'single', x: 65, y: 5 }, zoneIndex: 4 },
    { templateId: 'food-truck-6x2.5', name: '红餐车', color: '#c0392b', placement: { kind: 'row', x: 55, y: -42, count: 3, dx: 8 } },
    { templateId: 'oneplan:scale:large-waste-container', name: '垃圾箱', color: '#2b5fd9', placement: { kind: 'row', x: 145, y: -20, count: 2, dy: 3 } },
    { templateId: 'oneplan:icon:first-aid-point', name: '急救点', color: '#2b5fd9', placement: { kind: 'scatter', at: [[45, 10], [140, 25]] } },
  ],
  routes: [
    { name: '人流 · 环岛→入口→场内', kind: 'pedestrian', carrier: 'walk', oneWay: true, widthM: 3, color: REPLICA_FLOW_COLOR, startNode: 0, points: [[-5, -55], [10, -40], [30, -35], [55, -25], [60, -5], [70, 10]] },
    { name: '车行 · 停车场环线', kind: 'vehicle', carrier: 'vehicle', oneWay: true, widthM: 4, color: '#3fb544', points: [[-10, -60], [-50, -60], [-95, -55], [-135, -30], [-90, 0], [-90, 25], [-40, 45], [10, 40]] },
    { name: '车行 · 东侧进场', kind: 'vehicle', carrier: 'vehicle', oneWay: true, widthM: 4, color: '#3fb544', startNode: 1, points: [[200, -50], [180, -45], [160, -35], [160, -25]] },
  ],
  nodes: [
    { name: '环岛口', kind: 'both', x: -7, y: -57 },
    { name: '东口', kind: 'both', x: 202, y: -52 },
  ],
};

export const GREAT_FAIR_OF_SHALFORD: ReplicaCaseSpec = {
  slug: 'the-great-fair-of-shalford',
  title: 'The Great Fair of Shalford',
  category: 'Market, Fairs & Shows',
  region: 'Europe',
  refImage: 'the-great-fair-of-shalford.png',
  refLink: LINK('the-great-fair-of-shalford'),
  anchor: { lng: -0.46, lat: 51.223 },
  locationNote: '镇级锚点：Shalford, Surrey (UK) 草甸',
  zones: [
    { name: 'West Meadow 西草甸摊带', semantic: 'reserved', color: '#3fb544', opacity: 0.25, polygon: [[-125, 30], [-45, 35], [-40, -25], [-110, -30]] },
    { name: 'Fair Field 市集大田', semantic: 'reserved', color: '#f2d024', opacity: 0.25, polygon: [[-35, 30], [40, 35], [55, -25], [20, -55], [-30, -45]] },
    { name: 'Central Arena 中央场', semantic: 'stage', color: '#3aa08c', opacity: 0.3, rect: { cx: -2, cy: -8, w: 40, h: 35 } },
    { name: 'East Field 东田（红摊）', semantic: 'reserved', color: '#c0392b', opacity: 0.15, polygon: [[75, 35], [120, 30], [115, -30], [70, -25]] },
    { name: 'Pink Big Top 粉大顶', semantic: 'stage', color: '#ec5fa8', opacity: 0.3, rect: { cx: 100, cy: 8, w: 30, h: 18 } },
    { name: 'Fair Lane 嘉年华道', semantic: 'reserved', color: '#e07b30', opacity: 0.2, polygon: [[150, 40], [185, 20], [190, -50], [155, -55], [145, -20]] },
  ],
  facilities: [
    { templateId: 'oneplan:scale:market-stall', name: '白摊（西田）', color: '#f2f2f2', placement: { kind: 'grid', x: -115, y: 20, cols: 3, rows: 5, dx: 4, dy: 6 } },
    { templateId: 'oneplan:scale:market-stall', name: '白摊（环）', color: '#f2f2f2', placement: { kind: 'grid', x: -30, y: 22, cols: 6, rows: 1, dx: 5 } },
    { templateId: 'oneplan:scale:market-stall', name: '白摊（环下）', color: '#f2f2f2', placement: { kind: 'grid', x: -30, y: -42, cols: 6, rows: 1, dx: 5 } },
    { templateId: 'oneplan:scale:market-stall', name: '红摊（东田）', color: '#c0392b', placement: { kind: 'grid', x: 80, y: 22, cols: 3, rows: 4, dx: 4, dy: 6 }, zoneIndex: 3 },
    { templateId: 'oneplan:icon:themepark', name: '摩天轮', color: '#b362c9', placement: { kind: 'single', x: 112, y: -58 } },
    { templateId: 'oneplan:icon:carnival', name: '黄伞转台', color: '#f2d024', placement: { kind: 'single', x: 128, y: -38 } },
    { templateId: 'oneplan:icon:podium', name: '中央台', color: '#ec5fa8', placement: { kind: 'single', x: -2, y: -8 }, zoneIndex: 2 },
    { templateId: 'oneplan:icon:first-aid-point', name: '急救点', color: '#c0392b', placement: { kind: 'scatter', at: [[-25, 8], [-40, -25]] } },
    { templateId: 'oneplan:scale:portable-toilet', name: '移动洗手间', color: '#2b5fd9', placement: { kind: 'row', x: -20, y: -38, count: 3, dx: 2.6 } },
    { templateId: 'oneplan:scale:water-refill-station', name: '加水点', color: '#7fd0e8', placement: { kind: 'single', x: -135, y: -60 } },
  ],
  routes: [
    { name: '人流 · 西田→大田→东田', kind: 'pedestrian', carrier: 'walk', oneWay: true, widthM: 3, color: REPLICA_FLOW_COLOR, startNode: 0, points: [[-140, 5], [-100, 5], [-60, 0], [-20, -5], [30, -8], [75, -8]] },
    { name: '人流 · 嘉年华道', kind: 'pedestrian', carrier: 'walk', oneWay: true, widthM: 3, color: '#e07b30', startNode: 1, points: [[190, 35], [170, 10], [168, -25], [160, -50]] },
  ],
  nodes: [
    { name: '西门', kind: 'both', x: -142, y: 7 },
    { name: '嘉年华道口', kind: 'both', x: 192, y: 38 },
  ],
};

export const MASTERS_OF_MOTORING: ReplicaCaseSpec = {
  slug: 'masters-of-motoring',
  title: 'Masters of Motoring',
  category: 'Market, Fairs & Shows',
  region: 'Europe',
  refImage: 'masters-of-motoring.png',
  refLink: LINK('masters-of-motoring'),
  anchor: { lng: -2.025, lat: 51.438 },
  locationNote: '镇级锚点：Bowood House 庄园草坪（Wiltshire）',
  zones: [
    { name: 'Exhibits Field 展车大田', semantic: 'reserved', color: '#c8894a', opacity: 0.3, polygon: [[-140, 45], [-20, 35], [0, -10], [-40, -55], [-140, -45]] },
    { name: 'Purple Car Park 紫停车', semantic: 'parking', color: '#b362c9', opacity: 0.3, rect: { cx: 12, cy: 45, w: 30, h: 25 } },
    { name: 'Teal Car Park 青停车', semantic: 'parking', color: '#a8d8e8', opacity: 0.3, rect: { cx: 55, cy: 40, w: 40, h: 28 } },
    { name: 'Yellow Car Park 黄停车', semantic: 'parking', color: '#f2d024', opacity: 0.3, rect: { cx: 42, cy: -12, w: 20, h: 20 } },
    { name: 'Green Lawn 展棚草坪', semantic: 'reserved', color: '#3fb544', opacity: 0.3, polygon: [[95, -5], [145, -10], [150, -45], [100, -40]] },
    { name: 'Far Green 远草坪', semantic: 'reserved', color: '#3fb544', opacity: 0.2, polygon: [[175, 30], [215, 25], [210, -10], [178, -8]] },
  ],
  facilities: [
    { templateId: 'oneplan:scale:car', name: '展车', color: '#e07b30', placement: { kind: 'grid', x: -120, y: 25, cols: 6, rows: 4, dx: 8, dy: 12 }, zoneIndex: 0 },
    { templateId: 'oneplan:scale:car', name: '紫停车车', color: '#b362c9', placement: { kind: 'grid', x: 2, y: 38, cols: 3, rows: 2, dx: 7, dy: 9 } },
    { templateId: 'oneplan:scale:pop-up-tent', name: '绿棚', color: '#3fb544', placement: { kind: 'scatter', at: [[110, -20], [125, -25]] }, zoneIndex: 4 },
    { templateId: 'oneplan:scale:tent', name: '白棚', color: '#f2f2f2', placement: { kind: 'single', x: 172, y: -42 }, zoneIndex: 5 },
    { templateId: 'oneplan:icon:first-aid-point', name: '急救点', color: '#c0392b', placement: { kind: 'scatter', at: [[60, -18], [-25, -40]] } },
    { templateId: 'oneplan:icon:information-point', name: '信息点', color: '#f2d024', placement: { kind: 'scatter', at: [[-2, -48], [95, 5]] } },
    { templateId: 'oneplan:icon:wifi', name: '紫点', color: '#b362c9', placement: { kind: 'scatter', at: [[-20, 0], [-45, -20], [0, -35]] } },
    { templateId: 'oneplan:scale:portable-toilet', name: '移动洗手间', color: '#2b5fd9', placement: { kind: 'row', x: 118, y: -25, count: 4, dx: 2.6 } },
  ],
  routes: [
    { name: '车行 · 庄园环线（蓝）', kind: 'vehicle', carrier: 'vehicle', oneWay: true, widthM: 4, color: '#2b5fd9', startNode: 0, points: [[60, 75], [50, 40], [70, 10], [85, -20], [100, -45], [140, -60], [180, -40], [195, 0], [175, 35], [120, 60]] },
    { name: '人流 · 大田→展棚', kind: 'pedestrian', carrier: 'walk', oneWay: true, widthM: 3, color: REPLICA_FLOW_COLOR, startNode: 1, points: [[-60, 0], [-20, -5], [30, -10], [80, -18], [110, -22]] },
  ],
  nodes: [
    { name: '北口', kind: 'both', x: 62, y: 77 },
    { name: '田口', kind: 'both', x: -62, y: 2 },
  ],
};

export const SWITAS_TRUCK_SHOW: ReplicaCaseSpec = {
  slug: 'the-great-north-west-switas-truck-show',
  title: 'The Great North West Switas Truck Show',
  category: 'Market, Fairs & Shows',
  region: 'Europe',
  refImage: 'the-great-north-west-switas-truck-show.png',
  refLink: LINK('the-great-north-west-switas-truck-show'),
  anchor: { lng: -2.42, lat: 53.22 },
  locationNote: '原案场地未核实，按西北英格兰农展场口径示意',
  zones: [
    { name: 'Show Green 展场绿田', semantic: 'reserved', color: '#3fb544', opacity: 0.3, polygon: [[-130, 40], [-45, 45], [-40, -25], [-125, -30]] },
    { name: 'Car Park 主停车', semantic: 'parking', color: '#8a8f96', opacity: 0.2, rect: { cx: 55, cy: -10, w: 110, h: 70 } },
    { name: 'Pink Zone 粉区', semantic: 'reserved', color: '#ec5fa8', opacity: 0.3, polygon: [[35, 10], [95, 12], [92, -15], [38, -18]] },
    { name: 'Blue Triangle 蓝三角', semantic: 'reserved', color: '#2b5fd9', opacity: 0.3, polygon: [[40, -25], [70, -28], [55, -48]] },
    { name: 'Brown Square 棕方', semantic: 'reserved', color: '#a06a3a', opacity: 0.3, rect: { cx: -5, cy: -32, w: 30, h: 16 } },
    { name: 'Food Yard 餐饮场', semantic: 'reserved', color: '#e07b30', opacity: 0.3, rect: { cx: 130, cy: -45, w: 45, h: 22 } },
    { name: 'WG 卫生点', semantic: 'reserved', color: '#2b5fd9', opacity: 0.3, rect: { cx: -18, cy: 38, w: 16, h: 8 } },
  ],
  facilities: [
    { templateId: 'oneplan:scale:car', name: '展车排', color: '#3fb544', placement: { kind: 'grid', x: -120, y: 28, cols: 6, rows: 4, dx: 7, dy: 12 }, zoneIndex: 0 },
    { templateId: 'oneplan:scale:car', name: '停车排', color: '#5b6470', placement: { kind: 'grid', x: 5, y: -38, cols: 10, rows: 4, dx: 9, dy: 15 }, zoneIndex: 1 },
    { templateId: 'oneplan:scale:pop-up-tent', name: '餐饮白棚', color: '#f2f2f2', placement: { kind: 'grid', x: 115, y: -50, cols: 3, rows: 2, dx: 8, dy: 8 }, zoneIndex: 5 },
    { templateId: 'oneplan:scale:food-trailer', name: '餐拖', color: '#e07b30', placement: { kind: 'row', x: 120, y: -30, count: 3, dx: 6 } },
    { templateId: 'oneplan:icon:information-point', name: 'WG 点', color: '#2b5fd9', placement: { kind: 'scatter', at: [[-16, 42], [-38, 45]] }, zoneIndex: 6 },
    { templateId: 'oneplan:icon:first-aid-point', name: '急救点', color: '#c0392b', placement: { kind: 'single', x: -20, y: 10 } },
    { templateId: 'oneplan:scale:portable-toilet', name: '移动洗手间', color: '#2b5fd9', placement: { kind: 'row', x: 120, y: 18, count: 3, dx: 2.6 } },
    { templateId: 'oneplan:scale:tent', name: '白大帐', color: '#f2f2f2', placement: { kind: 'single', x: 82, y: -58 } },
  ],
  routes: [
    { name: '车行 · 进出场主线', kind: 'vehicle', carrier: 'vehicle', oneWay: true, widthM: 5, color: '#2b5fd9', startNode: 0, points: [[-150, 55], [-110, 50], [-70, 42], [-20, 35], [30, 25], [80, 15], [130, 5], [160, -15]] },
    { name: '人流 · 展场→停车→餐饮', kind: 'pedestrian', carrier: 'walk', oneWay: true, widthM: 3, color: REPLICA_FLOW_COLOR, startNode: 1, points: [[-90, -35], [-50, -38], [-5, -40], [45, -42], [95, -45], [130, -48]] },
  ],
  nodes: [
    { name: '西口', kind: 'both', x: -152, y: 57 },
    { name: '东口', kind: 'both', x: 162, y: -17 },
  ],
};

export const TRAFALGAR_SQUARE_COURSE: ReplicaCaseSpec = {
  slug: 'trafalgar-square-event-planning-for-crowded-space-course',
  title: "Trafalgar Square 'Event Planning for Crowded Space' Course",
  category: 'Education',
  region: 'Europe',
  refImage: 'trafalgar-square-event-planning-for-crowded-space-course.png',
  refLink: LINK('trafalgar-square-event-planning-for-crowded-space-course'),
  anchor: { lng: -0.128072, lat: 51.508055 },
  rotationDeg: 0,
  locationNote: '精确锚点：Trafalgar Square, London（拥挤空间规划课示范案）',
  zones: [
    { name: 'North Green 北绿区', semantic: 'audience', color: '#3fb544', opacity: 0.3, rect: { cx: -18, cy: 40, w: 60, h: 22 } },
    { name: 'Center Yellow 中央黄区', semantic: 'reserved', color: '#f2d024', opacity: 0.3, rect: { cx: -10, cy: 12, w: 28, h: 16 } },
    { name: 'Fountain East 东喷泉区', semantic: 'reserved', color: '#7fd0e8', opacity: 0.3, polygon: [[35, 25], [62, 28], [64, 5], [40, 2]] },
    { name: 'Fountain West 西喷泉区', semantic: 'reserved', color: '#7fd0e8', opacity: 0.3, polygon: [[-35, -5], [-8, -8], [-10, -32], [-38, -28]] },
    { name: 'Brown Path 棕道', semantic: 'reserved', color: '#a06a3a', opacity: 0.3, rect: { cx: 15, cy: -12, w: 30, h: 18 } },
    { name: 'Screen 大屏区', semantic: 'stage', color: '#8a8f96', opacity: 0.35, rect: { cx: 22, cy: -38, w: 26, h: 8 } },
    { name: 'Purple Block 紫块', semantic: 'reserved', color: '#b362c9', opacity: 0.3, rect: { cx: 48, cy: -38, w: 18, h: 12 } },
    { name: 'Blue Perimeter 蓝围界', semantic: 'queue', color: '#2b5fd9', opacity: 0.12, polygon: [[-60, 62], [40, 62], [75, 40], [78, -20], [60, -52], [-45, -55], [-75, -25], [-78, 35]] },
    { name: 'Red Crossing 东过街三角', semantic: 'queue', color: '#c0392b', opacity: 0.25, polygon: [[95, -35], [130, -50], [125, -20]] },
    { name: 'Red Crossing 南过街三角', semantic: 'queue', color: '#c0392b', opacity: 0.25, polygon: [[-10, -70], [30, -75], [15, -95]] },
  ],
  facilities: [
    { templateId: 'oneplan:scale:large-screen', name: '大屏', placement: { kind: 'single', x: 22, y: -38 }, zoneIndex: 5 },
    { templateId: 'oneplan:icon:stanchion', name: '黄点柱', color: '#f2d024', placement: { kind: 'row', x: 5, y: -25, count: 8, dx: 2.5 } },
    { templateId: 'oneplan:icon:first-aid-point', name: '急救点', color: '#c0392b', placement: { kind: 'scatter', at: [[-45, 45], [30, 35], [10, -50]] } },
    { templateId: 'oneplan:icon:information-point', name: '信息点', color: '#3fb544', placement: { kind: 'scatter', at: [[-25, 55], [50, 15], [-55, -40]] } },
    { templateId: 'oneplan:icon:ticket-check', name: '核验点', color: '#e07b30', placement: { kind: 'scatter', at: [[-70, 50], [72, -30]] } },
    { templateId: 'oneplan:scale:portable-toilet', name: '移动洗手间', color: '#2b5fd9', placement: { kind: 'row', x: -40, y: -48, count: 4, dx: 2.6 } },
    { templateId: 'oneplan:icon:wheel-station', name: '轮椅点', color: '#2b5fd9', placement: { kind: 'single', x: -8, y: -52 } },
    { templateId: 'oneplan:icon:cone', name: '橙色导流', color: '#e07b30', placement: { kind: 'row', x: -95, y: 30, count: 8, dx: 3, rot: 20 } },
  ],
  routes: [
    { name: '人流 · 西北入口→广场', kind: 'pedestrian', carrier: 'walk', oneWay: true, widthM: 3, color: '#e07b30', startNode: 0, points: [[-110, 45], [-85, 42], [-60, 38], [-30, 25], [0, 10]] },
    { name: '人流 · 广场环线', kind: 'pedestrian', carrier: 'walk', oneWay: true, widthM: 3, color: REPLICA_FLOW_COLOR, startNode: 1, points: [[-40, -50], [-15, -55], [15, -55], [40, -45], [60, -25], [62, 5], [50, 30], [20, 50], [-20, 58], [-50, 50], [-62, 30], [-58, 0], [-50, -25]] },
  ],
  nodes: [
    { name: '西北口', kind: 'both', x: -112, y: 47 },
    { name: '东口', kind: 'both', x: 68, y: 5 },
  ],
};

export const EUROVISION_HOST_CITY_BID: ReplicaCaseSpec = {
  slug: 'eurovision-song-contest-host-city-bid',
  title: 'Eurovision Song Contest – Host City Bid',
  category: 'Education',
  region: 'Europe',
  refImage: 'eurovision-song-contest-host-city-bid.png',
  refLink: LINK('eurovision-song-contest-host-city-bid'),
  anchor: { lng: -2.244, lat: 53.4794 },
  locationNote: '概念案：锚点为示意城市（Manchester），非实际申报场地',
  zones: [
    { name: 'Arena 场馆', semantic: 'stage', color: '#8a8f96', opacity: 0.3, polygon: [[55, 45], [90, 50], [110, 20], [95, -15], [60, -20], [45, 10]] },
    { name: 'Fan Zone 粉丝区', semantic: 'audience', color: '#3fb544', opacity: 0.3, polygon: [[-15, 35], [40, 40], [50, 15], [25, 0], [-15, 8]] },
    { name: 'Deputation Bubble 评审团区', semantic: 'vip', color: '#b3628c', opacity: 0.35, polygon: [[-40, -5], [10, -8], [15, -35], [-45, -38]] },
    { name: 'Press Centre 媒体中心', semantic: 'reserved', color: '#ec5fa8', opacity: 0.3, rect: { cx: -70, cy: -52, w: 55, h: 20 } },
    { name: 'Transport Hub 交通枢纽', semantic: 'checkin', color: '#7fd0e8', opacity: 0.3, rect: { cx: 100, cy: -45, w: 30, h: 14 } },
    { name: 'Route Ring 蓝色环线带', semantic: 'reserved', color: '#2b5fd9', opacity: 0.1, polygon: [[-90, 50], [20, 62], [120, 45], [150, 5], [140, -45], [80, -65], [-30, -60], [-95, -35], [-105, 10]] },
  ],
  facilities: [
    { templateId: 'oneplan:scale:pop-up-tent', name: '粉丝帐篷', color: '#3fb544', placement: { kind: 'grid', x: -8, y: 30, cols: 4, rows: 2, dx: 5, dy: 6 }, zoneIndex: 1 },
    { templateId: 'oneplan:icon:vip', name: '评审点', color: '#b3628c', placement: { kind: 'scatter', at: [[-30, -20], [-5, -25], [-58, -30]] }, zoneIndex: 2 },
    { templateId: 'oneplan:icon:camera-fixed', name: '媒体点', color: '#ec5fa8', placement: { kind: 'scatter', at: [[-70, -48], [-55, -55]] }, zoneIndex: 3 },
    { templateId: 'oneplan:icon:bus-stop', name: '电车站', color: '#2b5fd9', placement: { kind: 'scatter', at: [[112, -40], [128, -35]] }, zoneIndex: 4 },
    { templateId: 'oneplan:icon:first-aid-point', name: '急救点', color: '#c0392b', placement: { kind: 'scatter', at: [[-60, 40], [95, 30], [15, -45]] } },
    { templateId: 'oneplan:icon:traffic-lights', name: '管控点', color: '#e07b30', placement: { kind: 'scatter', at: [[-85, 55], [55, 58], [140, 40], [145, -40]] } },
    { templateId: 'oneplan:scale:bus', name: '摆渡大巴', color: '#f2d024', placement: { kind: 'row', x: 108, y: -30, count: 3, dy: 5, rot: 90 }, zoneIndex: 4 },
  ],
  routes: [
    { name: '人流 · 蓝色安检环线', kind: 'pedestrian', carrier: 'walk', oneWay: true, widthM: 3, color: '#2b5fd9', startNode: 0, points: [[-85, 45], [-30, 52], [30, 52], [85, 40], [125, 20], [130, -15], [115, -40], [70, -55], [10, -55], [-50, -50], [-90, -30], [-95, 10]] },
    { name: '人流 · 电车站→场馆', kind: 'pedestrian', carrier: 'walk', oneWay: true, widthM: 3, color: '#7fd0e8', startNode: 1, points: [[112, -38], [105, -25], [95, -10], [88, 5]] },
    { name: '车行 · 媒体车辆线（紫）', kind: 'vehicle', carrier: 'vehicle', oneWay: true, widthM: 4, color: '#b362c9', points: [[-110, -55], [-70, -60], [-20, -45], [10, -30], [30, -15]] },
  ],
  nodes: [
    { name: '西安检口', kind: 'both', x: -87, y: 47 },
    { name: '电车站', kind: 'both', x: 114, y: -40 },
  ],
};
