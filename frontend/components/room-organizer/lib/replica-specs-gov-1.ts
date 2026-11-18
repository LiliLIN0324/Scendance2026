/**
 * OnePlan 复刻规格 · 政府/社区类第一批（4 案）。
 */

import type { ReplicaCaseSpec } from './replica-kit';


export const BANBURY_TOWN_COUNCIL_CORONATION: ReplicaCaseSpec = {
  slug: "banbury-town-council-coronation-events",
  title: "Banbury Town Council – Coronation Events",
  category: "Local Governments",
  region: "Europe",
  refImage: "banbury-town-council-coronation-events.png",
  refLink: "https://www.oneplan.io/inspiration/banbury-town-council-coronation-events/",
  anchor: {"lng":-1.3325,"lat":52.0662},
  rotationDeg: 271.993516,
  locationNote: "2026-11-18 修正描图原点与原图几何方向；保留用户确认视图 98° / z16.25。原图 0.302444 m/px，22 个影像对应点，拟合 RMS 1.04 m（非现场测量精度）。设施米制占地保留。",
  zones: [
    {"name":"Event Field 活动场","semantic":"reserved","color":"#3fb544","opacity":0.2,"polygon":[[-4.052,141.939],[48.598,114.84],[91.182,162.07],[38.532,194.589]]},
    {"name":"Main Stage 主舞台群","semantic":"stage","color":"#111111","opacity":0.4,"polygon":[[-16.44,152.005],[-2.503,144.262],[23.047,189.169],[13.755,196.911]]},
    {"name":"Fence 围栏环","semantic":"queue","color":"#c0392b","opacity":0.15,"polygon":[[-58.25,93.936],[-43.539,58.32],[-11.795,45.157],[66.405,38.964],[84.987,51.352],[113.635,128.002],[113.635,200.782],[31.563,227.107],[12.982,213.171],[-17.989,158.198],[-24.957,107.872]]},
    {"name":"Marquee Row 棚列（东）","semantic":"reserved","color":"#ec5fa8","opacity":0.25,"polygon":[[67.954,108.646],[80.342,103.226],[96.602,141.939],[92.73,168.264]]},
    {"name":"Fun Fair 游乐区","semantic":"reserved","color":"#e07b30","opacity":0.25,"polygon":[[-46.636,94.709],[-4.826,97.806],[53.243,97.806],[87.31,70.708],[66.405,48.254],[-9.471,53.674]]},
    {"name":"Helipad 停机坪","semantic":"loading","color":"#c0392b","opacity":0.35,"polygon":[[283.197,108.646],[278.718,86.128],[265.962,67.038],[246.872,54.282],[224.353,49.803],[201.835,54.282],[182.745,67.038],[169.989,86.128],[165.51,108.646],[169.989,131.164],[182.745,150.255],[201.835,163.011],[224.353,167.49],[246.872,163.011],[265.962,150.255],[278.718,131.164]]},
    {"name":"Gate Lane 入口车道","semantic":"checkin","color":"#7fd0e8","opacity":0.3,"polygon":[[-89.22,122.582],[-79.93,124.905],[-73.735,96.258],[-83.8,94.709]]},
  ],
  facilities: [
    {"templateId":"oneplan:scale:pop-up-tent","name":"红棚","color":"#c0392b","placement":{"kind":"scatter","at":[[-14.891,129.551],[-15.666,125.68],[-16.44,121.809],[-17.214,117.937],[-17.214,114.066],[-17.989,110.194],[-16.44,106.324],[-11.021,114.84],[-7.923,110.969]],"rot":0}},
    {"templateId":"oneplan:scale:pop-up-tent","name":"橙棚","color":"#e07b30","placement":{"kind":"scatter","at":[[36.209,194.589],[42.403,191.491],[48.598,187.621],[55.566,183.749],[61.759,180.652],[68.728,176.006],[75.696,172.135]],"rot":0}},
    {"templateId":"oneplan:scale:pop-up-tent","name":"粉棚","color":"#ec5fa8","placement":{"kind":"scatter","at":[[-23.409,79.225],[27.693,61.417]],"rot":0}},
    {"templateId":"oneplan:scale:pop-up-tent","name":"青棚","color":"#7fd0e8","placement":{"kind":"scatter","at":[[61.759,79.225],[81.116,83.096]],"rot":0}},
    {"templateId":"oneplan:scale:pop-up-tent","name":"游乐棚","color":"#e8b838","placement":{"kind":"scatter","at":[[-0.181,69.16],[23.047,91.613],[35.435,91.613],[43.951,78.45]],"rot":0}},
    {"templateId":"oneplan:scale:pop-up-tent","name":"紫棚","color":"#b362c9","placement":{"kind":"scatter","at":[[5.239,85.418],[12.207,90.064]],"rot":0}},
    {"templateId":"oneplan:icon:entry-gate","name":"绿箭头门","color":"#3fb544","placement":{"kind":"scatter","at":[[-56.702,86.968],[-52.83,85.418],[-47.41,88.516]],"rot":0}},
    {"templateId":"oneplan:icon:first-aid-point","name":"急救点","color":"#c0392b","placement":{"kind":"scatter","at":[[12.982,109.421],[112.086,190.717]],"rot":0}},
    {"templateId":"oneplan:scale:portable-toilet","name":"移动洗手间","placement":{"kind":"scatter","at":[[-54.379,119.486],[-53.604,114.066],[-52.056,107.872],[-51.282,103.226],[-49.734,97.806]],"rot":0}},
    {"templateId":"trash-point-1.2x1.2","name":"垃圾点","color":"#f2d024","placement":{"kind":"scatter","at":[[-17.214,83.87],[84.987,132.648]],"rot":0}},
  ],
  routes: [
    {"name":"人流 · 门→场→游乐区","kind":"pedestrian","carrier":"walk","oneWay":true,"widthM":3,"color":"#f2c744","points":[[-56.702,86.193],[-36.571,90.838],[-16.44,98.581],[-4.826,121.809],[-1.73,140.39]]},
    {"name":"车行 · 应急通道","kind":"vehicle","carrier":"vehicle","oneWay":true,"widthM":4,"points":[[-318.4,207.751],[-259.556,228.655],[-210.004,228.655],[-167.42,190.717],[-142.644,173.683],[-134.127,153.553],[-118.642,139.617],[-115.544,86.968]]},
  ],
  nodes: [
    {"name":"公园主门","kind":"both","x":-56.702,"y":86.193},
    {"name":"应急门","kind":"exit","x":113.635,"y":193.814},
  ],
  confirmedView: {"lng":-1.3325,"lat":52.0662,"zoom":16.25,"rotationDeg":98},
  sourceRegistration: {"imageAnchorPx":[1254.997909,1050.42777],"metersPerPixel":0.3024436972545683,"geometryRotationDeg":271.993516,"method":"image-correspondences","matchedPointCount":22,"fitRmseM":1.0404476696766203,"controlPoints":[{"imagePx":[29.5514892578125,354.5907470703125],"lng":-1.3357766554690897,"lat":52.06294299997223,"residualM":1.1461394748600273},{"imagePx":[1130.10576171875,414.43427734375],"lng":-1.3353425455716206,"lat":52.06591570745678,"residualM":1.1398373031844762},{"imagePx":[97.66202392578126,965.78984375],"lng":-1.3330520202725893,"lat":52.06305988466357,"residualM":0.6173827394494575}]},
};

export const ROTHERHAM_CHRISTMAS_LIGHT_SWITCH_ON: ReplicaCaseSpec = {
  slug: "rotherham-christmas-light-switch-on",
  title: "Rotherham Christmas Light Switch On",
  category: "Local Governments",
  region: "Europe",
  refImage: "rotherham-christmas-light-switch-on.png",
  refLink: "https://www.oneplan.io/inspiration/rotherham-christmas-light-switch-on/",
  anchor: {"lng":-1.355885,"lat":53.43228},
  rotationDeg: 282,
  locationNote: "2026-11-18 按原图逐块描绘；沿用用户右侧已确认位置 / 78° / z17，未重新配准。比例 0.225778 m/px；设施占地为模板估计，非现场实测。",
  zones: [
    {"name":"Main Stage Square 主舞台广场","semantic":"stage","color":"#ec5fa8","opacity":0.35,"polygon":[[-120.8,39.303],[-99.414,42.771],[-94.791,22.542],[-91.323,6.936],[-115.02,-0.578]]},
    {"name":"Stage Block 舞台体","semantic":"stage","color":"#2b5fd9","opacity":0.4,"polygon":[[-106.35,14.45],[-98.836,14.45],[-97.68,6.936],[-105.194,5.202]]},
    {"name":"Orange Stage 西舞台区","semantic":"stage","color":"#e07b30","opacity":0.3,"polygon":[[-131.204,52.597],[-90.745,66.469],[-86.699,55.487],[-84.387,10.982],[-90.745,7.514],[-95.369,31.212],[-99.414,41.615],[-120.8,39.303]]},
    {"name":"Market Strip 东市集带","semantic":"reserved","color":"#3fb544","opacity":0.3,"polygon":[[-53.753,-11.56],[9.248,-14.45],[4.624,-32.368],[-54.331,-30.634]]},
    {"name":"Crossing 交叉口","semantic":"queue","color":"#e07b30","opacity":0.3,"polygon":[[9.248,-13.872],[24.276,-8.092],[39.881,-16.184],[39.303,-35.835],[25.432,-56.643],[0,-49.707]]},
    {"name":"Red Zone 东红区","semantic":"reserved","color":"#c0392b","opacity":0.25,"polygon":[[117.91,-10.404],[182.067,-10.982],[162.993,-53.753]]},
    {"name":"All Saints 青区","semantic":"audience","color":"#7fd0e8","opacity":0.3,"polygon":[[-109.818,-3.468],[-100.57,2.312],[-86.699,-10.982],[-53.753,-11.56],[-54.331,-31.79],[-94.213,-31.212],[-106.35,-21.386]]},
    {"name":"Green Parks 北绿园","semantic":"reserved","color":"#3fb544","opacity":0.2,"polygon":[[-210.389,73.405],[-158.948,95.947],[-153.168,75.717],[-172.241,67.625],[-195.361,50.285]]},
  ],
  facilities: [
    {"templateId":"stage-platform-8x6","name":"舞台台体","placement":{"kind":"single","x":-103.46,"y":10.404,"rot":0}},
    {"templateId":"oneplan:icon:ticket-check","name":"交叉口管控","color":"#e07b30","placement":{"kind":"single","x":20.808,"y":-27.744,"rot":0}},
    {"templateId":"oneplan:icon:first-aid-point","name":"急救点","color":"#c0392b","placement":{"kind":"single","x":-122.534,"y":20.808,"rot":0}},
    {"templateId":"oneplan:icon:information-point","name":"信息点","color":"#2b5fd9","placement":{"kind":"single","x":-107.506,"y":-4.624,"rot":0}},
    {"templateId":"oneplan:icon:stanchion","name":"隔离柱","color":"#3fb544","placement":{"kind":"scatter","at":[[-102.882,-18.496],[-95.369,-29.478]],"rot":0}},
  ],
  routes: [
    {"name":"人流 · 北街南下主线","kind":"pedestrian","carrier":"walk","oneWay":true,"widthM":3,"color":"#2b5fd9","points":[[-146.232,101.148],[-131.782,63.579],[-120.8,42.193],[-115.02,10.404],[-103.46,-23.12],[-117.91,-52.597],[-149.122,-92.479]]},
    {"name":"人流 · 西环线","kind":"pedestrian","carrier":"walk","oneWay":true,"widthM":3,"color":"#2b5fd9","points":[[-12.716,119.644],[-41.615,88.433],[-86.699,58.377]]},
  ],
  nodes: [
    {"name":"北街口","kind":"both","x":-146.232,"y":101.148},
    {"name":"西街口","kind":"both","x":-149.122,"y":-92.479},
  ],
  confirmedView: {"lng":-1.355885,"lat":53.43228,"zoom":17,"rotationDeg":78},
};

export const FAREHAM_WEST_SCOUTS_CAMP24: ReplicaCaseSpec = {
  slug: "fareham-west-scouts-camp24",
  title: "Fareham West Scouts – Camp24",
  category: "Local Governments",
  region: "Europe",
  refImage: "fareham-west-scouts-camp24.png",
  refLink: "https://www.oneplan.io/inspiration/fareham-west-scouts-camp24/",
  anchor: {"lng":-1.220584,"lat":50.924741},
  locationNote: "2026-11-18 按原图逐块描绘；沿用用户右侧已确认位置 / 22° / z16.25，未重新配准。比例 0.307879 m/px；设施占地为模板估计，非现场实测。",
  zones: [
    {"name":"Subcamp A 子营","semantic":"reserved","color":"#2b5fd9","opacity":0.2,"polygon":[[-59.113,122.954],[-8.67,152.117],[18.916,128.472],[-37.832,96.157]]},
    {"name":"Subcamp B 子营","semantic":"reserved","color":"#2b5fd9","opacity":0.2,"polygon":[[-33.891,93.792],[17.34,122.166],[44.926,46.502],[-18.128,63.842]]},
    {"name":"M1 Area 活动田","semantic":"reserved","color":"#f2d024","opacity":0.3,"polygon":[[-170.245,-4.729],[-143.447,36.256],[-109.556,7.094],[-121.378,-21.281]]},
    {"name":"Marquee Yard 大棚场","semantic":"stage","color":"#f2d024","opacity":0.35,"polygon":[[-182.067,-44.138],[-168.668,-19.704],[-152.905,-29.162],[-155.269,-48.867]]},
    {"name":"Tent Rows 橙棚列","semantic":"reserved","color":"#e07b30","opacity":0.3,"polygon":[[-102.462,6.305],[-78.817,8.67],[-68.571,-19.704],[-92.216,-40.985]]},
    {"name":"Green Camp 绿营","semantic":"reserved","color":"#3fb544","opacity":0.3,"polygon":[[-141.082,-89.063],[-26.01,-85.91],[44.138,-94.58],[49.655,-133.989],[-14.975,-140.294],[-14.187,-158.422],[44.138,-155.269],[49.655,-105.615]]},
    {"name":"Pink Route 粉路线区","semantic":"reserved","color":"#ec5fa8","opacity":0.15,"polygon":[[96.945,-96.157],[170.245,-85.91],[170.245,-111.92],[161.575,-126.107],[99.309,-125.319]]},
  ],
  facilities: [
    {"templateId":"oneplan:scale:pop-up-tent","name":"橙棚","color":"#e07b30","placement":{"kind":"scatter","at":[[-93.004,-0.788],[-89.851,-8.67],[-87.487,-16.552],[-81.181,0.788],[-77.241,-7.882],[-74.876,-18.128]],"rot":0}},
    {"templateId":"oneplan:scale:pop-up-tent","name":"绿营帐","color":"#3fb544","placement":{"kind":"scatter","at":[[-128.472,-115.073],[-99.309,-156.058],[-74.088,-154.481],[-69.359,-116.649],[-27.586,-148.176],[9.458,-125.319],[17.34,-111.92]],"rot":0}},
    {"templateId":"oneplan:scale:stretch-tent","name":"X 大帐","color":"#f2d024","placement":{"kind":"single","x":-168.668,"y":-33.103,"rot":0}},
    {"templateId":"oneplan:scale:pop-up-tent","name":"黄棚","color":"#f2d024","placement":{"kind":"scatter","at":[[-145.023,-61.477],[-122.954,-63.054],[-102.462,-63.842]],"rot":0}},
    {"templateId":"oneplan:scale:portable-toilet","name":"移动洗手间","color":"#ec5fa8","placement":{"kind":"scatter","at":[[-79.605,-48.867],[-78.817,-58.325]],"rot":90}},
    {"templateId":"oneplan:icon:first-aid-point","name":"急救点","color":"#c0392b","placement":{"kind":"single","x":-21.281,"y":-88.275,"rot":0}},
  ],
  routes: [
    {"name":"步道 · 营地主环线","kind":"pedestrian","carrier":"walk","oneWay":false,"widthM":3,"color":"#2b5fd9","points":[[-141.871,-157.634],[-141.082,-89.851],[-78.817,-86.699],[-61.477,-67.783],[-62.265,-44.138],[-78.817,-25.221],[-79.605,9.458],[-107.979,22.069],[-107.979,-17.34],[-122.954,-25.221],[-148.176,-19.704]]},
    {"name":"人流 · 粉色支线","kind":"pedestrian","carrier":"walk","oneWay":true,"widthM":2,"color":"#ec5fa8","points":[[96.945,-96.157],[97.733,-115.073],[158.422,-111.92]]},
  ],
  nodes: [
    {"name":"营地主门","kind":"both","x":-21.281,"y":-88.275},
    {"name":"粉线口","kind":"both","x":72.512,"y":-130.836},
  ],
  confirmedView: {"lng":-1.220584,"lat":50.924741,"zoom":16.25,"rotationDeg":22},
  rotationDeg: 338,
};

export const VICTORIA_PARK_BRISBANE_EASTER_EGG_HUNT: ReplicaCaseSpec = {
  slug: "victoria-park-brisbane-easter-egg-hunt",
  title: "Victoria Park Brisbane – Easter Egg Hunt",
  category: "Local Governments",
  region: "Australia & NZ",
  refImage: "victoria-park-brisbane-easter-egg-hunt.png",
  refLink: "https://www.oneplan.io/inspiration/victoria-park-brisbane-easter-egg-hunt/",
  anchor: {"lng":153.022281,"lat":-27.453154},
  rotationDeg: 325,
  locationNote: "2026-11-18 按原图逐块描绘；沿用用户右侧已确认位置 / 35° / z16.5，未重新配准。比例 0.333115 m/px；设施占地为模板估计，非现场实测。",
  zones: [
    {"name":"Purple Field 紫田","semantic":"reserved","color":"#b362c9","opacity":0.3,"polygon":[[-142.413,117.683],[-44.344,138.149],[-19.614,89.541],[-119.388,78.455]]},
    {"name":"Clue 2 Bunnies 兔子线索","semantic":"reserved","color":"#7fd0e8","opacity":0.3,"polygon":[[81.866,153.499],[94.658,154.352],[103.186,145.824],[101.48,134.738],[91.247,132.18],[80.161,141.56]]},
    {"name":"Clue 3 Carrots 萝卜线索","semantic":"reserved","color":"#7fd0e8","opacity":0.3,"polygon":[[56.283,112.566],[68.222,109.155],[71.633,102.333],[63.958,94.658],[51.166,100.627]]},
    {"name":"Clue 4 Activities 活动线索","semantic":"reserved","color":"#7fd0e8","opacity":0.3,"polygon":[[7.675,42.639],[35.816,49.461],[46.903,21.319],[18.761,14.497]]},
    {"name":"Clue 5 Maze 迷宫线索","semantic":"reserved","color":"#7fd0e8","opacity":0.3,"polygon":[[-87.836,-23.025],[-69.075,-24.73],[-65.664,-29.847],[-70.78,-34.964],[-82.719,-33.258],[-88.688,-34.111],[-92.952,-30.7]]},
    {"name":"Play Zone 游乐（橙）","semantic":"reserved","color":"#e07b30","opacity":0.3,"polygon":[[141.56,142.413],[147.53,143.266],[161.174,137.297],[160.321,128.769],[145.824,127.063],[135.591,133.033],[136.444,139.002]]},
    {"name":"Play Zone 游乐（橙）B","semantic":"reserved","color":"#e07b30","opacity":0.3,"polygon":[[141.56,105.744],[148.383,103.186],[157.763,94.658],[160.321,89.541],[152.647,86.13],[139.855,92.952]]},
    {"name":"Start 出发区","semantic":"checkin","color":"#3fb544","opacity":0.35,"polygon":[[173.113,150.088],[192.727,140.708],[189.316,133.885],[168.849,141.56]]},
    {"name":"END 终点区","semantic":"stage","color":"#3fb544","opacity":0.25,"polygon":[[-164.585,-74.191],[-150.088,-66.516],[-144.119,-66.516],[-139.855,-69.927],[-142.413,-79.308],[-157.763,-87.836],[-162.88,-86.983]]},
  ],
  facilities: [
    {"templateId":"oneplan:icon:information-point","name":"线索牌","color":"#2b5fd9","placement":{"kind":"scatter","at":[[138.149,161.174],[90.394,144.119],[63.105,104.038],[27.289,33.258],[-78.455,-29.847]],"rot":0}},
    {"templateId":"oneplan:scale:portable-toilet","name":"移动洗手间","placement":{"kind":"scatter","at":[[-186.757,-47.755],[210.635,147.53]],"rot":90}},
  ],
  routes: [
    {"name":"寻蛋 · 红色环线（START→线索→END）","kind":"pedestrian","carrier":"walk","oneWay":true,"widthM":3,"color":"#c0392b","points":[[70.78,176.524],[85.277,176.524],[126.211,159.469],[141.56,161.174],[161.174,156.058],[166.291,132.18],[166.291,109.155],[162.027,95.511],[166.291,81.866],[173.966,69.927],[179.935,57.136],[159.469,50.314],[135.591,38.375],[105.744,18.761],[66.516,-14.497],[-59.694,-54.578],[-82.719,-54.578],[-122.799,-49.461],[-156.058,-50.314],[-172.26,-62.252],[-202.96,-75.897],[-241.335,-98.922],[-195.285,-169.702],[-167.996,-183.346]]},
  ],
  nodes: [
    {"name":"START 出发点","kind":"entry","x":181.641,"y":141.56},
    {"name":"END 终点","kind":"exit","x":-152.647,"y":-76.75},
  ],
  confirmedView: {"lng":153.022281,"lat":-27.453154,"zoom":16.5,"rotationDeg":35},
};
