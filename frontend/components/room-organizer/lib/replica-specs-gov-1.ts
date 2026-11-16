/**
 * OnePlan 复刻规格 · 政府/社区类第一批（4 案）。
 */

import type { ReplicaCaseSpec } from './replica-kit';
import { REPLICA_FLOW_COLOR } from './replica-kit';

const LINK = (slug: string) => `https://www.oneplan.io/inspiration/${slug}/`;

export const BANBURY_TOWN_COUNCIL_CORONATION: ReplicaCaseSpec = {
  slug: 'banbury-town-council-coronation-events',
  title: 'Banbury Town Council – Coronation Events',
  category: 'Local Governments',
  region: 'Europe',
  refImage: 'banbury-town-council-coronation-events.png',
  refLink: LINK('banbury-town-council-coronation-events'),
  anchor: { lng: -1.337, lat: 52.06 },
  locationNote: '镇级锚点：People\'s Park, Banbury',
  zones: [
    { name: 'Event Field 活动场', semantic: 'reserved', color: '#3fb544', opacity: 0.2, rect: { cx: -10, cy: -10, w: 60, h: 45 } },
    { name: 'Main Stage 主舞台群', semantic: 'stage', color: '#111111', opacity: 0.4, rect: { cx: 5, cy: 32, w: 55, h: 14 } },
    { name: 'Fence 围栏环', semantic: 'queue', color: '#c0392b', opacity: 0.15, rect: { cx: -15, cy: -5, w: 100, h: 85 } },
    { name: 'Marquee Row 棚列（东）', semantic: 'reserved', color: '#ec5fa8', opacity: 0.25, rect: { cx: 42, cy: -12, w: 8, h: 55 } },
    { name: 'Fun Fair 游乐区', semantic: 'reserved', color: '#e07b30', opacity: 0.25, rect: { cx: -10, cy: -55, w: 55, h: 22 } },
    { name: 'Helipad 停机坪', semantic: 'loading', color: '#c0392b', opacity: 0.35, circle: { cx: 155, cy: 5, r: 22 } },
    { name: 'Gate Lane 入口车道', semantic: 'checkin', color: '#7fd0e8', opacity: 0.3, rect: { cx: -70, cy: -38, w: 10, h: 30 } },
  ],
  facilities: [
    { templateId: 'oneplan:scale:pop-up-tent', name: '红棚', color: '#c0392b', placement: { kind: 'grid', x: -38, y: -30, cols: 8, rows: 1, dx: 3.2 } },
    { templateId: 'oneplan:scale:pop-up-tent', name: '橙棚', color: '#e07b30', placement: { kind: 'grid', x: -38, y: -26, cols: 8, rows: 1, dx: 3.2 } },
    { templateId: 'oneplan:scale:pop-up-tent', name: '粉棚', color: '#ec5fa8', placement: { kind: 'grid', x: 44, y: -30, cols: 2, rows: 9, dx: 3.4, dy: 4 } },
    { templateId: 'oneplan:scale:pop-up-tent', name: '青棚', color: '#7fd0e8', placement: { kind: 'grid', x: 32, y: -30, cols: 2, rows: 9, dx: 3.4, dy: 4 } },
    { templateId: 'oneplan:scale:pop-up-tent', name: '游乐棚', color: '#e8b838', placement: { kind: 'scatter', at: [[-25, -50], [-12, -52], [0, -50], [12, -55], [22, -58]] }, zoneIndex: 4 },
    { templateId: 'oneplan:scale:pop-up-tent', name: '紫棚', color: '#b362c9', placement: { kind: 'scatter', at: [[-8, -58], [-2, -50]] }, zoneIndex: 4 },
    { templateId: 'oneplan:icon:entry-gate', name: '绿箭头门', color: '#3fb544', placement: { kind: 'scatter', at: [[-72, -22], [-74, -38], [-80, -52]] }, zoneIndex: 6 },
    { templateId: 'oneplan:icon:first-aid-point', name: '急救点', color: '#c0392b', placement: { kind: 'scatter', at: [[-25, 20], [45, -45]] } },
    { templateId: 'oneplan:scale:portable-toilet', name: '移动洗手间', placement: { kind: 'row', x: 55, y: -40, count: 5, dx: 2.6 } },
    { templateId: 'trash-point-1.2x1.2', name: '垃圾点', color: '#f2d024', placement: { kind: 'scatter', at: [[-60, 5], [30, 25]] } },
  ],
  routes: [
    { name: '人流 · 门→场→游乐区', kind: 'pedestrian', carrier: 'walk', oneWay: true, widthM: 3, color: REPLICA_FLOW_COLOR, startNode: 0, points: [[-70, -40], [-55, -30], [-40, -10], [-20, 10], [0, 20]] },
    { name: '车行 · 应急通道', kind: 'vehicle', carrier: 'vehicle', oneWay: true, widthM: 4, points: [[-90, -70], [-60, -55], [-30, -50], [40, -70], [120, -40], [155, 20]] },
  ],
  nodes: [
    { name: '公园主门', kind: 'both', x: -74, y: -40 },
    { name: '应急门', kind: 'exit', x: -92, y: -72 },
  ],
};

export const ROTHERHAM_CHRISTMAS_LIGHT_SWITCH_ON: ReplicaCaseSpec = {
  slug: 'rotherham-christmas-light-switch-on',
  title: 'Rotherham Christmas Light Switch On',
  category: 'Local Governments',
  region: 'Europe',
  refImage: 'rotherham-christmas-light-switch-on.png',
  refLink: LINK('rotherham-christmas-light-switch-on'),
  anchor: { lng: -1.3568, lat: 53.4302 },
  locationNote: '镇级锚点：Rotherham 镇中心（All Saints Square 一带）',
  zones: [
    { name: 'Main Stage Square 主舞台广场', semantic: 'stage', color: '#ec5fa8', opacity: 0.35, rect: { cx: -45, cy: 15, w: 40, h: 28 } },
    { name: 'Stage Block 舞台体', semantic: 'stage', color: '#2b5fd9', opacity: 0.4, rect: { cx: -48, cy: 12, w: 14, h: 10 } },
    { name: 'Orange Stage 西舞台区', semantic: 'stage', color: '#e07b30', opacity: 0.3, polygon: [[-90, 40], [-60, 42], [-58, 5], [-85, 0]] },
    { name: 'Market Strip 东市集带', semantic: 'reserved', color: '#3fb544', opacity: 0.3, rect: { cx: 55, cy: 18, w: 65, h: 10 } },
    { name: 'Crossing 交叉口', semantic: 'queue', color: '#e07b30', opacity: 0.3, rect: { cx: 22, cy: 15, w: 18, h: 16 } },
    { name: 'Red Zone 东红区', semantic: 'reserved', color: '#c0392b', opacity: 0.25, polygon: [[110, 25], [150, 15], [142, -10], [112, -5]] },
    { name: 'All Saints 青区', semantic: 'audience', color: '#7fd0e8', opacity: 0.3, polygon: [[-55, -18], [-25, -20], [-15, -40], [-45, -42]] },
    { name: 'Green Parks 北绿园', semantic: 'reserved', color: '#3fb544', opacity: 0.2, polygon: [[-115, 60], [-80, 68], [-72, 45], [-105, 42]] },
  ],
  facilities: [
    { templateId: 'stage-platform-8x6', name: '舞台台体', placement: { kind: 'single', x: -48, y: 12 }, zoneIndex: 1 },
    { templateId: 'oneplan:scale:pop-up-tent', name: '市集棚', color: '#3fb544', placement: { kind: 'row', x: 30, y: 18, count: 8, dx: 4.2 }, zoneIndex: 3 },
    { templateId: 'oneplan:icon:ticket-check', name: '交叉口管控', color: '#e07b30', placement: { kind: 'single', x: 22, y: 15 }, zoneIndex: 4 },
    { templateId: 'oneplan:icon:first-aid-point', name: '急救点', color: '#c0392b', placement: { kind: 'scatter', at: [[-62, 22], [100, 12]] } },
    { templateId: 'oneplan:icon:information-point', name: '信息点', color: '#2b5fd9', placement: { kind: 'scatter', at: [[-70, 5], [45, 30]] } },
    { templateId: 'oneplan:icon:stanchion', name: '隔离柱', color: '#3fb544', placement: { kind: 'row', x: 115, y: -8, count: 6, dx: 2.5 } },
    { templateId: 'food-truck-6x2.5', name: '餐车', placement: { kind: 'single', x: -55, y: 45 }, zoneIndex: 2 },
  ],
  routes: [
    { name: '人流 · 北街南下主线', kind: 'pedestrian', carrier: 'walk', oneWay: true, widthM: 3, color: '#2b5fd9', startNode: 0, points: [[40, 90], [30, 55], [20, 25], [-15, 5], [-40, -10], [-60, -35]] },
    { name: '人流 · 西环线', kind: 'pedestrian', carrier: 'walk', oneWay: true, widthM: 3, color: '#2b5fd9', startNode: 1, points: [[-120, 20], [-95, 8], [-70, -15], [-75, -40], [-105, -55]] },
  ],
  nodes: [
    { name: '北街口', kind: 'both', x: 42, y: 92 },
    { name: '西街口', kind: 'both', x: -122, y: 22 },
  ],
};

export const FAREHAM_WEST_SCOUTS_CAMP24: ReplicaCaseSpec = {
  slug: 'fareham-west-scouts-camp24',
  title: 'Fareham West Scouts – Camp24',
  category: 'Local Governments',
  region: 'Europe',
  refImage: 'fareham-west-scouts-camp24.png',
  refLink: LINK('fareham-west-scouts-camp24'),
  anchor: { lng: -1.183, lat: 50.851 },
  locationNote: '镇级锚点：Fareham 营地',
  zones: [
    { name: 'Subcamp A 子营', semantic: 'reserved', color: '#2b5fd9', opacity: 0.2, polygon: [[-30, 55], [40, 60], [45, 25], [-25, 22]] },
    { name: 'Subcamp B 子营', semantic: 'reserved', color: '#2b5fd9', opacity: 0.2, polygon: [[-20, 15], [60, 12], [55, -15], [-15, -12]] },
    { name: 'M1 Area 活动田', semantic: 'reserved', color: '#f2d024', opacity: 0.3, polygon: [[-105, 5], [-55, 12], [-50, -30], [-95, -35]] },
    { name: 'Marquee Yard 大棚场', semantic: 'stage', color: '#f2d024', opacity: 0.35, rect: { cx: -80, cy: -60, w: 55, h: 35 } },
    { name: 'Tent Rows 橙棚列', semantic: 'reserved', color: '#e07b30', opacity: 0.3, rect: { cx: -35, cy: -35, w: 45, h: 18, rot: -8 } },
    { name: 'Green Camp 绿营', semantic: 'reserved', color: '#3fb544', opacity: 0.3, rect: { cx: -10, cy: -85, w: 60, h: 30 } },
    { name: 'Pink Route 粉路线区', semantic: 'reserved', color: '#ec5fa8', opacity: 0.15, polygon: [[90, -25], [150, -35], [175, -70], [110, -80], [85, -55]] },
  ],
  facilities: [
    { templateId: 'oneplan:scale:pop-up-tent', name: '橙棚', color: '#e07b30', placement: { kind: 'grid', x: -52, y: -40, cols: 6, rows: 2, dx: 4, dy: 6 }, zoneIndex: 4 },
    { templateId: 'oneplan:scale:pop-up-tent', name: '绿营帐', color: '#3fb544', placement: { kind: 'grid', x: -30, y: -92, cols: 6, rows: 2, dx: 5, dy: 6 }, zoneIndex: 5 },
    { templateId: 'oneplan:scale:stretch-tent', name: 'X 大帐', color: '#f2d024', placement: { kind: 'scatter', at: [[-95, -55], [-70, -70]] }, zoneIndex: 3 },
    { templateId: 'oneplan:scale:pop-up-tent', name: '黄棚', color: '#f2d024', placement: { kind: 'row', x: -100, y: -78, count: 4, dx: 3.2 }, zoneIndex: 3 },
    { templateId: 'oneplan:scale:portable-toilet', name: '移动洗手间', color: '#ec5fa8', placement: { kind: 'row', x: -48, y: -72, count: 5, dy: 2.6, rot: 90 } },
    { templateId: 'oneplan:icon:first-aid-point', name: '急救点', color: '#c0392b', placement: { kind: 'scatter', at: [[-40, -58], [0, -70]] } },
    { templateId: 'oneplan:scale:tent', name: '粉区棚', color: '#ec5fa8', placement: { kind: 'single', x: 105, y: -45 }, zoneIndex: 6 },
  ],
  routes: [
    { name: '步道 · 营地主环线', kind: 'pedestrian', carrier: 'walk', oneWay: false, widthM: 3, color: '#2b5fd9', startNode: 0, points: [[-45, -100], [-20, -80], [10, -60], [30, -30], [20, 0], [-10, 20], [-50, 30], [-80, 15], [-90, -20], [-80, -60], [-60, -90]] },
    { name: '人流 · 粉色支线', kind: 'pedestrian', carrier: 'walk', oneWay: true, widthM: 2, color: '#ec5fa8', startNode: 1, points: [[85, -30], [105, -50], [135, -70]] },
  ],
  nodes: [
    { name: '营地主门', kind: 'both', x: -47, y: -102 },
    { name: '粉线口', kind: 'both', x: 84, y: -28 },
  ],
};

export const VICTORIA_PARK_BRISBANE_EASTER_EGG_HUNT: ReplicaCaseSpec = {
  slug: 'victoria-park-brisbane-easter-egg-hunt',
  title: 'Victoria Park Brisbane – Easter Egg Hunt',
  category: 'Local Governments',
  region: 'Australia & NZ',
  refImage: 'victoria-park-brisbane-easter-egg-hunt.png',
  refLink: LINK('victoria-park-brisbane-easter-egg-hunt'),
  anchor: { lng: 153.022, lat: -27.449 },
  locationNote: '镇级锚点：Victoria Park, Brisbane',
  zones: [
    { name: 'Purple Field 紫田', semantic: 'reserved', color: '#b362c9', opacity: 0.3, polygon: [[-90, 60], [10, 55], [25, 25], [-70, 18]] },
    { name: 'Clue 2 Bunnies 兔子线索', semantic: 'reserved', color: '#7fd0e8', opacity: 0.3, polygon: [[55, 55], [85, 58], [90, 40], [60, 38]] },
    { name: 'Clue 3 Carrots 萝卜线索', semantic: 'reserved', color: '#7fd0e8', opacity: 0.3, polygon: [[50, 32], [78, 35], [82, 20], [55, 18]] },
    { name: 'Clue 4 Activities 活动线索', semantic: 'reserved', color: '#7fd0e8', opacity: 0.3, polygon: [[45, 5], [80, 8], [85, -12], [50, -15]] },
    { name: 'Clue 5 Maze 迷宫线索', semantic: 'reserved', color: '#7fd0e8', opacity: 0.3, polygon: [[5, -38], [30, -40], [35, -55], [8, -58]] },
    { name: 'Play Zone 游乐（橙）', semantic: 'reserved', color: '#e07b30', opacity: 0.3, circle: { cx: 100, cy: 52, r: 10 } },
    { name: 'Play Zone 游乐（橙）B', semantic: 'reserved', color: '#e07b30', opacity: 0.3, circle: { cx: 112, cy: 22, r: 9 } },
    { name: 'Start 出发区', semantic: 'checkin', color: '#3fb544', opacity: 0.35, polygon: [[120, 68], [148, 72], [152, 55], [125, 52]] },
    { name: 'END 终点区', semantic: 'stage', color: '#3fb544', opacity: 0.25, circle: { cx: -62, cy: -60, r: 10 } },
  ],
  facilities: [
    { templateId: 'oneplan:icon:information-point', name: '线索牌', color: '#2b5fd9', placement: { kind: 'scatter', at: [[68, 47], [64, 26], [62, -3], [18, -47], [-58, -62]] } },
    { templateId: 'oneplan:icon:wifi', name: '通讯点', color: '#2b5fd9', placement: { kind: 'scatter', at: [[-75, -48], [-62, -52]] } },
    { templateId: 'oneplan:icon:photo-point', name: '拍照点', color: '#ec5fa8', placement: { kind: 'single', x: 122, y: 62 }, zoneIndex: 7 },
    { templateId: 'oneplan:scale:pop-up-tent', name: '活动棚', color: '#3fb544', placement: { kind: 'scatter', at: [[-48, -48], [-20, -60], [60, -5]] } },
    { templateId: 'oneplan:scale:portable-toilet', name: '移动洗手间', placement: { kind: 'row', x: -90, y: -35, count: 3, dy: 2.6, rot: 90 } },
    { templateId: 'oneplan:icon:first-aid-point', name: '急救点', color: '#c0392b', placement: { kind: 'single', x: -80, y: -42 } },
  ],
  routes: [
    { name: '寻蛋 · 红色环线（START→线索→END）', kind: 'pedestrian', carrier: 'walk', oneWay: true, widthM: 3, color: '#c0392b', startNode: 0, points: [[128, 66], [110, 55], [90, 42], [80, 25], [75, 0], [55, -10], [30, -45], [-10, -55], [-40, -55], [-58, -60], [-90, -70], [-120, -55]] },
  ],
  nodes: [
    { name: 'START 出发点', kind: 'entry', x: 130, y: 64 },
    { name: 'END 终点', kind: 'exit', x: -62, y: -62 },
  ],
};
