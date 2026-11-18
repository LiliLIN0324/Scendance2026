/**
 * OnePlan 复刻规格 · 政府/社区类第三批（4 案，政府类收口）。
 */

import type { ReplicaCaseSpec } from './replica-kit';


export const CAROLS_IN_THE_PARK: ReplicaCaseSpec = {
  slug: "carols-in-the-park",
  title: "Carols in the Park",
  category: "Local Governments",
  region: "Australia & NZ",
  refImage: "carols-in-the-park.png",
  refLink: "https://www.oneplan.io/inspiration/carols-in-the-park/",
  anchor: {"lng":115.714981,"lat":-32.533766},
  rotationDeg: 252,
  locationNote: "2026-11-18 按原图逐块描绘；沿用用户右侧已确认位置 / 108° / z17.25，未重新配准。比例 0.194140 m/px；设施占地为模板估计，非现场实测。",
  zones: [
    {"name":"Event Lawn 活动草坪","semantic":"audience","color":"#a8d8e8","opacity":0.25,"polygon":[[-123.256,80.514],[-99.897,78.526],[-54.173,63.119],[-36.281,33.299],[-36.778,6.958],[-44.233,-32.305],[-110.831,-32.305],[-119.777,-11.431],[-124.747,12.425],[-134.19,54.67]]},
    {"name":"Festival Field 节庆大场","semantic":"reserved","color":"#c8894a","opacity":0.35,"polygon":[[-3.976,51.191],[101.885,30.317],[98.903,-46.221],[-5.467,-40.257]]},
    {"name":"Parking 停车带（右）","semantic":"parking","color":"#c0392b","opacity":0.25,"polygon":[[144.13,21.868],[158.543,22.365],[165.501,-72.065],[145.124,-74.55],[142.639,-85.981],[128.723,-82.502],[127.729,-43.736],[144.627,-37.275]]},
    {"name":"Stage Block 舞台块","semantic":"stage","color":"#2b5fd9","opacity":0.4,"polygon":[[-33.796,14.413],[-18.389,14.91],[-17.892,1.491],[-33.796,1.988]]},
    {"name":"Orange Tent 橙棚","semantic":"reserved","color":"#e07b30","opacity":0.35,"polygon":[[-43.239,47.712],[-32.802,52.682],[-27.832,38.269],[-39.76,33.796]]},
  ],
  facilities: [
    {"templateId":"oneplan:scale:ambulance","name":"急救车","color":"#3fb544","placement":{"kind":"single","x":-53.676,"y":55.167,"rot":0}},
    {"templateId":"oneplan:scale:portable-toilet","name":"移动洗手间","color":"#2b5fd9","placement":{"kind":"scatter","at":[[-78.526,74.053],[-74.55,72.562],[-71.071,72.065],[-67.095,70.574],[-61.131,-37.275],[-58.149,-37.772],[-54.67,-38.269],[-51.688,-38.269]],"rot":0}},
    {"templateId":"oneplan:scale:water-refill-station","name":"加水点","color":"#2b5fd9","placement":{"kind":"scatter","at":[[-112.819,80.514],[-105.861,78.526],[-98.406,77.035],[-128.723,82.999],[-134.19,76.538],[-140.651,53.676],[-140.154,45.227],[-134.687,37.772],[-131.208,29.323],[-127.232,20.874],[-124.25,13.419],[-121.268,5.467]],"rot":0}},
    {"templateId":"oneplan:scale:stage","name":"舞台台","placement":{"kind":"single","x":-25.347,"y":7.952,"rot":0}},
    {"templateId":"oneplan:icon:wifi","name":"场内点","color":"#2b5fd9","placement":{"kind":"scatter","at":[[-21.371,3.479],[-19.88,12.425]],"rot":0}},
    {"templateId":"oneplan:scale:caravan","name":"红色补给块","color":"#c0392b","placement":{"kind":"single","x":-0.497,"y":38.269,"rot":0}},
    {"templateId":"oneplan:icon:feather-flag","name":"入口旗","color":"#f2d024","placement":{"kind":"single","x":33.796,"y":57.652,"rot":0}},
  ],
  routes: [
    {"name":"人流 · 入口旗→大场","kind":"pedestrian","carrier":"walk","oneWay":true,"widthM":3,"color":"#f2c744","points":[[35.287,68.586],[31.808,46.718]]},
    {"name":"人流 · 草坪→舞台","kind":"pedestrian","carrier":"walk","oneWay":false,"widthM":3,"color":"#a8d8e8","points":[[-119.777,-16.898],[-110.831,-31.808],[-44.233,-32.305]]},
  ],
  nodes: [
    {"name":"主入口","kind":"both","x":33.796,"y":57.652},
    {"name":"草坪口","kind":"both","x":-119.777,"y":-16.898},
  ],
  confirmedView: {"lng":115.714981,"lat":-32.533766,"zoom":17.25,"rotationDeg":108},
};

export const MANDURAH_CHRISTMAS_PAGEANT: ReplicaCaseSpec = {
  slug: "mandurah-christmas-pageant",
  title: "Mandurah Christmas Pageant",
  category: "Local Governments",
  region: "Australia & NZ",
  refImage: "mandurah-christmas-pageant.png",
  refLink: "https://www.oneplan.io/inspiration/mandurah-christmas-pageant/",
  anchor: {"lng":115.720372,"lat":-32.531994},
  rotationDeg: 109,
  locationNote: "2026-11-18 按原图逐块描绘；沿用用户右侧已确认位置 / 251° / z17，未重新配准。比例 0.358588 m/px；设施占地为模板估计，非现场实测。",
  zones: [
    {"name":"Staging 花车集结带","semantic":"queue","color":"#c0392b","opacity":0.3,"polygon":[[-256.118,-93.635],[-168.909,-79.865],[3.672,-79.865],[22.95,-66.095],[44.063,-76.193],[119.338,-67.013],[141.37,-56.915],[135.862,-28.458],[102.814,81.701],[179.925,101.896],[242.348,-82.619],[246.938,-127.6],[-244.184,-134.944]]},
    {"name":"Float Marshalling 花车排","semantic":"reserved","color":"#c0392b","opacity":0.2,"polygon":[[-201.039,24.786],[-182.679,24.786],[-182.679,140.452],[-171.663,140.452],[-162.484,-72.521],[-197.367,-73.439]]},
    {"name":"Foreshore Event 海滨活动区","semantic":"reserved","color":"#e07b30","opacity":0.25,"polygon":[[-243.266,-120.256],[-78.029,-105.568],[6.426,-102.814],[114.748,-108.322],[240.512,-118.42],[239.594,-126.682],[5.508,-111.994],[-241.43,-134.026]]},
  ],
  facilities: [
    {"templateId":"oneplan:scale:food-trailer","name":"花车（白）","color":"#f2f2f2","placement":{"kind":"scatter","at":[[-180.843,7.344],[-180.66,3.213],[-180.476,-0.918],[-180.292,-5.049],[-180.109,-9.18],[-179.925,-13.311],[-179.742,-17.442],[-179.558,-21.573],[-179.374,-25.704],[-179.191,-29.835],[-179.007,-33.965],[-178.824,-38.096],[-178.64,-42.227],[-178.456,-46.358],[-178.273,-50.489],[-178.089,-54.62],[-177.906,-58.751],[-177.722,-62.882]],"rot":0}},
    {"templateId":"oneplan:scale:pop-up-tent","name":"海滨棚","color":"#e07b30","placement":{"kind":"scatter","at":[[-25.704,-108.322],[-13.77,-108.322],[-0.918,-108.322],[9.18,-108.322]],"rot":0}},
    {"templateId":"oneplan:icon:information-point","name":"E 点","color":"#2b5fd9","placement":{"kind":"single","x":-424.109,"y":90.881,"rot":0}},
    {"templateId":"oneplan:icon:first-aid-point","name":"急救点","color":"#c0392b","placement":{"kind":"single","x":-156.058,"y":-70.685,"rot":0}},
  ],
  routes: [
    {"name":"巡游 · 主线（集结→镇中心→海滨）","kind":"vehicle","carrier":"vehicle","oneWay":true,"widthM":5,"color":"#e07b30","points":[[-180.843,140.452],[-167.991,-68.849],[-156.058,-80.783],[5.508,-78.947],[22.95,-67.931],[44.063,-78.029],[123.928,-67.931],[142.288,-55.997],[139.534,-28.458],[104.65,79.865],[179.007,98.224],[238.676,-83.537],[244.184,-123.01],[6.426,-113.83],[-242.348,-132.19],[-255.2,-93.635],[-167.991,-80.783]]},
    {"name":"人流 · 海滨散场线","kind":"pedestrian","carrier":"walk","oneWay":true,"widthM":3,"color":"#2b5fd9","points":[[-242.348,-132.19],[6.426,-113.83],[244.184,-123.01]]},
  ],
  nodes: [
    {"name":"集结出发点","kind":"entry","x":-180.843,"y":140.452},
    {"name":"海滨散场口","kind":"exit","x":244.184,"y":-123.01},
  ],
  confirmedView: {"lng":115.720372,"lat":-32.531994,"zoom":17,"rotationDeg":251},
};

export const HALLOWEEN_TOWN: ReplicaCaseSpec = {
  slug: "halloween-town",
  title: "Halloween Town",
  category: "Local Governments",
  region: "North America",
  refImage: "halloween-town.png",
  refLink: "https://www.oneplan.io/inspiration/halloween-town/",
  anchor: {"lng":-112.01573,"lat":40.330528},
  locationNote: "2026-11-18 按原图逐块描绘；沿用用户右侧已确认位置 / 0° / z17.75，未重新配准。比例 0.168398 m/px；设施占地为模板估计，非现场实测。",
  zones: [
    {"name":"Vendor Booths 摊位海","semantic":"reserved","color":"#a06a3a","opacity":0.35,"polygon":[[-77.598,15.951],[-61.216,27.59],[-43.541,28.021],[-20.693,36.643],[9.915,22.417],[25.435,-1.293],[6.035,-19.831],[5.604,-40.523],[-35.35,-43.541],[-37.937,-71.562],[-57.336,-69.838],[-63.803,-62.94],[-64.234,-45.265],[-75.011,-37.506],[-81.909,10.346]]},
    {"name":"Car Show 车展区","semantic":"reserved","color":"#f2d024","opacity":0.3,"polygon":[[-31.47,-46.128],[8.622,-46.128],[9.053,-68.976],[-31.039,-68.976]]},
    {"name":"Food Row 绿食列","semantic":"reserved","color":"#3fb544","opacity":0.3,"polygon":[[31.901,-25.004],[43.11,-25.435],[50.87,-33.195],[43.972,-40.092],[43.11,-62.94],[38.799,-81.046],[33.626,-88.806],[27.159,-91.393],[21.555,-87.944],[29.315,-77.167],[31.901,-58.198]]},
    {"name":"Petting Zoo 宠物园","semantic":"reserved","color":"#3aa08c","opacity":0.3,"polygon":[[44.834,-1.724],[61.216,2.587],[70.7,0.431],[69.838,-11.209],[59.492,-24.573],[43.11,-15.52]]},
    {"name":"First Aid 急救弧","semantic":"medical","color":"#c0392b","opacity":0.3,"polygon":[[48.714,-49.145],[56.905,-37.074],[64.665,-50.439],[64.665,-62.078],[58.198,-63.371],[52.163,-57.336]]},
    {"name":"Sheriff 警务区","semantic":"reserved","color":"#2b5fd9","opacity":0.3,"polygon":[[64.234,-50.87],[89.237,-51.732],[87.944,-56.905],[69.838,-59.923],[68.976,-67.251],[62.94,-68.114]]},
    {"name":"Vendor Parking 摊贩停车","semantic":"parking","color":"#e07b30","opacity":0.25,"polygon":[[-102.601,50.87],[-83.633,78.46],[-80.615,76.304],[-98.722,47.421]]},
    {"name":"Vendor Parking B","semantic":"parking","color":"#e07b30","opacity":0.25,"polygon":[[105.188,50.007],[112.517,84.926],[117.259,84.495],[110.792,48.714]]},
  ],
  facilities: [
    {"templateId":"booth-2x2","name":"橙 X 摊","color":"#e07b30","placement":{"kind":"scatter","at":[[-73.718,13.795],[-59.923,9.079],[-46.128,8.699],[-32.332,13.004],[-18.537,18.036],[-4.742,19.169],[9.053,15.361],[-75.442,-2.155],[-60.785,-7.234],[-46.128,-7.643],[-31.47,-3.007],[-16.813,2.412],[-2.155,3.632],[-70.7,-16.382],[-58.198,-21.823],[-45.696,-22.262],[-33.195,-17.294],[-20.693,-11.488],[-8.191,-10.181],[-75.873,-30.177],[-60.354,-36.344],[-44.834,-36.841],[-29.315,-31.211],[-13.795,-24.631],[1.724,-23.149],[-58.198,-48.714],[-44.834,-53.887],[-32.763,-47.421],[-12.933,-51.301],[-5.604,-54.318],[-21.555,-40.954],[-8.191,-18.968],[-31.47,-2.587]],"rot":0}},
    {"templateId":"oneplan:scale:car","name":"车展车","color":"#f2f2f2","placement":{"kind":"scatter","at":[[-17.244,-54.749],[-14.226,-54.749],[-11.209,-54.749],[-8.191,-54.749],[-5.173,-54.749],[-2.155,-54.749]],"rot":90}},
    {"templateId":"oneplan:scale:market-stall","name":"绿食棚","color":"#3fb544","placement":{"kind":"scatter","at":[[41.817,-34.057],[40.221,-41.385],[38.626,-48.714],[37.031,-56.043],[35.436,-63.371],[33.841,-70.7],[32.246,-78.029],[30.651,-85.357]],"rot":90}},
    {"templateId":"oneplan:icon:first-aid-point","name":"急救","color":"#c0392b","placement":{"kind":"single","x":59.923,"y":-50.87,"rot":0}},
    {"templateId":"oneplan:icon:information-point","name":"WC/信息","color":"#2b5fd9","placement":{"kind":"scatter","at":[[67.251,28.452],[76.304,20.693],[-6.035,-87.082]],"rot":0}},
    {"templateId":"oneplan:icon:photo-point","name":"宠物园点","color":"#a06a3a","placement":{"kind":"single","x":59.492,"y":-1.724,"rot":0}},
    {"templateId":"oneplan:scale:police-car","name":"警车","color":"#2b5fd9","placement":{"kind":"single","x":77.598,"y":-53.025,"rot":0}},
    {"templateId":"oneplan:scale:pop-up-tent","name":"紫棚","color":"#b362c9","placement":{"kind":"single","x":21.124,"y":-12.933,"rot":0}},
  ],
  routes: [
    {"name":"人流 · 停车→摊位海→食列","kind":"pedestrian","carrier":"walk","oneWay":true,"widthM":3,"color":"#f2c744","points":[[-110.361,31.039],[-95.704,21.555],[-91.393,5.173],[-85.357,-21.555],[-90.531,-38.799],[-71.562,-43.972],[-62.509,-66.389],[-47.852,-79.322],[-15.951,-93.548],[6.035,-98.722],[27.59,-94.411],[39.661,-85.357],[45.696,-68.976],[45.265,-52.594],[46.128,-42.679],[55.181,-32.332]]},
    {"name":"人流 · 东门→宠物园","kind":"pedestrian","carrier":"walk","oneWay":true,"widthM":3,"color":"#e07b30","points":[[89.237,-49.576],[21.555,-49.576],[20.262,-37.506],[26.728,-26.728],[34.488,-24.573],[45.265,-27.59]]},
  ],
  nodes: [
    {"name":"西门","kind":"both","x":55.181,"y":-32.332},
    {"name":"东门","kind":"both","x":-95.704,"y":21.555},
  ],
  confirmedView: {"lng":-112.01573,"lat":40.330528,"zoom":17.75,"rotationDeg":0},
  rotationDeg: 0,
};

export const SPRINGVALE_SNOW_FEST: ReplicaCaseSpec = {
  slug: "springvale-snow-fest",
  title: "Springvale Snow Fest",
  category: "Local Governments",
  region: "Australia & NZ",
  refImage: "springvale-snow-fest.png",
  refLink: "https://www.oneplan.io/inspiration/springvale-snow-fest/",
  anchor: {"lng":145.151318,"lat":-37.950316},
  rotationDeg: 98,
  locationNote: "2026-11-18 按原图逐块描绘；沿用用户右侧已确认位置 / 262° / z17.25，未重新配准。比例 0.178246 m/px；设施占地为模板估计，非现场实测。",
  zones: [
    {"name":"Street Market 街市带","semantic":"reserved","color":"#f2d024","opacity":0.15,"polygon":[[-204.883,-16.883],[-201.232,-12.777],[-126.854,-13.233],[-126.854,-22.815],[-204.883,-22.815]]},
    {"name":"Snow Play A 玩雪区","semantic":"audience","color":"#a8d8e8","opacity":0.3,"polygon":[[13.233,-0.913],[27.379,-0.913],[27.379,-10.039],[13.233,-10.039]]},
    {"name":"Snow Play B 玩雪区 B","semantic":"audience","color":"#3fb544","opacity":0.25,"polygon":[[188.456,-22.359],[194.844,-22.359],[194.844,-34.223],[188.456,-34.223]]},
    {"name":"Pink Block 粉块","semantic":"stage","color":"#ec5fa8","opacity":0.35,"polygon":[[-115.902,33.767],[-98.563,33.311],[-98.563,19.165],[-115.902,19.165]]},
    {"name":"Orange Strip 橙条","semantic":"reserved","color":"#e07b30","opacity":0.3,"polygon":[[146.931,47.912],[159.252,47.912],[159.252,34.679],[146.931,34.679]]},
  ],
  facilities: [
    {"templateId":"booth-2x2","name":"红摊","color":"#c0392b","placement":{"kind":"scatter","at":[[-196.213,-20.078],[-193.019,-20.078],[-189.824,-19.621],[-186.174,-19.621],[-182.98,-19.165],[-161.077,-19.165],[-157.427,-19.165],[-153.32,-19.165],[-150.126,-19.165],[-146.475,-19.165],[-139.174,-19.165],[-99.932,-36.961],[-100.388,-40.155],[-100.844,-43.349],[-100.844,-46.543],[-26.466,-5.932],[-21.903,-5.932],[-12.777,-6.388],[31.029,-16.883],[34.679,-16.883],[38.33,-16.883],[41.98,-16.883],[45.631,-16.883],[49.738,-16.883],[53.844,-16.883],[57.951,-16.883],[61.602,-16.883],[96.737,-15.514],[100.388,-15.514],[107.233,-15.514],[109.514,-15.514]],"rot":0}},
    {"templateId":"booth-2x2","name":"绿摊","color":"#3fb544","placement":{"kind":"scatter","at":[[-143.737,-19.165],[-135.524,-19.165],[-131.417,-19.165],[-83.048,-17.34],[-78.941,-17.34],[-74.835,-17.34],[-67.534,-17.34],[-30.573,-16.427],[-21.903,-16.883],[-17.796,-16.883],[149.213,30.573],[153.32,30.573],[155.601,30.573]],"rot":0}},
    {"templateId":"booth-2x2","name":"黄摊","color":"#f2d024","placement":{"kind":"scatter","at":[[-64.796,-17.34],[-60.233,-17.34],[-55.67,-17.34],[-37.874,-16.427],[-26.01,-16.427],[-36.961,-6.388]],"rot":0}},
    {"templateId":"booth-2x2","name":"蓝摊","color":"#2b5fd9","placement":{"kind":"scatter","at":[[-188.456,-14.602],[-150.126,-7.757],[-144.65,-7.757],[-139.174,-7.757],[-134.155,-7.757],[1.825,-15.514],[-39.699,-6.388],[-35.136,-6.388]],"rot":0}},
    {"templateId":"oneplan:scale:large-waste-container","name":"垃圾大桶","color":"#e07b30","placement":{"kind":"scatter","at":[[-173.397,-14.602],[4.563,-17.34]],"rot":0}},
    {"templateId":"toilet-2.4x1.2","name":"WC 大点","color":"#7fd0e8","placement":{"kind":"scatter","at":[[130.961,18.709],[-115.446,-37.417]],"rot":0}},
    {"templateId":"oneplan:icon:fireworks","name":"气球点","color":"#f2d024","placement":{"kind":"scatter","at":[[-10.951,67.99],[8.67,-44.718]],"rot":0}},
    {"templateId":"stage-platform-8x6","name":"街舞台","placement":{"kind":"single","x":190.737,"y":-8.67,"rot":0}},
    {"templateId":"oneplan:icon:cone","name":"路障条","color":"#e07b30","placement":{"kind":"scatter","at":[[166.553,-12.32],[170.203,-12.32],[173.397,-12.32]],"rot":0}},
    {"templateId":"oneplan:icon:first-aid-point","name":"急救点","color":"#c0392b","placement":{"kind":"scatter","at":[[-37.417,-2.282],[31.485,7.757],[79.854,-21.903]],"rot":0}},
    {"templateId":"oneplan:icon:information-point","name":"信息点","color":"#3fb544","placement":{"kind":"scatter","at":[[-127.31,0],[31.485,-15.971]],"rot":0}},
  ],
  routes: [
    {"name":"人流 · 商业主街","kind":"pedestrian","carrier":"walk","oneWay":true,"widthM":3,"color":"#f2c744","points":[[-107.233,-89.437],[-104.495,-27.379],[-118.184,-20.078],[-134.611,-20.078]]},
    {"name":"人流 · 玩雪支线","kind":"pedestrian","carrier":"walk","oneWay":false,"widthM":3,"color":"#a8d8e8","points":[[193.931,-15.058],[178.873,-15.058],[173.397,-10.039],[161.077,-11.408],[157.883,-15.514]]},
  ],
  nodes: [
    {"name":"西街口","kind":"both","x":-107.233,"y":-89.437},
    {"name":"玩雪口","kind":"both","x":193.931,"y":-15.058},
  ],
  confirmedView: {"lng":145.151318,"lat":-37.950316,"zoom":17.25,"rotationDeg":262},
};
