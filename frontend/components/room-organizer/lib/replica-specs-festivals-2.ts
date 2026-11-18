/**
 * OnePlan 复刻规格 · 节庆类第二批（4 案）。
 */

import type { ReplicaCaseSpec } from './replica-kit';


export const NEW_FOREST_FOLK_FESTIVAL: ReplicaCaseSpec = {
  slug: "new-forest-folk-festival",
  title: "New Forest Folk Festival",
  category: "Festivals",
  region: "Europe",
  refImage: "new-forest-folk-festival.png",
  refLink: "https://www.oneplan.io/inspiration/new-forest-folk-festival/",
  anchor: {"lng":-1.603453,"lat":50.976873},
  locationNote: "2026-11-18 按原图逐块描绘；沿用用户右侧已确认位置 / 262° / z16，未重新配准。比例 0.381000 m/px；设施占地为模板估计，非现场实测。",
  zones: [
    {"name":"Day Parking 日间停车","semantic":"parking","color":"#7a4d9d","opacity":0.35,"polygon":[[-301.386,84.856],[-168.737,136.55],[-139.476,38.039],[-215.555,-27.31],[-268.224,25.359],[-287.731,50.719]]},
    {"name":"Camping Field 露营田","semantic":"reserved","color":"#a06a5a","opacity":0.35,"polygon":[[-118.994,33.162],[-0.975,73.152],[57.546,-76.078],[6.828,-85.832],[-51.694,-92.659],[-86.807,-74.127]]},
    {"name":"Accessible Camping 无障碍营","semantic":"reserved","color":"#3aa08c","opacity":0.4,"polygon":[[-0.975,73.152],[39.014,76.078],[89.733,-63.398],[57.546,-76.078]]},
    {"name":"Caravan Field 房车田","semantic":"parking","color":"#f2d024","opacity":0.35,"polygon":[[39.014,74.127],[108.265,86.807],[122.895,75.103],[135.575,-69.251],[89.733,-72.177]]},
    {"name":"North Field 北田","semantic":"reserved","color":"#2b5fd9","opacity":0.25,"polygon":[[-167.762,136.55],[-3.901,185.318],[52.669,121.92],[14.63,96.561],[10.729,86.807],[-40.965,75.103],[-87.782,66.324],[-118.019,57.546],[-139.476,37.064]]},
    {"name":"Artists & Helpers Compound 艺人营","semantic":"reserved","color":"#c0392b","opacity":0.3,"polygon":[[-26.335,-127.772],[2.926,-121.92],[11.704,-109.24],[39.014,-114.117],[49.743,-98.511],[79.004,-91.684],[90.708,-86.807],[111.191,-87.782],[132.649,-80.955],[147.279,-94.61],[158.008,-82.906],[176.54,-84.856],[169.713,-133.624],[163.86,-170.688],[118.019,-183.368],[64.374,-179.466],[6.828,-190.195],[-27.31,-194.097]]},
    {"name":"Stage Field 舞台田","semantic":"stage","color":"#9a8a4a","opacity":0.4,"polygon":[[122.895,71.201],[184.343,85.832],[226.284,77.053],[242.865,69.251],[250.668,49.743],[243.84,18.532],[217.505,-12.68],[196.047,-40.965],[177.516,-74.127],[135.575,-69.251]]},
  ],
  facilities: [
    {"templateId":"stage-platform-8x6","name":"Stage 舞台","placement":{"kind":"single","x":215.555,"y":12.68,"rot":0}},
    {"templateId":"oneplan:scale:tent","name":"蓝棚","color":"#2b5fd9","placement":{"kind":"single","x":200.924,"y":0,"rot":0}},
    {"templateId":"oneplan:scale:pop-up-tent","name":"绿小棚","color":"#3fb544","placement":{"kind":"single","x":156.058,"y":-34.138,"rot":0}},
    {"templateId":"oneplan:scale:portable-toilet","name":"移动洗手间","placement":{"kind":"scatter","at":[[-106.314,63.398],[-59.497,70.226],[-50.719,72.177],[-39.99,74.127],[-31.212,77.053],[-21.458,79.004],[-10.729,80.955]],"rot":90}},
    {"templateId":"oneplan:scale:accessible-portable-toilet","name":"无障碍厕位","placement":{"kind":"scatter","at":[[-124.846,44.867],[-118.994,52.669]],"rot":0}},
    {"templateId":"oneplan:scale:water-refill-station","name":"加水点","placement":{"kind":"scatter","at":[[136.55,71.201],[174.589,33.162],[77.053,59.497]],"rot":0}},
  ],
  routes: [
    {"name":"人流 · 农场门→舞台田→露营田","kind":"pedestrian","carrier":"walk","oneWay":true,"widthM":3,"color":"#f2c744","points":[[-283.83,-152.156],[-254.569,-79.98],[-211.653,-24.384],[-174.589,0],[-131.674,39.014],[-104.364,61.448],[-25.359,74.127],[15.606,83.881]]},
    {"name":"车行 · 房车田进出","kind":"vehicle","carrier":"vehicle","oneWay":false,"widthM":4,"points":[[425.257,56.571],[367.711,57.546],[338.45,32.187],[296.509,21.458],[245.791,11.704],[207.752,-33.162],[172.639,-77.053]]},
  ],
  nodes: [
    {"name":"农场步道门","kind":"both","x":-283.83,"y":-152.156},
    {"name":"房车田口","kind":"entry","x":425.257,"y":56.571},
  ],
  confirmedView: {"lng":-1.603453,"lat":50.976873,"zoom":16,"rotationDeg":262},
  rotationDeg: 98,
};

export const MUGSTOCK: ReplicaCaseSpec = {
  slug: "mugstock",
  title: "MugStock",
  category: "Festivals",
  region: "Europe",
  refImage: "mugstock.png",
  refLink: "https://www.oneplan.io/inspiration/mugstock/",
  anchor: {"lng":-3.745054,"lat":56.320648},
  locationNote: "2026-11-18 按原图逐块描绘；沿用用户右侧已确认位置 / 0° / z15.25，未重新配准。比例 0.648511 m/px；设施占地为模板估计，非现场实测。",
  zones: [
    {"name":"Arena 主场","semantic":"stage","color":"#3fb544","opacity":0.3,"polygon":[[-122.854,41.505],[-28.223,38.184],[-14.942,-6.641],[-102.932,-11.621]]},
    {"name":"Red Field 红田","semantic":"reserved","color":"#c0392b","opacity":0.3,"polygon":[[-68.068,146.096],[-43.165,166.019],[69.728,111.233],[64.747,78.029],[-1.66,74.708]]},
    {"name":"Big Field 大田","semantic":"reserved","color":"#a06a3a","opacity":0.3,"polygon":[[-79.689,300.494],[3.32,327.057],[101.271,232.426],[232.426,190.922],[229.106,169.339],[152.737,175.98],[109.572,134.475],[79.689,111.233],[8.301,136.135],[-39.844,180.96]]},
    {"name":"Purple Field 紫田","semantic":"reserved","color":"#b362c9","opacity":0.3,"polygon":[[244.048,124.514],[315.436,157.718],[391.804,53.126],[371.882,34.864],[295.513,11.621]]},
    {"name":"Yellow Field 黄田","semantic":"parking","color":"#f2d024","opacity":0.3,"polygon":[[315.436,154.397],[348.639,170.999],[411.726,107.912],[403.425,73.048],[393.464,51.466]]},
    {"name":"Teal Fields 青田","semantic":"reserved","color":"#3aa08c","opacity":0.3,"polygon":[[106.252,73.048],[234.086,124.514],[297.174,4.981],[205.863,-24.903],[146.096,-28.223]]},
    {"name":"Camping 白帐篷营","semantic":"reserved","color":"#e8e8f0","opacity":0.3,"polygon":[[-237.407,-182.621],[-209.184,-147.757],[-154.397,-106.252],[-112.893,-109.572],[-94.631,-134.475],[-129.495,-190.922],[-185.941,-240.727],[-244.048,-224.125]]},
    {"name":"South Parking 南停车","semantic":"parking","color":"#f2d024","opacity":0.25,"polygon":[[-71.388,-106.252],[-16.602,-94.631],[-39.844,-161.038],[-78.029,-187.601],[-92.97,-232.426],[-149.417,-275.591],[-174.32,-237.407],[-147.757,-187.601]]},
  ],
  facilities: [
    {"templateId":"oneplan:scale:pop-up-tent","name":"露营帐篷","color":"#f2f2f2","placement":{"kind":"scatter","at":[[-229.106,-214.164],[-225.785,-205.199],[-222.465,-196.234],[-219.145,-187.269],[-215.824,-178.304],[-212.504,-169.339],[-209.184,-160.374],[-205.863,-151.409]],"rot":0}},
    {"templateId":"oneplan:icon:camping","name":"营火点","color":"#c0392b","placement":{"kind":"scatter","at":[[-258.989,-267.29],[-189.261,-355.28]],"rot":0}},
    {"templateId":"oneplan:scale:market-stall","name":"摊位","color":"#e8b838","placement":{"kind":"scatter","at":[[-94.631,-21.582],[-84.67,-24.903],[-73.048,-29.883],[-56.446,-34.864]],"rot":0}},
    {"templateId":"food-truck-6x2.5","name":"餐车","placement":{"kind":"scatter","at":[[8.301,-76.369],[19.922,-83.009]],"rot":0}},
    {"templateId":"oneplan:icon:feather-flag","name":"彩旗","color":"#b362c9","placement":{"kind":"scatter","at":[[-132.815,-59.767],[-114.553,-64.747],[131.155,-11.621]],"rot":0}},
  ],
  routes: [
    {"name":"人流 · 主径（南门→营地→大田→主场）","kind":"pedestrian","carrier":"walk","oneWay":true,"widthM":3,"color":"#f2c744","points":[[-197.562,-142.776],[-179.3,-116.213],[-154.397,-89.65],[-132.815,-61.427],[-96.291,-58.107],[-64.747,-34.864],[-31.544,-28.223],[-18.262,-3.32],[-24.903,38.184],[-14.942,81.349],[9.961,137.796],[76.369,280.572]]},
    {"name":"人流 · 东门→紫田","kind":"pedestrian","carrier":"walk","oneWay":true,"widthM":3,"color":"#b362c9","points":[[-159.378,-287.212],[-94.631,-242.387],[-49.806,-169.339],[-13.281,-112.893],[33.204,-97.951]]},
  ],
  nodes: [
    {"name":"南门","kind":"both","x":-197.562,"y":-142.776},
    {"name":"东门","kind":"both","x":-159.378,"y":-287.212},
  ],
  confirmedView: {"lng":-3.745054,"lat":56.320648,"zoom":15.25,"rotationDeg":0},
  rotationDeg: 0,
};

export const PARKENFESTIVALEN: ReplicaCaseSpec = {
  slug: "parkenfestivalen-2023",
  title: "Parkenfestivalen",
  category: "Festivals",
  region: "Europe",
  refImage: "parkenfestivalen-2023.png",
  refLink: "https://www.oneplan.io/inspiration/parkenfestivalen-2023/",
  anchor: {"lng":14.401684,"lat":67.283781},
  rotationDeg: 327,
  locationNote: "2026-11-18 按原图逐块描绘；沿用用户右侧已确认位置 / 33° / z16，未重新配准。比例 0.241905 m/px；设施占地为模板估计，非现场实测。",
  zones: [
    {"name":"Festival Field 节庆场","semantic":"audience","color":"#3fb544","opacity":0.3,"polygon":[[-164.727,-54.496],[-58.831,19.817],[-54.496,37.776],[-65.024,47.065],[-14.243,90.414],[-24.152,94.749],[3.716,126.952],[39.634,120.759],[42.111,135.621],[42.111,113.947],[50.161,85.46],[114.566,68.12],[120.759,111.47],[138.099,100.323],[160.393,66.882],[143.053,50.161],[127.571,63.785],[62.547,77.41],[58.212,66.263],[97.226,29.725],[68.74,0],[53.877,8.051],[54.496,-16.72],[71.836,-52.019],[71.836,-125.713],[-21.055,-131.287],[-39.634,-117.043],[-77.41,-116.424],[-76.79,-97.226],[-123.236,-94.749],[-136.86,-73.075],[-162.25,-66.263]]},
    {"name":"Main Stage Area 主舞台区","semantic":"stage","color":"#a06a3a","opacity":0.4,"polygon":[[-12.386,90.414],[65.024,76.171],[49.542,51.4],[59.451,44.588],[55.735,34.679],[19.198,27.248],[15.482,43.969],[-11.766,42.111],[-14.863,69.359]]},
    {"name":"Backstage 后台","semantic":"reserved","color":"#2b5fd9","opacity":0.3,"polygon":[[6.193,78.029],[21.055,87.937],[30.345,85.46],[50.161,82.364],[48.923,60.07],[8.051,62.547]]},
    {"name":"Red Zone West 西红区","semantic":"reserved","color":"#d93a2b","opacity":0.3,"polygon":[[-118.282,-34.679],[-91.653,-18.578],[-81.125,-35.299],[-109.612,-52.019]]},
    {"name":"Red Zone South 南红区","semantic":"reserved","color":"#d93a2b","opacity":0.3,"polygon":[[-19.817,-85.46],[20.436,-85.46],[27.248,-92.272],[-11.147,-92.272],[-6.812,-105.896],[41.492,-105.896],[48.923,-112.708],[-8.051,-112.708]]},
    {"name":"Green Stage 东绿台","semantic":"stage","color":"#3fb544","opacity":0.4,"polygon":[[115.805,107.135],[136.86,99.703],[158.535,68.12],[144.291,58.831],[118.282,79.267]]},
  ],
  facilities: [
    {"templateId":"oneplan:scale:pop-up-tent","name":"绿棚","color":"#3fb544","placement":{"kind":"scatter","at":[[136.241,92.891],[140.576,88.556],[144.291,83.602],[147.388,77.41],[151.723,73.694]],"rot":90}},
    {"templateId":"oneplan:scale:tent","name":"粉 X 棚","color":"#e87ab8","placement":{"kind":"scatter","at":[[123.236,92.272],[-106.516,-105.896]],"rot":0}},
    {"templateId":"oneplan:scale:tent","name":"白棚","placement":{"kind":"scatter","at":[[-127.571,-50.781],[-131.287,-47.684],[-135.621,-44.588]],"rot":0}},
    {"templateId":"oneplan:icon:bar","name":"酒吧点","color":"#f2d024","placement":{"kind":"single","x":16.72,"y":0,"rot":0}},
    {"templateId":"oneplan:icon:first-aid-point","name":"急救点","color":"#d93a2b","placement":{"kind":"single","x":-4.954,"y":102.181,"rot":0}},
    {"templateId":"oneplan:scale:generator","name":"发电机","placement":{"kind":"single","x":54.496,"y":-22.913,"rot":0}},
    {"templateId":"oneplan:icon:cone","name":"路锥","placement":{"kind":"scatter","at":[[-57.593,49.542],[63.785,-62.547]],"rot":0}},
  ],
  routes: [
    {"name":"围栏 · 场地环线","kind":"pedestrian","carrier":"walk","oneWay":false,"widthM":2,"color":"#e07b30","points":[[-135.621,-71.836],[-74.932,-91.034],[-38.395,-95.369],[-29.106,-78.029],[-9.908,-66.882]]},
    {"name":"人流 · 入口→主舞台","kind":"pedestrian","carrier":"walk","oneWay":true,"widthM":3,"color":"#f2c744","points":[[120.759,110.85],[115.185,85.46],[53.877,78.648],[-13.624,91.034],[-58.831,49.542]]},
  ],
  nodes: [
    {"name":"南门","kind":"both","x":-135.621,"y":-71.836},
    {"name":"东门","kind":"both","x":120.759,"y":110.85},
  ],
  confirmedView: {"lng":14.401684,"lat":67.283781,"zoom":16,"rotationDeg":33},
};

export const RIVERBEND_MUSIC_FESTIVAL: ReplicaCaseSpec = {
  slug: "riverbend-music-festival",
  title: "Riverbend Music Festival",
  category: "Festivals",
  region: "North America",
  refImage: "riverbend-music-festival.png",
  refLink: "https://www.oneplan.io/inspiration/riverbend-music-festival/",
  anchor: {"lng":-85.313833,"lat":35.055926},
  rotationDeg: 357,
  locationNote: "2026-11-18 按原图逐块描绘；沿用用户右侧已确认位置 / 3° / z17，未重新配准。比例 0.259404 m/px；设施占地为模板估计，非现场实测。",
  zones: [
    {"name":"Site Park 场地园","semantic":"audience","color":"#e07b30","opacity":0.12,"polygon":[[-300.826,-119.533],[-244.38,-53.126],[-168.675,-30.547],[-176.644,34.532],[-62.423,51.798],[-55.782,44.493],[115.549,99.611],[116.213,120.198],[293.521,119.533],[295.513,66.407],[140.12,19.258],[137.464,-63.751],[58.439,-66.407],[19.922,-56.446],[-300.826,-119.533]]},
    {"name":"Artist Compound 艺人村","semantic":"reserved","color":"#c0392b","opacity":0.3,"polygon":[[-244.38,-47.813],[-170.003,-31.876],[-152.073,-88.986],[-229.106,-106.252]]},
    {"name":"Green Room 绿屋区","semantic":"reserved","color":"#3fb544","opacity":0.3,"polygon":[[-152.073,-28.555],[-92.306,-25.899],[-87.658,-65.079],[-141.448,-76.369]]},
    {"name":"Main Stage A 主舞台","semantic":"stage","color":"#2b5fd9","opacity":0.4,"polygon":[[-160.706,-47.813],[-149.417,-47.149],[-143.44,-65.743],[-158.05,-69.728]]},
    {"name":"Main Stage B 主舞台","semantic":"stage","color":"#2b5fd9","opacity":0.4,"polygon":[[122.854,-2.656],[135.471,-2.656],[135.471,-27.891],[122.854,-27.227]]},
    {"name":"VIP 区","semantic":"vip","color":"#f2d024","opacity":0.35,"polygon":[[57.11,37.852],[120.198,57.11],[122.854,32.54],[63.751,17.266]]},
    {"name":"Red Tent 红棚","semantic":"reserved","color":"#c0392b","opacity":0.35,"polygon":[[-47.813,41.837],[-32.54,46.485],[-28.555,35.196],[-43.829,29.883]]},
    {"name":"Lawn 绿地","semantic":"audience","color":"#3fb544","opacity":0.15,"polygon":[[-277.583,3.984],[-241.723,11.289],[-235.083,-22.579],[-260.317,-32.54]]},
  ],
  facilities: [
    {"templateId":"oneplan:scale:picnic-table","name":"野餐桌","color":"#f2d024","placement":{"kind":"scatter","at":[[-23.243,42.501],[-19.723,42.501],[-16.203,42.501],[-12.684,42.501],[-9.164,42.501],[-5.645,42.501],[-21.25,-32.54],[-16.934,-32.54],[-12.617,-32.54],[-8.301,-32.54]],"rot":0}},
    {"templateId":"oneplan:scale:pop-up-tent","name":"白棚","placement":{"kind":"scatter","at":[[50.47,31.876],[90.314,-57.11],[-245.044,0]],"rot":0}},
    {"templateId":"oneplan:scale:market-stall","name":"餐摊","color":"#3fb544","placement":{"kind":"scatter","at":[[-28.555,-24.571],[-19.922,-24.571],[-12.617,-24.571],[-5.977,-24.571],[2.656,-24.571],[9.297,-24.571]],"rot":0}},
    {"templateId":"oneplan:scale:large-screen","name":"大屏","placement":{"kind":"scatter","at":[[-64.415,-19.922],[1.328,-10.625]],"rot":0}},
    {"templateId":"security-post-1.5x1.5","name":"安保岗亭","placement":{"kind":"scatter","at":[[-179.964,-8.633],[31.876,17.93]],"rot":0}},
    {"templateId":"trash-point-1.2x1.2","name":"垃圾点","placement":{"kind":"scatter","at":[[25.899,21.25],[31.876,-5.977]],"rot":0}},
  ],
  routes: [
    {"name":"人流 · 桥西→主街→主舞台","kind":"pedestrian","carrier":"walk","oneWay":true,"widthM":3,"color":"#f2c744","points":[[-280.24,6.641],[-55.782,57.775],[-53.126,51.798],[120.862,102.932],[120.862,115.549],[277.583,90.978],[280.24,83.673]]},
    {"name":"人流 · 东侧→VIP","kind":"pedestrian","carrier":"walk","oneWay":true,"widthM":3,"color":"#f2c744","points":[[36.524,73.712],[44.493,11.953],[53.126,-11.289],[63.751,-62.423],[136.799,-60.431],[143.44,-124.846]]},
  ],
  nodes: [
    {"name":"桥西入口","kind":"both","x":-280.24,"y":6.641},
    {"name":"东入口","kind":"both","x":143.44,"y":-124.846},
  ],
  confirmedView: {"lng":-85.313833,"lat":35.055926,"zoom":17,"rotationDeg":3},
};
