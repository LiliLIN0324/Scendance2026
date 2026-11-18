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
  slug: "rocket-city-fair",
  title: "Rocket City Fair",
  category: "Market, Fairs & Shows",
  region: "North America",
  refImage: "rocket-city-fair.png",
  refLink: "https://www.oneplan.io/inspiration/rocket-city-fair/",
  anchor: {"lng":-86.588851,"lat":34.696959},
  locationNote: "2026-11-18 按原图逐块描绘；沿用用户右侧已确认位置 / 268° / z16.5，未重新配准。比例 0.309442 m/px；设施占地为模板估计，非现场实测。",
  zones: [
    {"name":"Fair Field 嘉年华场","semantic":"reserved","color":"#3fb544","opacity":0.25,"polygon":[[-77.633,58.621],[-61.789,77.633],[-28.518,79.217],[-28.518,55.452],[128.332,54.66],[131.5,18.22],[110.112,13.467],[101.398,17.428],[101.398,-2.377],[3.961,-7.922],[1.584,-14.259],[-51.491,-15.051],[-61.789,0],[-67.334,-3.169],[-79.217,13.467]]},
    {"name":"Red Lot A 红停车 A","semantic":"parking","color":"#c0392b","opacity":0.3,"polygon":[[-302.609,57.828],[-116.449,52.283],[-118.826,-17.428],[-160.018,-24.557],[-219.431,-48.322],[-243.196,-64.958],[-305.778,-66.542]]},
    {"name":"Red Lot B 红停车 B","semantic":"parking","color":"#c0392b","opacity":0.3,"polygon":[[-306.57,-104.567],[-274.091,-114.073],[-214.678,-102.19],[-160.811,-76.841],[-134.669,-77.633],[-125.955,-86.347],[-125.163,-183.784],[-170.317,-176.654],[-259.04,-176.654],[-308.154,-175.862]]},
    {"name":"Red Lot C 红停车 C","semantic":"parking","color":"#c0392b","opacity":0.25,"polygon":[[-435.694,-99.021],[-420.643,-99.021],[-419.85,-108.527],[-401.63,-108.527],[-395.293,-99.813],[-366.775,-100.606],[-363.606,-106.151],[-327.959,-108.527],[-328.751,-178.238],[-364.398,-179.031],[-365.983,-185.368],[-402.423,-184.576],[-404.799,-179.823],[-435.694,-181.407]]},
    {"name":"Main Stage 主舞台","semantic":"stage","color":"#2b5fd9","opacity":0.4,"polygon":[[5.545,-11.883],[22.973,-11.883],[22.973,-25.349],[5.545,-25.349]]},
    {"name":"Entrance Yard 入口场","semantic":"checkin","color":"#ec5fa8","opacity":0.3,"polygon":[[-99.021,27.726],[-83.97,29.31],[-83.178,50.699],[-76.048,49.907],[-73.672,3.169],[-79.217,-2.377],[-64.166,-13.467],[-99.021,-23.765]]},
  ],
  facilities: [
    {"templateId":"oneplan:icon:themepark","name":"游乐设施","color":"#c0392b","placement":{"kind":"scatter","at":[[-36.44,34.063],[6.337,25.349],[18.22,50.699],[30.102,86.347],[17.428,87.139],[80.009,50.699],[45.946,28.518]],"rot":0}},
    {"templateId":"oneplan:icon:carnival","name":"转盘","color":"#f2d024","placement":{"kind":"scatter","at":[[78.425,49.907],[46.738,27.726]],"rot":0}},
    {"templateId":"oneplan:scale:pop-up-tent","name":"绿棚","color":"#3fb544","placement":{"kind":"scatter","at":[[-8.714,87.931],[47.53,85.554],[72.88,84.762],[28.518,26.142],[62.581,26.934],[3.169,52.283],[60.997,52.283]],"rot":0}},
    {"templateId":"oneplan:scale:pop-up-tent","name":"粉棚","color":"#ec5fa8","placement":{"kind":"single","x":90.307,"y":84.762,"rot":0}},
    {"templateId":"oneplan:scale:stage","name":"蓝舞台","color":"#2b5fd9","placement":{"kind":"single","x":14.259,"y":-17.428,"rot":0}},
    {"templateId":"food-truck-6x2.5","name":"红餐车","color":"#c0392b","placement":{"kind":"scatter","at":[[-22.973,86.347],[-68.127,84.762],[-13.467,-18.22]],"rot":0}},
    {"templateId":"oneplan:scale:large-waste-container","name":"垃圾箱","color":"#2b5fd9","placement":{"kind":"scatter","at":[[-9.506,27.726],[-53.868,49.115]],"rot":0}},
    {"templateId":"oneplan:icon:first-aid-point","name":"急救点","color":"#2b5fd9","placement":{"kind":"single","x":115.657,"y":-31.687,"rot":0}},
  ],
  routes: [
    {"name":"人流 · 环岛→入口→场内","kind":"pedestrian","carrier":"walk","oneWay":true,"widthM":3,"color":"#f2c744","points":[[-124.371,-31.687],[-101.398,-46.738],[211.51,-38.816],[217.847,-54.66],[349.347,-57.828]]},
    {"name":"车行 · 停车场环线","kind":"vehicle","carrier":"vehicle","oneWay":true,"widthM":4,"color":"#3fb544","points":[[-106.151,-68.127],[-81.594,-44.362],[208.341,-44.362],[215.47,-57.036],[299.44,-62.581]]},
    {"name":"车行 · 东侧进场","kind":"vehicle","carrier":"vehicle","oneWay":true,"widthM":4,"color":"#3fb544","points":[[-95.853,81.594],[-106.151,-26.142],[-127.539,-41.193],[-149.72,-46.738],[-149.72,-63.374]]},
  ],
  nodes: [
    {"name":"环岛口","kind":"both","x":-106.151,"y":-68.127},
    {"name":"东口","kind":"both","x":115.657,"y":-31.687},
  ],
  confirmedView: {"lng":-86.588851,"lat":34.696959,"zoom":16.5,"rotationDeg":268},
  rotationDeg: 92,
};

export const GREAT_FAIR_OF_SHALFORD: ReplicaCaseSpec = {
  slug: "the-great-fair-of-shalford",
  title: "The Great Fair of Shalford",
  category: "Market, Fairs & Shows",
  region: "Europe",
  refImage: "the-great-fair-of-shalford.png",
  refLink: "https://www.oneplan.io/inspiration/the-great-fair-of-shalford/",
  anchor: {"lng":-0.566437,"lat":51.212463},
  locationNote: "2026-11-18 按原图逐块描绘；沿用用户右侧已确认位置 / 176° / z17.5，未重新配准。比例 0.120952 m/px；设施占地为模板估计，非现场实测。",
  zones: [
    {"name":"West Meadow 西草甸摊带","semantic":"reserved","color":"#3fb544","opacity":0.25,"polygon":[[-133.764,32.822],[-109.612,41.801],[-71.836,54.496],[-53.567,41.492],[-68.43,30.654],[-105.896,7.122]]},
    {"name":"Fair Field 市集大田","semantic":"reserved","color":"#f2d024","opacity":0.25,"polygon":[[-93.82,0.929],[-50.161,31.273],[-28.487,4.645],[3.096,-39.324],[-5.264,-52.019],[-14.863,-55.425],[-73.384,-53.567],[-104.348,-11.457]]},
    {"name":"Central Arena 中央场","semantic":"stage","color":"#3aa08c","opacity":0.3,"polygon":[[-69.049,-12.386],[-55.425,0.619],[-25.7,-34.679],[-55.425,-32.512]]},
    {"name":"East Field 东田（红摊）","semantic":"reserved","color":"#c0392b","opacity":0.15,"polygon":[[-5.573,27.867],[13.934,42.111],[28.487,53.877],[53.258,49.852],[61.618,35.299],[65.024,-5.883],[34.989,-22.294]]},
    {"name":"Pink Big Top 粉大顶","semantic":"stage","color":"#ec5fa8","opacity":0.3,"polygon":[[65.643,6.502],[104.967,8.36],[105.587,-16.72],[66.572,-18.578]]},
    {"name":"Fair Lane 嘉年华道","semantic":"reserved","color":"#e07b30","opacity":0.2,"polygon":[[122.926,38.705],[142.434,32.202],[133.144,-26.939],[123.546,-41.492],[94.13,-59.141],[79.267,-37.776],[89.485,-31.893],[94.44,-44.278],[111.47,-33.131]]},
  ],
  facilities: [
    {"templateId":"oneplan:scale:market-stall","name":"白摊（西田）","color":"#f2f2f2","placement":{"kind":"scatter","at":[[-121.688,39.943],[-118.437,41.089],[-115.185,42.235],[-111.934,43.38],[-108.683,44.526],[-105.432,45.672],[-102.181,46.817],[-98.929,47.963],[-95.678,49.109],[-92.427,50.254],[-89.176,51.4],[-85.925,52.546],[-82.673,53.691],[-79.422,54.837]],"rot":0}},
    {"templateId":"oneplan:scale:market-stall","name":"白摊（环）","color":"#f2f2f2","placement":{"kind":"scatter","at":[[-97.536,-6.502],[-95.988,-9.289],[-94.44,-12.076],[-92.891,-14.863],[-91.343,-17.649],[-89.795,-20.436],[-88.247,-23.223],[-86.699,-26.01],[-85.15,-28.796],[-83.602,-31.583],[-82.054,-34.37],[-80.506,-37.157],[-78.958,-39.943],[-77.41,-42.73],[-75.861,-45.517],[-74.313,-48.304],[-72.455,-53.567],[-68.894,-53.676],[-65.334,-53.784],[-61.773,-53.893],[-58.212,-54.001],[-54.651,-54.109],[-51.09,-54.218],[-47.529,-54.326],[-43.969,-54.434],[-40.408,-54.543],[-36.847,-54.651],[-33.286,-54.759],[-29.725,-54.868],[-26.164,-54.976],[-22.604,-55.085],[-19.043,-55.193],[-15.482,-55.301],[-11.921,-55.41],[-1.548,-48.304],[-3.437,-45.3],[-5.326,-42.297],[-7.215,-39.293],[-9.103,-36.29],[-10.992,-33.286],[-12.881,-30.283],[-14.77,-27.279],[-16.659,-24.276],[-18.547,-21.272],[-20.436,-18.269],[-22.325,-15.265],[-24.214,-12.262],[-26.102,-9.258],[-27.991,-6.255],[-29.88,-3.251],[-31.769,-0.248],[-33.658,2.756],[-35.546,5.759],[-37.435,8.763],[-39.324,11.766],[-41.213,14.77],[-43.102,17.773],[-44.99,20.777],[-46.879,23.78]],"rot":0}},
    {"templateId":"oneplan:scale:market-stall","name":"白摊（环下）","color":"#f2f2f2","placement":{"kind":"scatter","at":[[-69.669,-13.624],[-68.275,-15.792],[-66.882,-17.959],[-65.488,-20.126],[-64.095,-22.294],[-62.702,-24.461],[-61.308,-26.629],[-59.915,-28.796],[-58.522,-30.964]],"rot":0}},
    {"templateId":"oneplan:scale:market-stall","name":"红摊（东田）","color":"#c0392b","placement":{"kind":"scatter","at":[[129.429,17.03],[128.809,12.695],[128.19,8.36],[127.571,4.025],[126.952,-0.31],[126.332,-4.645],[125.713,-8.98],[125.094,-13.314],[124.475,-17.649],[123.855,-21.984]],"rot":0}},
    {"templateId":"oneplan:icon:themepark","name":"摩天轮","color":"#b362c9","placement":{"kind":"single","x":98.775,"y":-26.319,"rot":0}},
    {"templateId":"oneplan:icon:carnival","name":"黄伞转台","color":"#f2d024","placement":{"kind":"single","x":77.1,"y":-47.684,"rot":0}},
    {"templateId":"oneplan:icon:podium","name":"中央台","color":"#ec5fa8","placement":{"kind":"single","x":31.583,"y":49.232,"rot":0}},
    {"templateId":"oneplan:icon:first-aid-point","name":"急救点","color":"#c0392b","placement":{"kind":"scatter","at":[[-72.455,-5.883],[-54.496,4.025]],"rot":0}},
    {"templateId":"oneplan:scale:water-refill-station","name":"加水点","color":"#7fd0e8","placement":{"kind":"scatter","at":[[-124.784,-2.787],[-111.16,-65.334]],"rot":0}},
  ],
  routes: [
    {"name":"人流 · 西田→大田→东田","kind":"pedestrian","carrier":"walk","oneWay":true,"widthM":3,"color":"#f2c744","points":[[-132.215,23.223],[-105.896,7.122],[-50.161,31.273],[-1.858,-37.466]]},
    {"name":"人流 · 嘉年华道","kind":"pedestrian","carrier":"walk","oneWay":true,"widthM":3,"color":"#e07b30","points":[[-5.573,27.867],[34.989,-22.294],[105.587,-16.72]]},
  ],
  nodes: [
    {"name":"西门","kind":"both","x":-132.215,"y":23.223},
    {"name":"嘉年华道口","kind":"both","x":-5.573,"y":27.867},
  ],
  confirmedView: {"lng":-0.566437,"lat":51.212463,"zoom":17.5,"rotationDeg":176},
  rotationDeg: 184,
};

export const MASTERS_OF_MOTORING: ReplicaCaseSpec = {
  slug: "masters-of-motoring",
  title: "Masters of Motoring",
  category: "Market, Fairs & Shows",
  region: "Europe",
  refImage: "masters-of-motoring.png",
  refLink: "https://www.oneplan.io/inspiration/masters-of-motoring/",
  anchor: {"lng":-2.043781,"lat":51.42779},
  locationNote: "2026-11-18 按原图逐块描绘；沿用用户右侧已确认位置 / 0° / z15.5，未重新配准。比例 0.544286 m/px；设施占地为模板估计，非现场实测。",
  zones: [
    {"name":"Exhibits Field 展车大田","semantic":"reserved","color":"#c8894a","opacity":0.3,"polygon":[[-653.491,-137.944],[-554.562,57.128],[-82.209,-90.569],[-72.455,-224.333],[-555.955,-231.3]]},
    {"name":"Purple Car Park 紫停车","semantic":"parking","color":"#b362c9","opacity":0.3,"polygon":[[-171.385,55.735],[-115.65,65.488],[-87.782,-44.588],[-132.37,-62.702]]},
    {"name":"Teal Car Park 青停车","semantic":"parking","color":"#a8d8e8","opacity":0.3,"polygon":[[-89.176,64.095],[-18.114,73.849],[32.048,-153.271],[-29.261,-164.418]]},
    {"name":"Yellow Car Park 黄停车","semantic":"parking","color":"#f2d024","opacity":0.3,"polygon":[[-126.797,-64.095],[-86.389,-52.948],[-29.261,-158.844],[-79.422,-175.565]]},
    {"name":"Green Lawn 展棚草坪","semantic":"reserved","color":"#3fb544","opacity":0.3,"polygon":[[20.901,-23.687],[72.455,-8.36],[112.863,18.114],[154.664,18.114],[158.844,-18.114],[178.352,-23.687],[165.811,-59.915]]},
    {"name":"Far Green 远草坪","semantic":"reserved","color":"#3fb544","opacity":0.2,"polygon":[[267.527,19.507],[395.717,44.588],[392.931,-13.934],[346.949,-82.209],[268.921,-73.849]]},
  ],
  facilities: [
    {"templateId":"oneplan:scale:tent","name":"白棚","color":"#f2f2f2","placement":{"kind":"scatter","at":[[299.575,-103.109],[302.362,-110.076]],"rot":0}},
    {"templateId":"oneplan:icon:first-aid-point","name":"急救点","color":"#c0392b","placement":{"kind":"scatter","at":[[33.441,5.573],[-13.934,210.399]],"rot":0}},
    {"templateId":"oneplan:icon:information-point","name":"信息点","color":"#f2d024","placement":{"kind":"single","x":68.275,"y":16.72,"rot":0}},
    {"templateId":"oneplan:icon:wifi","name":"紫点","color":"#b362c9","placement":{"kind":"scatter","at":[[-249.413,32.048],[-260.56,-25.081],[-327.442,-112.863],[-271.707,-110.076],[-207.612,-115.651],[-93.356,-114.256]],"rot":0}},
  ],
  routes: [
    {"name":"车行 · 庄园环线（蓝）","kind":"vehicle","carrier":"vehicle","oneWay":true,"widthM":4,"color":"#2b5fd9","points":[[-37.621,287.035],[-27.867,199.252],[-13.934,111.47],[15.327,30.654],[30.654,20.901],[154.664,34.834],[204.826,33.441],[210.399,18.114],[167.205,-64.095],[121.223,-142.124],[66.882,-274.494]]},
    {"name":"人流 · 大田→展棚","kind":"pedestrian","carrier":"walk","oneWay":true,"widthM":3,"color":"#f2c744","points":[[-249.413,302.362],[-248.02,32.048],[-271.707,-110.076],[-635.376,-153.271]]},
  ],
  nodes: [
    {"name":"北口","kind":"both","x":-37.621,"y":287.035},
    {"name":"田口","kind":"both","x":66.882,"y":-274.494},
  ],
  confirmedView: {"lng":-2.043781,"lat":51.42779,"zoom":15.5,"rotationDeg":0},
  rotationDeg: 0,
};

export const SWITAS_TRUCK_SHOW: ReplicaCaseSpec = {
  slug: "the-great-north-west-switas-truck-show",
  title: "The Great North West Switas Truck Show",
  category: "Market, Fairs & Shows",
  region: "Europe",
  refImage: "the-great-north-west-switas-truck-show.png",
  refLink: "https://www.oneplan.io/inspiration/the-great-north-west-switas-truck-show/",
  anchor: {"lng":-2.621885,"lat":53.48019},
  locationNote: "2026-11-18 按原图逐块描绘；沿用用户右侧已确认位置 / 342° / z16.75，未重新配准。比例 0.460000 m/px；设施占地为模板估计，非现场实测。 原图比例尺截断：当前尺度为估计，待核验，不能作为准确落位结果。",
  zones: [
    {"name":"Show Green 展场绿田","semantic":"reserved","color":"#3fb544","opacity":0.3,"polygon":[[-538.163,36.506],[-282.624,134.246],[-266.138,102.451],[-248.474,116.582],[-216.678,93.03],[-105.984,101.274],[-103.629,49.459],[-200.192,47.104],[-199.014,11.776],[-425.114,-3.533],[-520.499,-17.664]]},
    {"name":"Car Park 主停车","semantic":"parking","color":"#8a8f96","opacity":0.2,"polygon":[[-95.386,-32.973],[10.598,-16.486],[10.598,12.954],[32.973,-4.71],[52.992,-35.328],[84.787,-42.394],[142.49,-64.768],[166.042,-84.787],[156.621,-113.05],[170.752,-146.022],[-94.208,-146.022]]},
    {"name":"Pink Zone 粉区","semantic":"reserved","color":"#ec5fa8","opacity":0.3,"polygon":[[31.795,32.973],[226.099,36.506],[226.099,-12.954],[90.675,-7.066]]},
    {"name":"Blue Triangle 蓝三角","semantic":"reserved","color":"#2b5fd9","opacity":0.3,"polygon":[[91.853,-16.486],[149.555,-18.842],[150.733,-62.413]]},
    {"name":"Brown Square 棕方","semantic":"reserved","color":"#a06a3a","opacity":0.3,"polygon":[[-96.563,-41.216],[-4.71,-37.683],[-4.71,-80.077],[-95.386,-82.432]]},
    {"name":"Food Yard 餐饮场","semantic":"reserved","color":"#e07b30","opacity":0.3,"polygon":[[282.624,-80.077],[346.214,-78.899],[346.214,-120.115],[282.624,-120.115]]},
    {"name":"WG 卫生点","semantic":"reserved","color":"#2b5fd9","opacity":0.3,"polygon":[[228.454,-131.891],[256.717,-131.891],[256.717,-151.91],[228.454,-150.733]]},
  ],
  facilities: [
    {"templateId":"oneplan:scale:car","name":"展车排","color":"#3fb544","placement":{"kind":"scatter","at":[[15.309,78.899],[24.73,78.899],[34.15,78.899],[43.571,78.899],[52.992,78.899],[62.413,78.899],[71.834,78.899],[81.254,78.899],[90.675,78.899],[100.096,78.899],[109.517,78.899],[118.938,78.899],[128.358,78.899],[137.779,78.899],[147.2,78.899],[156.621,78.899],[166.042,78.899],[175.462,78.899],[184.883,78.899],[194.304,78.899],[203.725,78.899],[213.146,78.899],[222.566,78.899],[231.987,78.899],[241.408,78.899],[250.829,78.899],[260.25,78.899],[269.67,78.899],[279.091,78.899],[288.512,78.899],[297.933,78.899],[307.354,78.899],[316.774,78.899],[326.195,78.899],[37.683,52.992],[47.104,52.992],[56.525,52.992],[65.946,52.992],[75.366,52.992],[84.787,52.992],[94.208,52.992],[103.629,52.992],[113.05,52.992],[122.47,52.992],[131.891,52.992],[141.312,52.992],[150.733,52.992],[160.154,52.992],[169.574,52.992],[178.995,52.992],[188.416,52.992],[197.837,52.992],[207.258,52.992],[216.678,52.992],[226.099,52.992],[235.52,52.992],[244.941,52.992],[254.362,52.992],[263.782,52.992],[273.203,52.992],[282.624,52.992],[292.045,52.992],[301.466,52.992],[310.886,52.992],[320.307,52.992],[329.728,52.992],[36.506,24.73],[45.926,24.73],[55.347,24.73],[64.768,24.73],[74.189,24.73],[83.61,24.73],[93.03,24.73],[102.451,24.73],[111.872,24.73],[121.293,24.73],[130.714,24.73],[140.134,24.73],[149.555,24.73],[158.976,24.73],[168.397,24.73],[177.818,24.73],[187.238,24.73],[196.659,24.73],[206.08,24.73],[215.501,24.73],[224.922,24.73],[234.342,24.73],[243.763,24.73],[253.184,24.73],[262.605,24.73],[272.026,24.73],[281.446,24.73],[290.867,24.73],[300.288,24.73],[309.709,24.73],[319.13,24.73],[328.55,24.73],[337.971,24.73],[148.378,-3.533],[157.798,-3.533],[167.219,-3.533],[176.64,-3.533],[186.061,-3.533],[195.482,-3.533],[204.902,-3.533],[214.323,-3.533],[223.744,-3.533],[233.165,-3.533],[242.586,-3.533],[252.006,-3.533],[261.427,-3.533],[270.848,-3.533],[280.269,-3.533],[289.69,-3.533],[299.11,-3.533],[308.531,-3.533],[317.952,-3.533],[327.373,-3.533],[336.794,-3.533],[148.378,-37.683],[157.798,-37.683],[167.219,-37.683],[176.64,-37.683],[186.061,-37.683],[195.482,-37.683],[204.902,-37.683],[214.323,-37.683],[223.744,-37.683],[233.165,-37.683],[242.586,-37.683],[252.006,-37.683],[261.427,-37.683],[270.848,-37.683],[280.269,-37.683],[289.69,-37.683],[299.11,-37.683],[308.531,-37.683],[317.952,-37.683],[327.373,-37.683],[336.794,-37.683],[118.938,-68.301],[128.358,-68.301],[137.779,-68.301],[147.2,-68.301],[156.621,-68.301],[166.042,-68.301],[175.462,-68.301],[184.883,-68.301],[194.304,-68.301],[203.725,-68.301],[213.146,-68.301],[222.566,-68.301],[231.987,-68.301],[241.408,-68.301],[250.829,-68.301],[260.25,-68.301],[269.67,-68.301],[279.091,-68.301],[288.512,-68.301],[297.933,-68.301],[307.354,-68.301],[316.774,-68.301],[326.195,-68.301],[335.616,-68.301],[-76.544,-91.853],[-67.123,-91.853],[-57.702,-91.853],[-48.282,-91.853],[-38.861,-91.853],[-29.44,-91.853],[-20.019,-91.853],[-10.598,-91.853],[-1.178,-91.853],[8.243,-91.853],[17.664,-91.853],[27.085,-91.853],[36.506,-91.853],[45.926,-91.853],[55.347,-91.853],[64.768,-91.853],[74.189,-91.853],[83.61,-91.853],[93.03,-91.853],[102.451,-91.853],[111.872,-91.853],[121.293,-91.853],[130.714,-91.853],[140.134,-91.853],[149.555,-91.853],[158.976,-91.853],[-76.544,-116.582],[-67.123,-116.582],[-57.702,-116.582],[-48.282,-116.582],[-38.861,-116.582],[-29.44,-116.582],[-20.019,-116.582],[-10.598,-116.582],[-1.178,-116.582],[8.243,-116.582],[17.664,-116.582],[27.085,-116.582],[36.506,-116.582],[45.926,-116.582],[55.347,-116.582],[64.768,-116.582],[74.189,-116.582],[83.61,-116.582],[93.03,-116.582],[102.451,-116.582],[111.872,-116.582],[121.293,-116.582],[130.714,-116.582],[140.134,-116.582],[-76.544,-142.49],[-67.123,-142.49],[-57.702,-142.49],[-48.282,-142.49],[-38.861,-142.49],[-29.44,-142.49],[-20.019,-142.49],[-10.598,-142.49],[-1.178,-142.49],[8.243,-142.49],[17.664,-142.49],[27.085,-142.49],[36.506,-142.49],[45.926,-142.49],[55.347,-142.49],[64.768,-142.49],[74.189,-142.49],[83.61,-142.49],[93.03,-142.49],[102.451,-142.49],[111.872,-142.49],[121.293,-142.49]],"rot":90}},
    {"templateId":"oneplan:scale:pop-up-tent","name":"餐饮白棚","color":"#f2f2f2","placement":{"kind":"scatter","at":[[288.512,-87.142],[299.11,-87.142],[309.709,-87.142],[321.485,-87.142],[333.261,-87.142],[335.616,-98.918],[334.438,-111.872],[323.84,-111.872],[310.886,-111.872],[300.288,-111.872],[289.69,-111.872]],"rot":0}},
    {"templateId":"oneplan:icon:information-point","name":"WG 点","color":"#2b5fd9","placement":{"kind":"scatter","at":[[-180.173,31.795],[-154.266,32.973]],"rot":0}},
    {"templateId":"oneplan:icon:first-aid-point","name":"急救点","color":"#c0392b","placement":{"kind":"single","x":241.408,"y":-142.49,"rot":0}},
    {"templateId":"oneplan:scale:tent","name":"白大帐","color":"#f2f2f2","placement":{"kind":"single","x":267.315,"y":-90.675,"rot":0}},
  ],
  routes: [
    {"name":"车行 · 进出场主线","kind":"vehicle","carrier":"vehicle","oneWay":true,"widthM":5,"color":"#2b5fd9","points":[[-201.37,15.309],[-102.451,17.664],[11.776,17.664],[49.459,-16.486],[80.077,-51.814],[110.694,-78.899]]},
    {"name":"人流 · 展场→停车→餐饮","kind":"pedestrian","carrier":"walk","oneWay":true,"widthM":3,"color":"#f2c744","points":[[-4.71,83.61],[343.859,83.61],[393.318,16.486],[410.982,-44.749],[415.693,-123.648],[461.619,-127.181]]},
  ],
  nodes: [
    {"name":"西口","kind":"both","x":-201.37,"y":15.309},
    {"name":"东口","kind":"both","x":461.619,"y":-127.181},
  ],
  confirmedView: {"lng":-2.621885,"lat":53.48019,"zoom":16.75,"rotationDeg":342},
  rotationDeg: 18,
};

export const TRAFALGAR_SQUARE_COURSE: ReplicaCaseSpec = {
  slug: "trafalgar-square-event-planning-for-crowded-space-course",
  title: "Trafalgar Square 'Event Planning for Crowded Space' Course",
  category: "Education",
  region: "Europe",
  refImage: "trafalgar-square-event-planning-for-crowded-space-course.png",
  refLink: "https://www.oneplan.io/inspiration/trafalgar-square-event-planning-for-crowded-space-course/",
  anchor: {"lng":-0.127764,"lat":51.507927},
  rotationDeg: 0,
  locationNote: "2026-11-18 按原图逐块描绘；沿用用户右侧已确认位置 / 0° / z17.5，未重新配准。比例 0.150891 m/px；设施占地为模板估计，非现场实测。",
  zones: [
    {"name":"North Green 北绿区","semantic":"audience","color":"#3fb544","opacity":0.3,"polygon":[[-57.942,23.177],[42.877,69.144],[39.401,43.65],[4.249,33.993],[1.931,37.856],[-45.195,21.245],[-51.375,14.292]]},
    {"name":"Center Yellow 中央黄区","semantic":"reserved","color":"#f2d024","opacity":0.3,"polygon":[[-12.361,10.43],[6.953,16.996],[15.065,-3.09],[-4.635,-10.043]]},
    {"name":"Fountain East 东喷泉区","semantic":"reserved","color":"#7fd0e8","opacity":0.3,"polygon":[[15.451,9.657],[19.314,13.134],[24.722,13.134],[27.426,16.224],[33.993,15.838],[37.083,11.588],[40.946,9.657],[41.718,3.477],[38.628,-2.704],[36.697,-8.884],[28.971,-11.975],[22.404,-10.43],[18.928,-6.18],[15.451,-3.09]]},
    {"name":"Fountain West 西喷泉区","semantic":"reserved","color":"#7fd0e8","opacity":0.3,"polygon":[[-35.538,-11.975],[-28.971,-8.112],[-25.495,-3.477],[-18.541,-3.477],[-15.065,-5.794],[-9.271,-8.498],[-6.18,-14.292],[-6.567,-19.7],[-11.588,-23.177],[-14.292,-29.744],[-21.632,-30.516],[-27.812,-28.199],[-32.448,-23.177]]},
    {"name":"Brown Path 棕道","semantic":"reserved","color":"#a06a3a","opacity":0.3,"polygon":[[-8.884,-10.043],[-4.249,-8.884],[15.451,-3.477],[18.541,-7.726],[22.404,-11.588],[27.426,-13.906],[33.22,-20.087],[30.516,-26.267],[10.043,-32.834],[-6.567,-35.924]]},
    {"name":"Screen 大屏区","semantic":"stage","color":"#8a8f96","opacity":0.35,"polygon":[[-6.18,-29.357],[17.769,-23.563],[19.7,-30.516],[-3.863,-36.697]]},
    {"name":"Purple Block 紫块","semantic":"reserved","color":"#b362c9","opacity":0.3,"polygon":[[28.971,-25.108],[42.491,-20.473],[49.444,-37.083],[35.924,-42.491]]},
    {"name":"Blue Perimeter 蓝围界","semantic":"queue","color":"#2b5fd9","opacity":0.12,"polygon":[[-69.144,23.949],[44.036,71.076],[65.282,-27.812],[51.762,-37.083],[41.718,-45.581],[2.318,-58.715],[-29.744,-64.123],[-54.852,0.773],[-51.375,10.043]]},
    {"name":"Red Crossing 东过街三角","semantic":"queue","color":"#c0392b","opacity":0.25,"polygon":[[52.148,-52.148],[73.78,-36.697],[67.213,-59.874]]},
    {"name":"Red Crossing 南过街三角","semantic":"queue","color":"#c0392b","opacity":0.25,"polygon":[[-41.718,-71.462],[-15.838,-72.621],[12.747,-68.372],[8.498,-82.278],[-16.61,-75.325],[-42.105,-74.166]]},
  ],
  facilities: [
    {"templateId":"oneplan:scale:large-screen","name":"大屏","placement":{"kind":"scatter","at":[[0,-31.675],[12.747,-27.812]],"rot":0}},
    {"templateId":"oneplan:icon:stanchion","name":"黄点柱","color":"#f2d024","placement":{"kind":"scatter","at":[[-48.285,19.314],[-44.036,20.473],[-39.401,25.108],[-35.152,27.04],[-51.762,22.018],[-56.011,22.791],[-61.419,22.791],[-54.079,18.541]],"rot":0}},
    {"templateId":"oneplan:icon:first-aid-point","name":"急救点","color":"#c0392b","placement":{"kind":"scatter","at":[[-13.52,44.036],[-72.621,40.946]],"rot":0}},
    {"templateId":"oneplan:icon:information-point","name":"信息点","color":"#3fb544","placement":{"kind":"scatter","at":[[-42.491,5.408],[42.491,-28.585]],"rot":0}},
    {"templateId":"oneplan:icon:ticket-check","name":"核验点","color":"#e07b30","placement":{"kind":"scatter","at":[[35.924,28.585],[22.404,25.881]],"rot":0}},
    {"templateId":"oneplan:icon:wheel-station","name":"轮椅点","color":"#2b5fd9","placement":{"kind":"scatter","at":[[54.852,-2.318],[54.08,0.773]],"rot":0}},
    {"templateId":"oneplan:icon:cone","name":"橙色导流","color":"#e07b30","placement":{"kind":"single","x":63.736,"y":-53.307,"rot":20}},
  ],
  routes: [
    {"name":"人流 · 西北入口→广场","kind":"pedestrian","carrier":"walk","oneWay":true,"widthM":3,"color":"#e07b30","points":[[-114.339,2.704],[-99.274,11.588],[-88.458,18.155],[-73.007,15.451],[-61.419,8.112]]},
    {"name":"人流 · 广场环线","kind":"pedestrian","carrier":"walk","oneWay":true,"widthM":3,"color":"#f2c744","points":[[46.74,57.17],[56.011,56.397]]},
  ],
  nodes: [
    {"name":"西北口","kind":"both","x":-114.339,"y":2.704},
    {"name":"东口","kind":"both","x":56.011,"y":56.397},
  ],
  confirmedView: {"lng":-0.127764,"lat":51.507927,"zoom":17.5,"rotationDeg":0},
};

export const EUROVISION_HOST_CITY_BID: ReplicaCaseSpec = {
  slug: "eurovision-song-contest-host-city-bid",
  title: "Eurovision Song Contest – Host City Bid",
  category: "Education",
  region: "Europe",
  refImage: "eurovision-song-contest-host-city-bid.png",
  refLink: "https://www.oneplan.io/inspiration/eurovision-song-contest-host-city-bid/",
  anchor: {"lng":-1.542962,"lat":53.803387},
  locationNote: "2026-11-18 按原图逐块描绘；沿用用户右侧已确认位置 / 0° / z16.75，未重新配准。比例 0.247805 m/px；设施占地为模板估计，非现场实测。",
  zones: [
    {"name":"Arena 场馆","semantic":"stage","color":"#8a8f96","opacity":0.3,"polygon":[[15.86,127.51],[54.557,104.038],[84.373,76.76],[106.576,38.697],[117.995,-1.269],[115.457,-14.591],[104.673,-14.591],[87.545,-9.516],[82.469,-31.085],[71.051,-46.31],[43.138,-36.794],[17.128,-30.45],[-8.881,-21.569],[-10.15,15.86],[-4.441,46.944],[-12.053,60.901],[0,102.135]]},
    {"name":"Fan Zone 粉丝区","semantic":"audience","color":"#3fb544","opacity":0.3,"polygon":[[-65.976,35.525],[-48.213,56.46],[-36.16,58.363],[-35.525,64.707],[-17.763,60.901],[-5.075,69.782],[2.538,66.61],[-3.806,47.579],[-8.881,24.741],[-12.688,-1.269],[-36.16,-0.634],[-32.353,28.547]]},
    {"name":"Deputation Bubble 评审团区","semantic":"vip","color":"#b3628c","opacity":0.35,"polygon":[[-107.845,11.419],[-83.104,23.472],[-58.363,14.591],[-48.213,-11.419],[-67.244,-50.75],[-119.898,-30.45]]},
    {"name":"Press Centre 媒体中心","semantic":"reserved","color":"#ec5fa8","opacity":0.3,"polygon":[[-192.852,-48.213],[-171.283,-34.257],[-91.351,-67.244],[-98.329,-75.491],[-145.908,-57.094],[-189.045,-74.857]]},
    {"name":"Transport Hub 交通枢纽","semantic":"checkin","color":"#7fd0e8","opacity":0.3,"polygon":[[-187.142,34.257],[-165.573,52.654],[-144.639,31.085],[-164.939,10.784]]},
    {"name":"Route Ring 蓝色环线带","semantic":"reserved","color":"#2b5fd9","opacity":0.1,"polygon":[[-201.733,36.794],[-170.648,64.072],[-160.498,58.997],[-128.779,29.816],[-130.048,12.688],[-160.498,1.903],[-168.111,3.806]]},
  ],
  facilities: [
    {"templateId":"oneplan:scale:pop-up-tent","name":"粉丝帐篷","color":"#3fb544","placement":{"kind":"scatter","at":[[-57.094,40.6],[-50.75,45.675],[-46.944,50.75]],"rot":0}},
    {"templateId":"oneplan:icon:vip","name":"评审点","color":"#b3628c","placement":{"kind":"single","x":-93.888,"y":-8.881,"rot":0}},
    {"templateId":"oneplan:icon:camera-fixed","name":"媒体点","color":"#ec5fa8","placement":{"kind":"single","x":-147.176,"y":-55.191,"rot":0}},
    {"templateId":"oneplan:icon:first-aid-point","name":"急救点","color":"#c0392b","placement":{"kind":"scatter","at":[[-171.283,116.092],[1.269,128.145]],"rot":0}},
    {"templateId":"oneplan:icon:traffic-lights","name":"管控点","color":"#e07b30","placement":{"kind":"scatter","at":[[-129.414,31.719],[-198.561,-45.041]],"rot":0}},
    {"templateId":"oneplan:scale:bus","name":"摆渡大巴","color":"#f2d024","placement":{"kind":"scatter","at":[[111.651,-20.935],[114.188,-28.547],[112.92,-37.428]],"rot":90}},
  ],
  routes: [
    {"name":"人流 · 蓝色安检环线","kind":"pedestrian","carrier":"walk","oneWay":true,"widthM":3,"color":"#2b5fd9","points":[[192.217,60.901],[200.464,57.729],[190.949,32.988],[172.551,1.903],[152.251,-26.644],[123.07,-57.729],[102.135,-79.298],[71.051,-101.501],[52.654,-114.188],[48.847,-123.704]]},
    {"name":"人流 · 电车站→场馆","kind":"pedestrian","carrier":"walk","oneWay":true,"widthM":3,"color":"#7fd0e8","points":[[48.847,-123.704],[71.685,-104.038],[97.695,-83.738],[122.435,-55.825],[121.801,-35.525],[118.629,-5.075],[106.576,39.332],[86.91,76.76],[54.557,104.673],[16.494,126.876],[0,111.017],[-29.816,71.685],[-77.394,29.816],[-149.714,-15.86],[-153.52,-29.182],[-198.561,-54.557]]},
    {"name":"车行 · 媒体车辆线（紫）","kind":"vehicle","carrier":"vehicle","oneWay":true,"widthM":4,"color":"#b362c9","points":[[-198.561,-54.557],[-149.079,-20.935],[-109.748,8.247],[-63.438,39.966],[-23.472,77.394],[-3.806,103.404]]},
  ],
  nodes: [
    {"name":"西安检口","kind":"both","x":192.217,"y":60.901},
    {"name":"电车站","kind":"both","x":48.847,"y":-123.704},
  ],
  confirmedView: {"lng":-1.542962,"lat":53.803387,"zoom":16.75,"rotationDeg":0},
  rotationDeg: 0,
};
