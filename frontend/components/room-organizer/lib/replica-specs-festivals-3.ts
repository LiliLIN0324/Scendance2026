/**
 * OnePlan 复刻规格 · 节庆类第三批（9 案，节庆类收口）。
 */

import type { ReplicaCaseSpec } from './replica-kit';


export const OUTFIELD_MUSIC_FOOD_ARTS_FESTIVAL: ReplicaCaseSpec = {
  slug: "outfield-music-food-arts-festival",
  title: "Outfield Music, Food & Arts Festival",
  category: "Festivals",
  region: "Australia & NZ",
  refImage: "outfield-music-food-arts-festival.png",
  refLink: "https://www.oneplan.io/inspiration/outfield-music-food-arts-festival/",
  anchor: {"lng":176.967319,"lat":-39.642324},
  locationNote: "2026-11-18 按原图逐块描绘；沿用用户右侧已确认位置 / 6° / z16.25，未重新配准。比例 0.483810 m/px；设施占地为模板估计，非现场实测。",
  zones: [
    {"name":"Event Field 活动场","semantic":"stage","color":"#3fb544","opacity":0.3,"polygon":[[-283.628,-133.764],[-214.27,-133.764],[-214.27,-97.846],[-199.407,-97.846],[-173.397,-107.754],[-170.92,-113.947],[-203.123,-99.084],[-205.6,-144.911],[-278.674,-144.911]]},
    {"name":"Camping 露营（橙）","semantic":"reserved","color":"#c8894a","opacity":0.35,"polygon":[[-284.867,-270.004],[-258.857,-250.188],[-213.031,-250.188],[-203.123,-250.188],[-178.352,-252.665],[-115.185,-194.453],[-49.542,-161.012],[-40.872,-179.59],[-96.607,-239.041],[-182.067,-284.867],[-284.867,-284.867]]},
    {"name":"Camping 露营（绿）","semantic":"reserved","color":"#3fb544","opacity":0.3,"polygon":[[-282.39,-263.812],[-258.857,-247.71],[-203.123,-248.949],[-203.123,-284.867],[-284.867,-284.867]]},
    {"name":"Hill Carpark 山坡停车","semantic":"parking","color":"#3fb544","opacity":0.3,"polygon":[[179.59,165.966],[204.361,230.371],[184.544,220.462],[177.113,250.188],[184.544,292.298],[204.361,294.775],[221.701,279.913],[221.701,64.405],[213.031,60.689],[209.315,122.617],[183.306,132.525]]},
    {"name":"Triangle Carpark 三角停车","semantic":"parking","color":"#3fb544","opacity":0.35,"polygon":[[245.233,47.065],[242.756,144.911],[271.243,121.378],[284.867,141.195],[338.125,95.369],[310.877,37.157],[273.72,38.395]]},
  ],
  facilities: [
    {"templateId":"oneplan:scale:stage","name":"主舞台","color":"#2b5fd9","placement":{"kind":"single","x":-240.279,"y":-68.12,"rot":0}},
    {"templateId":"oneplan:scale:pop-up-tent","name":"活动棚","color":"#f2d024","placement":{"kind":"scatter","at":[[-255.142,-73.075],[-245.233,-74.313],[-235.325,-75.552]],"rot":0}},
    {"templateId":"oneplan:scale:market-stall","name":"餐摊","color":"#ec5fa8","placement":{"kind":"scatter","at":[[-230.371,-111.47],[-229.132,-120.14],[-229.132,-131.287],[-203.123,-130.048]],"rot":0}},
    {"templateId":"oneplan:scale:portable-toilet","name":"移动洗手间","placement":{"kind":"scatter","at":[[-250.188,-143.672],[-242.756,-143.672],[-234.086,-143.672]],"rot":90}},
  ],
  routes: [
    {"name":"车行 · 进场山路","kind":"vehicle","carrier":"vehicle","oneWay":true,"widthM":4,"color":"#f2d024","points":[[-401.291,61.928],[-386.428,56.973],[-367.85,56.973],[-346.795,60.689],[-324.501,19.817],[-318.308,-4.954],[-309.638,-56.973],[-304.684,-79.267],[-330.693,-113.947],[-390.144,-174.636]]},
    {"name":"人流 · 营地→活动场","kind":"pedestrian","carrier":"walk","oneWay":true,"widthM":3,"color":"#f2c744","points":[[-226.655,-79.267],[-206.838,-91.653],[-172.159,-113.947],[-141.195,-101.561],[-106.516,-100.323],[-11.147,-142.434],[64.405,-113.947],[101.561,-118.901],[112.708,-80.506],[141.195,-68.12],[172.159,-74.313],[209.315,-35.918],[246.472,23.532],[225.417,64.405],[217.985,237.802]]},
  ],
  nodes: [
    {"name":"山路口","kind":"entry","x":217.985,"y":237.802},
    {"name":"营地门","kind":"both","x":-226.655,"y":-79.267},
  ],
  confirmedView: {"lng":176.967319,"lat":-39.642324,"zoom":16.25,"rotationDeg":6},
  rotationDeg: 354,
};

export const DESERT_WINEFEST: ReplicaCaseSpec = {
  slug: "desert-winefest",
  title: "Desert WineFest",
  category: "Festivals",
  region: "North America",
  refImage: "desert-winefest.png",
  refLink: "https://www.oneplan.io/inspiration/desert-winefest/",
  anchor: {"lng":-116.379576,"lat":33.7327},
  locationNote: "2026-11-18 按原图逐块描绘；沿用用户右侧已确认位置 / 0° / z18.25，未重新配准。比例 0.100927 m/px；设施占地为模板估计，非现场实测。",
  zones: [
    {"name":"Tasting Matrix A 品酒阵 A","semantic":"reserved","color":"#2b5fd9","opacity":0.12,"polygon":[[-16.536,19.378],[7.493,19.378],[6.976,11.368],[-16.278,11.368]]},
    {"name":"Tasting Matrix B 品酒阵 B","semantic":"reserved","color":"#2b5fd9","opacity":0.12,"polygon":[[-14.986,3.1],[4.651,3.1],[4.909,-5.426],[-14.727,-5.426]]},
    {"name":"Tasting Matrix C 品酒阵 C","semantic":"reserved","color":"#2b5fd9","opacity":0.12,"polygon":[[-14.211,-11.368],[7.493,-11.368],[7.751,-20.153],[-14.211,-20.153]]},
    {"name":"Tasting Matrix D 品酒阵 D","semantic":"reserved","color":"#2b5fd9","opacity":0.12,"polygon":[[-13.952,-26.096],[8.785,-26.354],[9.043,-36.172],[-13.694,-36.172]]},
    {"name":"Stage 区","semantic":"stage","color":"#f2d024","opacity":0.25,"polygon":[[16.536,-36.947],[24.029,-37.464],[24.029,-43.148],[16.019,-42.632]]},
    {"name":"Food Trucks 餐车带","semantic":"reserved","color":"#3fb544","opacity":0.2,"polygon":[[5.943,54.517],[37.464,54.517],[46.507,34.105],[39.531,32.038],[32.813,46.766],[5.943,46.766]]},
    {"name":"Entry 入口","semantic":"checkin","color":"#f2d024","opacity":0.3,"polygon":[[-60.718,41.081],[-55.292,40.565],[-57.617,34.105],[-62.785,34.88]]},
  ],
  facilities: [
    {"templateId":"booth-2x2","name":"品酒摊（蓝）","color":"#2b5fd9","placement":{"kind":"scatter","at":[[-11.627,17.311],[-3.1,17.311],[-13.952,13.177],[-5.426,13.177],[-12.66,-0.775],[-9.043,-3.1],[-11.11,-13.435],[-6.976,-17.569],[-1.809,-29.196],[-10.077,-33.33],[-6.201,-33.33],[-10.077,-29.455],[5.426,-13.694],[5.426,-16.794],[1.292,-17.828]],"rot":0}},
    {"templateId":"booth-2x2","name":"品酒摊（黄）","color":"#f2d024","placement":{"kind":"scatter","at":[[-7.751,17.311],[1.292,17.311],[-9.818,13.177],[-1.033,1.292],[-4.651,1.033],[-4.651,-3.359],[-3.1,-13.435],[-3.1,-17.828],[-5.684,-29.196],[-2.584,-33.33],[1.809,-33.33]],"rot":0}},
    {"templateId":"booth-2x2","name":"品酒摊（蓝·南）","color":"#2b5fd9","placement":{"kind":"scatter","at":[[19.378,13.952],[23.254,13.952],[32.038,14.211],[32.297,18.603],[24.804,2.325],[33.33,2.325],[37.464,0.258],[29.455,-1.55],[22.995,-12.919],[27.129,-12.66],[30.746,-12.66],[30.23,-30.488],[34.364,-26.096]],"rot":0}},
    {"templateId":"booth-2x2","name":"品酒摊（黄·南）","color":"#f2d024","placement":{"kind":"scatter","at":[[19.636,18.345],[24.545,18.086],[27.904,13.952],[28.938,2.067],[25.321,-2.325],[33.847,-1.809],[29.713,-16.794],[35.139,-17.053]],"rot":0}},
    {"templateId":"food-truck-6x2.5","name":"Food Truck","placement":{"kind":"scatter","at":[[22.22,51.158],[34.364,50.383],[38.498,43.665],[41.598,35.914]],"rot":0}},
    {"templateId":"oneplan:scale:stage","name":"Stage","placement":{"kind":"single","x":20.153,"y":-40.306,"rot":0}},
    {"templateId":"oneplan:scale:pop-up-tent","name":"白大帐","color":"#f2f2f2","placement":{"kind":"scatter","at":[[-54.517,25.837],[-54.258,19.378],[-54.517,13.435]],"rot":0}},
    {"templateId":"toilet-2.4x1.2","name":"WC","placement":{"kind":"scatter","at":[[-50.383,6.459],[-48.057,6.459],[-45.99,6.459],[-43.923,6.459],[-41.598,6.459]],"rot":0}},
    {"templateId":"oneplan:icon:atm","name":"ATM","placement":{"kind":"single","x":-36.431,"y":44.957,"rot":0}},
  ],
  routes: [
    {"name":"人流 · 入口→品酒阵","kind":"pedestrian","carrier":"walk","oneWay":true,"widthM":3,"color":"#f2c744","points":[[-28.421,67.177],[-29.971,39.014],[-56.842,41.081],[-126.603,41.34]]},
    {"name":"人流 · 餐车带","kind":"pedestrian","carrier":"walk","oneWay":false,"widthM":3,"color":"#d93a2b","points":[[-59.168,30.23],[-56.067,4.134],[-22.22,5.167],[-19.895,12.919],[-16.278,14.727],[5.684,10.335],[16.019,12.66],[16.278,-1.55],[10.077,-39.79]]},
  ],
  nodes: [
    {"name":"主入口","kind":"both","x":-28.421,"y":67.177},
    {"name":"东出口","kind":"exit","x":-57.101,"y":38.239},
  ],
  confirmedView: {"lng":-116.379576,"lat":33.7327,"zoom":18.25,"rotationDeg":0},
  rotationDeg: 0,
};

export const SPEARFISH_FESTIVAL_IN_THE_PARK: ReplicaCaseSpec = {
  slug: "45th-spearfish-festival-in-the-park",
  title: "45th Spearfish Festival in the Park",
  category: "Festivals",
  region: "North America",
  refImage: "45th-spearfish-festival-in-the-park.png",
  refLink: "https://www.oneplan.io/inspiration/45th-spearfish-festival-in-the-park/",
  anchor: {"lng":-103.860881,"lat":44.483188},
  locationNote: "2026-11-18 按原图逐块描绘；沿用用户右侧已确认位置 / 281° / z17.5，未重新配准。比例 0.169333 m/px；设施占地为模板估计，非现场实测。",
  zones: [
    {"name":"Parking North 北停车","semantic":"parking","color":"#a8d8e8","opacity":0.35,"polygon":[[-76.728,72.827],[94.068,73.26],[140.885,74.994],[138.718,60.689],[92.768,51.586],[-76.728,63.29]]},
    {"name":"Parking Yellow 黄停车","semantic":"parking","color":"#f2d024","opacity":0.3,"polygon":[[-76.728,63.29],[92.334,62.423],[92.334,50.719],[-76.728,50.719]]},
    {"name":"Street Closure 街封闭","semantic":"reserved","color":"#e07b30","opacity":0.25,"polygon":[[-107.94,42.049],[3.901,41.182],[3.901,37.714],[-107.94,38.147]]},
    {"name":"Vendor Curve 摊位弧区","semantic":"reserved","color":"#e07b30","opacity":0.3,"polygon":[[-101.437,16.473],[-89.3,24.709],[-74.127,19.074],[-66.758,7.369],[-66.758,-16.906],[-75.861,-31.212],[-97.969,-32.945],[-110.541,-22.108],[-116.176,-37.28],[-102.304,-59.822],[-84.965,-73.26],[-64.157,-83.231],[-3.034,-81.93],[65.024,-73.26],[98.836,-55.487],[117.477,-32.079],[125.28,-0.867],[105.772,5.635],[74.994,0.867],[63.724,-8.67],[58.522,-22.975],[61.556,-29.911],[83.231,-16.039],[110.974,-5.635],[116.61,-8.67],[102.738,-27.31],[88.433,-45.517],[64.157,-59.389],[28.177,-64.157],[7.803,-59.822],[-12.571,-60.256],[-32.945,-73.26],[-65.024,-69.792],[-78.462,-54.187],[-94.068,-43.349],[-109.24,-29.911]]},
    {"name":"Kids Zone 儿童区","semantic":"audience","color":"#ec5fa8","opacity":0.3,"polygon":[[129.615,33.812],[164.294,30.345],[149.555,5.202],[129.615,6.502]]},
    {"name":"Food Court 餐饮区","semantic":"reserved","color":"#e07b30","opacity":0.25,"polygon":[[2.167,19.507],[25.576,19.074],[25.143,-6.936],[1.734,-7.369]]},
  ],
  facilities: [
    {"templateId":"booth-2x2","name":"白摊（西弧）","color":"#f2f2f2","placement":{"kind":"scatter","at":[[-97.507,-18.144],[-100.024,-9.445],[-100.483,0.163],[-98.822,9.404],[-95.264,17.05],[-90.279,22.086],[-84.531,23.842],[-78.783,22.086],[-73.799,17.05],[-70.24,9.404],[-68.58,0.163],[-69.038,-9.445],[-71.555,-18.144],[-121.378,-46.817],[-119.471,-49.538],[-117.563,-52.237],[-115.656,-54.895],[-113.749,-57.492],[-111.841,-60.008],[-109.934,-62.423],[-108.027,-64.719],[-106.119,-66.88],[-104.212,-68.887],[-102.304,-70.727],[-100.397,-72.384],[-98.49,-73.847],[-96.582,-75.105],[-94.675,-76.147],[-92.768,-76.965],[-90.86,-77.555],[-88.953,-77.91],[-87.045,-78.029]],"rot":0}},
    {"templateId":"booth-2x2","name":"白摊（东弧）","color":"#f2f2f2","placement":{"kind":"scatter","at":[[-82.364,-84.531],[-83.664,-65.024],[-75.861,-83.626],[-78.029,-65.873],[-69.359,-82.736],[-72.393,-66.707],[-62.857,-81.877],[-66.758,-67.512],[-56.354,-81.063],[-61.123,-68.275],[-49.852,-80.309],[-55.487,-68.982],[-43.349,-79.627],[-49.852,-69.622],[-36.847,-79.029],[-44.216,-70.183],[-30.345,-78.525],[-38.581,-70.655],[-23.842,-78.123],[-32.945,-71.031],[-17.34,-77.832],[-27.31,-71.305],[-10.837,-77.655],[-21.675,-71.471],[-4.335,-77.595],[-16.039,-71.526],[2.167,-77.655],[-10.404,-71.471],[8.67,-77.832],[-4.768,-71.305],[15.172,-78.123],[0.867,-71.031],[21.675,-78.525],[6.502,-70.655],[28.177,-79.029],[12.138,-70.183],[34.679,-79.627],[17.773,-69.622],[41.182,-80.309],[23.409,-68.982],[47.684,-81.063],[29.044,-68.275],[54.187,-81.877],[34.679,-67.512],[60.689,-82.736],[40.315,-66.707],[67.191,-83.626],[45.95,-65.873],[73.694,-84.531],[51.586,-65.024],[59.373,-16.435],[61.482,-12.35],[64.361,-8.581],[67.939,-5.218],[72.129,-2.347],[76.827,-0.037],[81.917,1.655],[87.275,2.688],[92.768,3.034],[98.26,2.688],[103.618,1.655],[108.709,-0.037],[113.406,-2.347],[117.596,-5.218],[121.175,-8.581],[124.053,-12.35],[126.162,-16.435]],"rot":0}},
    {"templateId":"oneplan:scale:tent","name":"X 大帐","color":"#f2f2f2","placement":{"kind":"single","x":-16.906,"y":13.005,"rot":0}},
    {"templateId":"oneplan:scale:pop-up-tent","name":"蓝小棚","color":"#2b5fd9","placement":{"kind":"single","x":-16.906,"y":0.433,"rot":0}},
    {"templateId":"oneplan:icon:first-aid-point","name":"急救点","color":"#3fb544","placement":{"kind":"single","x":95.369,"y":15.606,"rot":0}},
  ],
  routes: [
    {"name":"人流 · 南北穿越","kind":"pedestrian","carrier":"walk","oneWay":true,"widthM":3,"color":"#f2c744","points":[[-152.156,32.512],[-136.55,-14.739],[-144.353,-16.473],[-151.723,32.079]]},
    {"name":"车行 · 北街绕行","kind":"vehicle","carrier":"vehicle","oneWay":true,"widthM":4,"points":[[11.704,41.182],[126.147,42.049]]},
  ],
  nodes: [
    {"name":"南入口","kind":"both","x":11.704,"y":41.182},
    {"name":"北口","kind":"exit","x":-144.353,"y":-16.473},
  ],
  confirmedView: {"lng":-103.860881,"lat":44.483188,"zoom":17.5,"rotationDeg":281},
  rotationDeg: 79,
};

export const RIVERSIDE_FESTIVAL_QC: ReplicaCaseSpec = {
  slug: "riverside-festival",
  title: "Riverside Festival",
  category: "Festivals",
  region: "North America",
  refImage: "riverside-festival.png",
  refLink: "https://www.oneplan.io/inspiration/riverside-festival/",
  anchor: {"lng":-75.707312,"lat":45.428976},
  locationNote: "2026-11-18 按原图逐块描绘；沿用用户右侧已确认位置 / 92° / z19，未重新配准。比例 0.033495 m/px；设施占地为模板估计，非现场实测。",
  zones: [
    {"name":"Gate Yard 门区","semantic":"checkin","color":"#d0d0d0","opacity":0.2,"polygon":[[-22.38,5.316],[-19.55,5.488],[-19.036,4.716],[-22.38,3.859]]},
    {"name":"Truck Row 工作车列","semantic":"loading","color":"#8a8f96","opacity":0.3,"polygon":[[-30.011,-12.347],[-27.267,-9.089],[-25.209,-10.718],[-28.039,-15.606]]},
    {"name":"Production Yard 制作场","semantic":"reserved","color":"#f2f2f2","opacity":0.25,"polygon":[[20.751,10.204],[26.067,10.804],[26.924,4.973],[21.093,4.202]]},
  ],
  facilities: [
    {"templateId":"oneplan:scale:bus","name":"工作大巴","color":"#5b6470","placement":{"kind":"scatter","at":[[-25.381,3.344],[-25.895,-4.545],[-28.039,-12.519],[-16.206,-10.975]],"rot":100}},
    {"templateId":"oneplan:scale:tent","name":"TL50 工作棚","color":"#f2f2f2","placement":{"kind":"single","x":-13.205,"y":10.118,"rot":0}},
    {"templateId":"oneplan:scale:food-trailer","name":"工作拖车","color":"#5b6470","placement":{"kind":"scatter","at":[[23.409,7.374],[23.409,-0.6],[-25.381,11.576],[-11.833,-4.202]],"rot":0}},
    {"templateId":"oneplan:icon:wifi","name":"通讯点","color":"#e87ab8","placement":{"kind":"scatter","at":[[-17.235,12.004],[-28.553,4.459]],"rot":0}},
    {"templateId":"oneplan:icon:bollard","name":"红桩","color":"#d93a2b","placement":{"kind":"scatter","at":[[-32.155,19.979],[-29.925,17.406],[-27.353,19.293],[-13.548,14.405],[-8.746,10.804],[-12.004,6.431],[-16.978,9.432],[19.636,10.718],[20.322,3.687],[26.667,11.147],[27.181,11.576],[26.838,3.944]],"rot":0}},
    {"templateId":"oneplan:icon:stanchion","name":"隔离柱","color":"#2b5fd9","placement":{"kind":"scatter","at":[[-19.55,5.402],[-14.234,0.686]],"rot":0}},
    {"templateId":"oneplan:scale:picnic-table","name":"木凳排","color":"#a06a3a","placement":{"kind":"scatter","at":[[-4.973,-15.006],[-1.029,-16.377],[-0.6,-12.347],[3.344,-17.749],[7.631,-18.007],[7.717,-13.376],[7.631,-9.432],[3.687,-9.003],[7.803,-5.145]],"rot":15}},
  ],
  routes: [
    {"name":"车行 · 工作车进场","kind":"vehicle","carrier":"vehicle","oneWay":true,"widthM":4,"points":[[-26.753,6.86],[-22.98,5.745],[-16.292,5.488],[-14.92,3.43],[-13.205,-1.372]]},
    {"name":"人流 · 门区通道","kind":"pedestrian","carrier":"walk","oneWay":true,"widthM":3,"color":"#f2c744","points":[[7.546,16.978],[18.435,18.007]]},
  ],
  nodes: [
    {"name":"车道口","kind":"entry","x":-26.753,"y":6.86},
    {"name":"步道口","kind":"both","x":-13.205,"y":-1.372},
  ],
  confirmedView: {"lng":-75.707312,"lat":45.428976,"zoom":19,"rotationDeg":92},
  rotationDeg: 268,
};

export const NATIONAL_CHERRY_FESTIVAL: ReplicaCaseSpec = {
  slug: "national-cherry-festival",
  title: "National Cherry Festival",
  category: "Festivals",
  region: "North America",
  refImage: "national-cherry-festival.png",
  refLink: "https://www.oneplan.io/inspiration/national-cherry-festival/",
  anchor: {"lng":-85.623846,"lat":44.766403},
  rotationDeg: 11,
  locationNote: "2026-11-18 按原图逐块描绘；沿用用户右侧已确认位置 / 349° / z17.25，未重新配准。比例 0.171236 m/px；设施占地为模板估计，非现场实测。",
  zones: [
    {"name":"Pier Lawn 突堤草坪","semantic":"audience","color":"#e07b30","opacity":0.15,"polygon":[[-32.439,72.33],[-24.11,72.33],[-24.11,75.4],[-14.028,84.166],[5.699,81.097],[15.781,81.974],[26.302,85.481],[35.069,76.275],[36.384,66.631],[30.247,61.809],[36.823,54.357],[34.631,32.877],[32.001,27.617],[-21.041,17.096],[-31.562,23.233]]},
    {"name":"Center Lawn 中草坪","semantic":"audience","color":"#e07b30","opacity":0.15,"polygon":[[-24.987,-13.589],[38.138,-11.836],[45.59,-29.37],[34.631,-83.289],[-24.548,-86.796]]},
    {"name":"Marina Lawn 游艇草坪","semantic":"reserved","color":"#e07b30","opacity":0.12,"polygon":[[120.112,-9.205],[206.469,-14.466],[206.469,-80.659],[136.331,-85.481],[115.29,-42.521]]},
    {"name":"Old Town 西园区","semantic":"reserved","color":"#e07b30","opacity":0.12,"polygon":[[-157.811,-91.18],[-146.852,-35.946],[-96.002,-7.014],[-70.577,-6.575],[-39.453,-9.205],[-30.247,-19.288],[-32.877,-89.426]]},
    {"name":"VIP 台","semantic":"vip","color":"#b3628c","opacity":0.3,"polygon":[[28.932,27.179],[34.631,27.617],[39.891,17.973],[34.631,-1.315],[39.014,-7.452],[37.699,-9.644],[32.001,-6.575],[28.494,-0.877]]},
    {"name":"Main Stage 主舞台","semantic":"stage","color":"#2b5fd9","opacity":0.4,"polygon":[[-123.18,-49.974],[-115.29,-48.658],[-113.098,-60.494],[-120.112,-62.686]]},
  ],
  facilities: [
    {"templateId":"oneplan:scale:pop-up-tent","name":"突堤白帐","color":"#f2f2f2","placement":{"kind":"scatter","at":[[-28.494,85.043],[-23.672,85.043],[-19.288,85.481],[-14.904,85.481],[-10.521,85.481],[-27.179,88.55],[-22.357,88.55],[-17.973,88.55],[-13.151,88.55],[-8.767,88.55]],"rot":0}},
    {"templateId":"oneplan:scale:stretch-tent","name":"X 大白帐","color":"#f2f2f2","placement":{"kind":"scatter","at":[[-4.822,44.275],[-54.357,-8.329],[14.028,-17.096],[35.069,-35.946],[-139.4,-85.481],[-67.946,-88.111]],"rot":0}},
    {"templateId":"booth-2x2","name":"蓝摊排","color":"#2b5fd9","placement":{"kind":"scatter","at":[[-19.726,-32.439],[-12.274,-32.877],[-15.343,-60.056]],"rot":0}},
    {"templateId":"oneplan:scale:picnic-table","name":"野餐桌","color":"#a06a3a","placement":{"kind":"scatter","at":[[13.589,-56.549],[16.877,-56.549],[20.165,-56.549],[23.452,-56.549],[26.74,-56.549],[30.028,-56.549],[10.959,-60.494],[14.247,-60.494],[17.535,-60.494],[20.822,-60.494],[24.11,-60.494],[27.398,-60.494]],"rot":0}},
    {"templateId":"food-truck-6x2.5","name":"红餐车","color":"#c0392b","placement":{"kind":"scatter","at":[[-33.754,-36.823],[-33.754,-42.083],[-33.754,-47.782],[-33.754,-53.919],[-33.754,-59.618],[-33.754,-65.755]],"rot":0}},
    {"templateId":"oneplan:scale:tent","name":"红长棚","color":"#c0392b","placement":{"kind":"scatter","at":[[-138.085,-36.823],[-125.809,-29.37],[-120.112,-89.865]],"rot":0}},
    {"templateId":"oneplan:scale:stage","name":"蓝舞台","color":"#2b5fd9","placement":{"kind":"single","x":-117.482,"y":-55.672,"rot":0}},
    {"templateId":"oneplan:scale:portable-toilet","name":"移动洗手间","color":"#2b5fd9","placement":{"kind":"scatter","at":[[-7.891,7.452],[-3.069,8.767],[1.753,10.959],[7.452,11.836],[12.713,14.028],[-8.329,13.151],[-3.069,14.028],[2.63,15.781],[7.891,17.535],[12.274,18.85]],"rot":90}},
    {"templateId":"trash-point-1.2x1.2","name":"垃圾点","color":"#f2d024","placement":{"kind":"scatter","at":[[-21.041,-85.481],[18.85,-86.796]],"rot":0}},
  ],
  routes: [
    {"name":"人流 · 西园→中草坪→突堤","kind":"pedestrian","carrier":"walk","oneWay":true,"widthM":3,"color":"#f2c744","points":[[-147.29,-99.947],[43.836,-96.002]]},
    {"name":"人流 · 街东→游艇草坪","kind":"pedestrian","carrier":"walk","oneWay":true,"widthM":3,"color":"#2b5fd9","points":[[-32.001,-8.767],[-19.288,-6.137],[29.37,-10.521],[39.453,-7.014]]},
  ],
  nodes: [
    {"name":"西园口","kind":"both","x":-147.29,"y":-99.947},
    {"name":"东街口","kind":"both","x":-32.001,"y":-8.767},
  ],
  confirmedView: {"lng":-85.623846,"lat":44.766403,"zoom":17.25,"rotationDeg":349},
};

export const ASHFIELD_DAY: ReplicaCaseSpec = {
  slug: "ashfield-day",
  title: "Ashfield Day",
  category: "Festivals",
  region: "Europe",
  refImage: "ashfield-day.png",
  refLink: "https://www.oneplan.io/inspiration/ashfield-day/",
  anchor: {"lng":-1.250511,"lat":53.124699},
  rotationDeg: 354,
  locationNote: "2026-11-18 按原图逐块描绘；沿用用户右侧已确认位置 / 6° / z16.5，未重新配准。比例 0.263896 m/px；设施占地为模板估计，非现场实测。",
  zones: [
    {"name":"Fun For All Zone 全龄游乐区","semantic":"audience","color":"#f2d024","opacity":0.25,"polygon":[[-256.718,50.668],[-137.142,52.019],[-109.443,-22.294],[-155.382,-70.935],[-174.298,-108.767],[-218.886,-108.092],[-231.722,-41.886]]},
    {"name":"Entertainment Zone 演出区","semantic":"stage","color":"#2b5fd9","opacity":0.25,"polygon":[[-116.874,-49.992],[35.805,46.615],[64.855,2.702],[60.802,-40.534],[64.855,-58.775],[24.321,-107.416],[-60.126,-81.069]]},
    {"name":"Green Zone 绿区","semantic":"reserved","color":"#3fb544","opacity":0.25,"polygon":[[-79.042,49.992],[-18.24,52.019],[24.321,54.046],[-64.18,0.676]]},
    {"name":"Skate Zone 轮滑区","semantic":"audience","color":"#a8d8e8","opacity":0.3,"polygon":[[144.573,96.607],[191.187,124.981],[228.344,117.55],[233.073,95.256],[203.348,74.313],[186.458,81.069],[164.164,74.313]]},
    {"name":"Xtreme Bike 极限单车区","semantic":"reserved","color":"#c0392b","opacity":0.25,"polygon":[[89.851,32.428],[130.386,79.043],[157.409,59.451],[165.516,47.29],[111.47,2.702]]},
    {"name":"Fun Fair 游乐区（粉）","semantic":"reserved","color":"#ec5fa8","opacity":0.25,"polygon":[[-214.157,102.687],[-170.92,102.012],[-170.92,71.611],[-214.833,71.611]]},
    {"name":"Water Safety 水上安全","semantic":"medical","color":"#3aa08c","opacity":0.3,"polygon":[[64.855,-16.214],[91.202,-16.889],[93.905,-51.344],[69.584,-52.695]]},
    {"name":"Heliweb 停机坪","semantic":"loading","color":"#e07b30","opacity":0.3,"polygon":[[119.577,-119.577],[149.977,-117.55],[152.004,-140.519],[120.928,-141.871]]},
  ],
  facilities: [
    {"templateId":"oneplan:scale:market-stall","name":"粉摊","color":"#ec5fa8","placement":{"kind":"scatter","at":[[-227.668,-12.16],[-224.966,-21.618],[-222.264,-32.428],[-161.462,13.511],[-182.405,31.752],[-162.138,37.832],[-120.252,-11.485]],"rot":0}},
    {"templateId":"oneplan:icon:carnival","name":"游乐设施","color":"#e07b30","placement":{"kind":"scatter","at":[[-139.168,27.023],[-129.71,6.08],[-176.325,21.618],[-147.275,8.107],[-138.493,-8.106]],"rot":0}},
    {"templateId":"oneplan:scale:stage","name":"白棚舞台","color":"#f2f2f2","placement":{"kind":"scatter","at":[[-61.477,28.374],[-32.428,-69.584]],"rot":0}},
    {"templateId":"oneplan:icon:themepark","name":"摩天轮","color":"#e8b838","placement":{"kind":"single","x":-129.71,"y":4.729,"rot":0}},
    {"templateId":"oneplan:icon:bouncy-castle","name":"充气堡","color":"#ec5fa8","placement":{"kind":"single","x":-34.454,"y":35.13,"rot":0}},
    {"templateId":"oneplan:icon:first-aid-point","name":"急救点","color":"#d93a2b","placement":{"kind":"scatter","at":[[41.21,12.836],[-90.527,-11.485],[37.157,29.05]],"rot":0}},
    {"templateId":"oneplan:icon:information-point","name":"信息点","color":"#3fb544","placement":{"kind":"scatter","at":[[-215.508,20.942],[8.107,-79.042]],"rot":0}},
  ],
  routes: [
    {"name":"人流 · 大门→游乐区→演出区","kind":"pedestrian","carrier":"walk","oneWay":true,"widthM":3,"color":"#f2c744","points":[[-255.367,54.046],[-135.79,53.37],[-101.336,-24.996],[30.401,52.019],[181.729,131.061],[195.241,132.413],[257.394,118.225],[274.959,122.279],[304.684,152.004]]},
    {"name":"人流 · 分流线（蓝）","kind":"pedestrian","carrier":"walk","oneWay":false,"widthM":3,"color":"#35c4e0","points":[[-184.432,-158.76],[-171.596,-116.874],[-152.004,-77.015],[-109.443,-28.374],[27.023,52.019],[33.779,47.29]]},
  ],
  nodes: [
    {"name":"主入口","kind":"both","x":-255.367,"y":54.046},
    {"name":"西侧步道口","kind":"both","x":30.401,"y":52.019},
  ],
  confirmedView: {"lng":-1.250511,"lat":53.124699,"zoom":16.5,"rotationDeg":6},
};

export const SPILTROCK_SUMMERJAM: ReplicaCaseSpec = {
  slug: "spiltrock-summerjam",
  title: "Spiltrock Summerjam",
  category: "Festivals",
  region: "North America",
  refImage: "spiltrock-summerjam.png",
  refLink: "https://www.oneplan.io/inspiration/spiltrock-summerjam/",
  anchor: {"lng":-117.273859,"lat":33.426144},
  locationNote: "2026-11-18 按原图逐块描绘；沿用用户右侧已确认位置 / 37° / z17.25，未重新配准。比例 0.203200 m/px；设施占地为模板估计，非现场实测。",
  zones: [
    {"name":"West Pines Parking","semantic":"parking","color":"#3fb544","opacity":0.25,"polygon":[[-29.651,72.827],[-8.323,92.074],[17.166,110.801],[35.893,102.478],[50.459,95.715],[48.898,70.226],[28.611,69.186],[3.641,54.1],[-10.404,63.984]]},
    {"name":"Private Parking Day Passes","semantic":"parking","color":"#f2d024","opacity":0.25,"polygon":[[14.565,42.656],[29.131,67.105],[49.938,70.226],[78.549,69.186],[70.746,47.858],[28.09,-2.081],[18.207,6.762]]},
    {"name":"West Parking Weekend","semantic":"parking","color":"#3fb544","opacity":0.25,"polygon":[[-118.084,7.283],[-81.15,26.53],[-71.266,15.606],[-47.858,1.561],[-71.266,-14.045],[-82.711,-19.247],[-105.079,-28.09]]},
    {"name":"Boulders Parking","semantic":"parking","color":"#3fb544","opacity":0.25,"polygon":[[-82.19,-21.328],[-47.858,-2.081],[-5.202,-23.929],[-18.727,-33.292],[-37.974,-33.292],[-41.095,-45.257],[-71.266,-34.333]]},
    {"name":"RockTan Parking","semantic":"parking","color":"#3fb544","opacity":0.25,"polygon":[[-157.098,-38.494],[-84.791,-22.888],[-81.15,-67.625],[-102.998,-85.311],[-122.245,-88.433],[-137.851,-85.832],[-138.891,-59.302]]},
    {"name":"Peaceful Valley Weekend","semantic":"parking","color":"#3fb544","opacity":0.25,"polygon":[[93.114,-29.131],[106.119,-29.131],[116.523,-45.257],[138.891,-39.535],[147.735,-40.055],[168.022,-58.782],[182.067,-37.974],[195.592,-81.15],[161.78,-71.266],[118.084,-59.302],[106.119,-47.337]]},
    {"name":"Central Camp 中央营","semantic":"reserved","color":"#b362c9","opacity":0.35,"polygon":[[-60.862,33.812],[-50.459,55.14],[-26.53,62.423],[-10.924,60.342],[4.162,50.979],[12.485,29.651],[10.404,9.363],[-5.722,-0.52],[-26.01,-6.762],[-46.297,6.762]]},
    {"name":"General Camping Tender 通用营","semantic":"reserved","color":"#c8894a","opacity":0.3,"polygon":[[-11.964,-59.822],[10.924,-47.858],[33.812,-58.262],[109.24,-57.741],[112.882,-83.751],[95.715,-99.357],[77.509,-112.361],[54.1,-98.836],[33.292,-87.392],[11.964,-88.953]]},
  ],
  facilities: [
    {"templateId":"oneplan:icon:feather-flag","name":"旗标","color":"#ec5fa8","placement":{"kind":"scatter","at":[[-81.15,35.893],[-67.625,45.777],[-50.459,56.181],[-25.489,79.589],[-9.884,96.236],[3.121,107.16],[76.468,74.908],[93.635,-12.485],[111.841,-15.606],[178.946,-35.373],[147.735,-69.706],[-3.121,-47.337],[12.485,-35.373],[-5.202,2.081],[-16.646,0]],"rot":0}},
    {"templateId":"oneplan:icon:information-point","name":"服务点","color":"#2b5fd9","placement":{"kind":"scatter","at":[[-3.641,26.53],[-20.287,3.641],[-57.221,19.767]],"rot":0}},
  ],
  routes: [
    {"name":"车行 · 黄土路主线","kind":"vehicle","carrier":"vehicle","oneWay":true,"widthM":4,"color":"#f2d024","points":[[-188.31,-56.701],[-148.255,-7.283],[-98.836,20.808],[-50.459,55.661],[-5.202,100.917],[17.687,110.801]]},
    {"name":"人流 · 营区连线","kind":"pedestrian","carrier":"walk","oneWay":false,"widthM":3,"color":"#f2d024","points":[[28.09,-2.081],[18.207,-37.974],[-23.929,-75.428],[-41.615,-89.473]]},
  ],
  nodes: [
    {"name":"西口","kind":"entry","x":-188.31,"y":-56.701},
    {"name":"营口","kind":"both","x":17.687,"y":110.801},
  ],
  confirmedView: {"lng":-117.273859,"lat":33.426144,"zoom":17.25,"rotationDeg":37},
  rotationDeg: 323,
};

export const START_ON_THE_STREET: ReplicaCaseSpec = {
  slug: "start-on-the-street",
  title: "stART on the Street",
  category: "Festivals",
  region: "North America",
  refImage: "start-on-the-street.png",
  refLink: "https://www.oneplan.io/inspiration/start-on-the-street/",
  anchor: {"lng":-71.817042,"lat":42.268872},
  locationNote: "2026-11-18 按原图逐块描绘；沿用用户右侧已确认位置 / 74° / z18.5，未重新配准。比例 0.103673 m/px；设施占地为模板估计，非现场实测。",
  zones: [
    {"name":"Food Truck Court 餐车广场","semantic":"reserved","color":"#c8894a","opacity":0.3,"polygon":[[39.545,16.72],[98.996,12.209],[97.934,-5.308],[35.033,0]]},
    {"name":"Shop Parking 商户停车","semantic":"parking","color":"#b362c9","opacity":0.3,"polygon":[[109.877,-5.573],[112.266,10.351],[123.678,8.228],[120.493,-8.228]]},
    {"name":"Booth Row East 东摊带","semantic":"reserved","color":"#3fb544","opacity":0.25,"polygon":[[-59.981,1.592],[-24.683,7.431],[-23.886,-0.265],[-59.185,-4.512]]},
    {"name":"Booth Row West 西摊带","semantic":"reserved","color":"#ec5fa8","opacity":0.25,"polygon":[[-15.924,9.024],[19.109,12.209],[19.64,4.512],[-15.393,1.858]]},
  ],
  facilities: [
    {"templateId":"booth-2x2","name":"绿摊","color":"#3fb544","placement":{"kind":"scatter","at":[[-58.654,0.265],[-55.018,0.796],[-51.382,1.327],[-47.746,1.858],[-44.11,2.389],[-40.474,2.919],[-36.838,3.45],[-33.202,3.981],[-29.566,4.512],[-25.93,5.043],[-14.863,7.431],[-11.2,7.723],[-7.537,8.015],[-3.875,8.307],[-0.212,8.599],[3.45,8.891],[7.113,9.183],[10.775,9.475],[14.438,9.767],[18.101,10.059]],"rot":0}},
    {"templateId":"booth-2x2","name":"粉摊","color":"#ec5fa8","placement":{"kind":"scatter","at":[[-58.654,-3.716],[-55.018,-3.185],[-51.382,-2.654],[-47.746,-2.123],[-44.11,-1.592],[-40.474,-1.062],[-36.838,-0.531],[-33.202,0],[-29.566,0.531],[-25.93,1.062],[-14.863,3.45],[-11.2,3.742],[-7.537,4.034],[-3.875,4.326],[-0.212,4.618],[3.45,4.91],[7.113,5.202],[10.775,5.494],[14.438,5.786],[18.101,6.078]],"rot":0}},
    {"templateId":"booth-2x2","name":"西绿大帐","color":"#3fb544","placement":{"kind":"single","x":-100.854,"y":-4.777,"rot":0}},
    {"templateId":"booth-2x2","name":"西粉大帐","color":"#ec5fa8","placement":{"kind":"single","x":-100.854,"y":-7.962,"rot":0}},
    {"templateId":"oneplan:scale:round-table-and-chairs","name":"圆桌座","color":"#f2d024","placement":{"kind":"scatter","at":[[44.853,6.901],[54.673,6.901],[64.493,6.901],[74.313,6.901],[84.133,6.901],[93.953,6.901],[49.896,9.82],[59.716,9.82],[69.536,9.82],[79.356,9.82],[89.176,9.82],[48.038,2.919],[58.389,2.919],[68.74,2.919],[79.09,2.919],[89.441,2.919]],"rot":0}},
    {"templateId":"oneplan:scale:bus","name":"蓝食巴","color":"#2b5fd9","placement":{"kind":"single","x":109.612,"y":3.716,"rot":0}},
  ],
  routes: [
    {"name":"人流 · 街道主动线","kind":"pedestrian","carrier":"walk","oneWay":true,"widthM":3,"color":"#f2c744","points":[[-135.356,-7.697],[-120.759,-6.901],[-83.337,-4.512],[-67.147,-3.716],[-22.825,3.716],[23.09,8.493],[97.934,3.981]]},
    {"name":"人流 · 餐车广场环","kind":"pedestrian","carrier":"walk","oneWay":false,"widthM":3,"color":"#e07b30","points":[[-50.427,11.147],[-31.052,12.739],[-7.697,16.455],[26.54,19.64],[33.441,23.886],[43.526,33.441],[58.92,42.465],[69.27,53.081]]},
  ],
  nodes: [
    {"name":"西门","kind":"both","x":-135.356,"y":-7.697},
    {"name":"东门","kind":"both","x":97.934,"y":3.981},
  ],
  confirmedView: {"lng":-71.817042,"lat":42.268872,"zoom":18.5,"rotationDeg":74},
  rotationDeg: 286,
};

export const HALLOWEEN_FIREWORK_SPOOKTACULAR: ReplicaCaseSpec = {
  slug: "halloween-firework-spooktacular",
  title: "Halloween Firework Spooktacular",
  category: "Festivals",
  region: "Europe",
  refImage: "halloween-firework-spooktacular.png",
  refLink: "https://www.oneplan.io/inspiration/halloween-firework-spooktacular/",
  anchor: {"lng":-1.181921,"lat":53.95156},
  locationNote: "2026-11-18 按原图逐块描绘；沿用用户右侧已确认位置 / 348° / z16，未重新配准。比例 0.458346 m/px；设施占地为模板估计，非现场实测。",
  zones: [
    {"name":"Runway Parking 跑道停车","semantic":"parking","color":"#c0392b","opacity":0.35,"polygon":[[149.017,-114.99],[386.037,201.819],[421.238,178.352],[205.339,-117.337]]},
    {"name":"Compound 制作围场","semantic":"reserved","color":"#ec5fa8","opacity":0.3,"polygon":[[-64.535,-78.615],[3.52,-79.789],[3.52,-119.683],[-73.922,-122.03],[-71.575,-102.083],[-65.708,-100.909]]},
    {"name":"Crowd Wedge A 观演楔 A","semantic":"audience","color":"#7fd0e8","opacity":0.3,"polygon":[[65.708,205.339],[-4.693,132.59],[-68.055,95.043],[-61.015,85.656],[2.347,124.377],[79.789,208.859]]},
    {"name":"Crowd Wedge B 观演楔 B","semantic":"audience","color":"#7fd0e8","opacity":0.3,"polygon":[[-71.575,188.912],[-56.322,180.698],[-34.028,205.339],[-9.387,188.912],[-57.495,152.538],[-75.095,171.311]]},
    {"name":"Grass Field 草场停车","semantic":"parking","color":"#f2d024","opacity":0.3,"polygon":[[-424.758,-73.922],[-66.882,-73.922],[-65.708,-100.909],[-73.922,-103.256],[-73.922,-120.857],[-423.585,-124.377]]},
    {"name":"Fireworks 发射区","semantic":"reserved","color":"#e07b30","opacity":0.3,"polygon":[[-143.151,-222.939],[-85.656,-225.286],[-88.002,-245.233],[-143.151,-242.887]]},
  ],
  facilities: [
    {"templateId":"oneplan:scale:portable-toilet","name":"移动洗手间","color":"#7fd0e8","placement":{"kind":"scatter","at":[[-52.801,-83.309],[-46.935,-83.309],[-41.068,-83.309],[-35.201,-83.309],[-28.161,-83.309]],"rot":90}},
    {"templateId":"food-truck-6x2.5","name":"餐车","color":"#e07b30","placement":{"kind":"scatter","at":[[19.947,-118.51],[28.161,-118.51],[34.028,-118.51],[39.894,-118.51],[48.108,-118.51]],"rot":0}},
    {"templateId":"oneplan:scale:pop-up-tent","name":"橙棚","color":"#e07b30","placement":{"kind":"scatter","at":[[75.095,-78.615],[89.176,-78.615],[102.083,-78.615],[118.51,-78.615]],"rot":0}},
    {"templateId":"oneplan:icon:feather-flag","name":"黄旗","color":"#f2d024","placement":{"kind":"scatter","at":[[17.6,-83.309],[28.161,-83.309],[38.721,-83.309],[50.455,-83.309],[17.6,-93.869],[28.161,-93.869],[38.721,-93.869],[50.455,-93.869]],"rot":0}},
  ],
  routes: [
    {"name":"人流 · 跑道→观演楔","kind":"pedestrian","carrier":"walk","oneWay":true,"widthM":3,"color":"#2b5fd9","points":[[-44.588,14.08],[-7.04,-71.575],[-64.535,-71.575],[-64.535,-86.829]]},
    {"name":"车行 · 草场停车进出","kind":"vehicle","carrier":"vehicle","oneWay":true,"widthM":4,"points":[[-424.758,-120.857],[-72.749,-120.857],[-64.535,-99.736],[0,-99.736],[0,-95.043],[123.203,-93.869]]},
  ],
  nodes: [
    {"name":"跑道口","kind":"both","x":-64.535,"y":-86.829},
    {"name":"草场口","kind":"entry","x":-424.758,"y":-120.857},
  ],
  confirmedView: {"lng":-1.181921,"lat":53.95156,"zoom":16,"rotationDeg":348},
  rotationDeg: 12,
};
