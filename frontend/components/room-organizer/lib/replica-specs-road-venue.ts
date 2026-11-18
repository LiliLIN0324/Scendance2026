/**
 * OnePlan 复刻规格 · 路跑赛事（3 案）+ 固定场馆（1 案）。
 */

import type { ReplicaCaseSpec } from './replica-kit';


export const BUFFALO_MARATHON_WEEKEND: ReplicaCaseSpec = {
  slug: "buffalo-marathon-weekend",
  title: "Buffalo Marathon Weekend",
  category: "Road Events",
  region: "North America",
  refImage: "buffalo-marathon-weekend.png",
  refLink: "https://www.oneplan.io/inspiration/buffalo-marathon-weekend/",
  anchor: {"lng":-78.877368,"lat":42.910246},
  rotationDeg: 266,
  locationNote: "2026-11-18 按原图逐块描绘；沿用用户右侧已确认位置 / 94° / z12.75，未重新配准。比例 4.800000 m/px；设施占地为模板估计，非现场实测。",
  zones: [

  ],
  facilities: [

  ],
  routes: [
    {"name":"全马 · 蓝色大环线","kind":"pedestrian","carrier":"walk","oneWay":true,"widthM":5,"color":"#2b5fd9","points":[[-2629.632,491.52],[-3637.248,368.64],[-3538.944,835.584],[-3514.368,1204.224],[-3305.472,1388.544],[-2887.68,1536],[-2875.392,1560.576],[-3256.32,1425.408],[-3514.368,1216.512],[-3526.656,860.16],[-3366.912,811.008],[-3219.456,602.112],[-2445.312,491.52],[1130.496,-258.048],[1400.832,-49.152],[1695.744,159.744],[2101.248,294.912],[2580.48,331.776],[2666.496,528.384],[2949.12,638.976],[3022.848,651.264],[2998.272,36.864],[2973.696,-245.76],[3145.728,-417.792],[3305.472,-651.264],[3416.064,-1019.904],[3379.2,-1155.072],[3870.72,-1069.056],[3883.008,-1523.712],[4239.36,-1536],[4251.648,-2150.4],[3440.64,-2162.688],[3440.64,-1966.08],[2936.832,-2039.808],[2924.544,-1560.576],[2506.752,-1327.104],[2629.632,-1044.48],[2654.208,-872.448],[2727.936,-589.824],[2666.496,-405.504],[2162.688,-417.792],[2027.52,-356.352],[1966.08,-270.336],[1413.12,-319.488],[1069.056,-466.944],[-2629.632,393.216]]},
    {"name":"半马 · 棕色小环","kind":"pedestrian","carrier":"walk","oneWay":true,"widthM":4,"color":"#8a5a2a","points":[[-2629.632,491.52],[-2322.432,737.28],[-1536,1302.528],[-1781.76,1708.032],[-1265.664,2076.672],[-946.176,1622.016],[-1757.184,1093.632],[-2224.128,774.144],[-2580.48,651.264]]},
    {"name":"5K · 粉色环","kind":"pedestrian","carrier":"walk","oneWay":true,"widthM":3,"color":"#e87ab8","points":[[-2629.632,491.52],[-1536,454.656],[-860.16,344.064],[-860.16,860.16],[-282.624,909.312],[516.096,921.6],[1142.784,921.6],[1548.288,479.232],[1671.168,159.744],[1413.12,-49.152],[1167.36,-270.336],[1290.24,-614.4],[1462.272,-921.6],[1732.608,-1277.952],[1880.064,-1486.848],[2285.568,-1609.728],[2703.36,-1560.576],[3072,-1609.728],[3588.096,-1622.016],[3833.856,-1732.608],[3833.856,-2715.648]]},
  ],
  nodes: [
    {"name":"起点拱门","kind":"entry","x":-2740.224,"y":602.112},
    {"name":"终点拱门","kind":"exit","x":-2629.632,"y":491.52},
  ],
  confirmedView: {"lng":-78.877368,"lat":42.910246,"zoom":12.75,"rotationDeg":94},
};

export const FESTIVAL_FOODS_11_RUNNING_EVENTS: ReplicaCaseSpec = {
  slug: "festival-foods-11-running-events-on-the-same-day",
  title: "Festival Foods' 11 Running Events on the Same Day",
  category: "Road Events",
  region: "North America",
  refImage: "festival-foods-11-running-events-on-the-same-day.png",
  refLink: "https://www.oneplan.io/inspiration/festival-foods-11-running-events-on-the-same-day/",
  anchor: {"lng":-89.592318,"lat":44.53386},
  locationNote: "2026-11-18 按原图逐块描绘；沿用用户右侧已确认位置 / 359° / z15.5，未重新配准。比例 1.172308 m/px；设施占地为模板估计，非现场实测。",
  zones: [

  ],
  facilities: [

  ],
  routes: [
    {"name":"河滨绿虚线跑步路线","kind":"pedestrian","carrier":"walk","oneWay":true,"widthM":4,"color":"#3fb544","points":[[-933.344,744.275],[-924.341,504.186],[-918.339,228.084],[-909.336,96.035],[-885.327,15.006],[-846.312,-63.023],[-825.305,-129.048],[-798.295,-204.075],[-855.316,-216.08],[-918.339,-207.076],[-978.361,-240.089],[-993.367,-273.101],[-966.357,-345.127],[-975.36,-453.167],[-966.357,-534.197],[-927.342,-624.23],[-882.326,-666.246],[-786.29,-717.265],[-234.086,-717.265],[213.079,-717.265],[423.156,-717.265],[429.158,-351.13],[216.08,-351.13],[213.079,123.045],[216.08,450.166],[216.08,573.212]]},
    {"name":"街区蓝虚线跑步路线","kind":"pedestrian","carrier":"walk","oneWay":true,"widthM":3,"color":"#2b5fd9","points":[[-228.084,450.166],[-225.083,-507.187],[213.079,-507.187],[213.079,450.166]]},
  ],
  nodes: [
    {"name":"起终点拱门","kind":"both","x":216.08,"y":573.212},
    {"name":"北侧折返点","kind":"exit","x":432.16,"y":129.048},
  ],
  confirmedView: {"lng":-89.592318,"lat":44.53386,"zoom":15.5,"rotationDeg":359},
  rotationDeg: 1,
};

export const USA_TRIATHLON_NATIONALS_PTO: ReplicaCaseSpec = {
  slug: "2023-usa-triathlon-nationals-pto-us-open",
  title: "USA Triathlon Nationals & PTO US Open",
  category: "Road Events",
  region: "North America",
  refImage: "2023-usa-triathlon-nationals-pto-us-open.png",
  refLink: "https://www.oneplan.io/inspiration/2023-usa-triathlon-nationals-pto-us-open/",
  anchor: {"lng":-87.89732,"lat":43.036351},
  rotationDeg: 0,
  locationNote: "2026-11-18 按原图逐块描绘；沿用用户右侧已确认位置 / 0° / z17.75，未重新配准。比例 0.136071 m/px；设施占地为模板估计，非现场实测。",
  zones: [
    {"name":"Tent Village TT11–TT26 帐篷阵","semantic":"reserved","color":"#f2d024","opacity":0.3,"polygon":[[-88.038,85.997],[-41.638,85.997],[-40.413,59.871],[-86.541,56.606]]},
    {"name":"Trike Transport 铁三转运","semantic":"loading","color":"#a06a3a","opacity":0.35,"polygon":[[-114.708,85.997],[-94.434,85.997],[-92.392,56.742],[-120.287,54.701],[-122.736,60.96]]},
    {"name":"Transition Field 转换场","semantic":"stage","color":"#3fb544","opacity":0.3,"polygon":[[-72.254,26.942],[-8.436,31.977],[-11.566,-74.567],[-81.779,-63.409],[-83.548,-52.387],[-83.004,-19.73],[-88.582,-13.607],[-83.004,8.436],[-77.425,10.477]]},
    {"name":"LAS Compound 器材区","semantic":"reserved","color":"#c0392b","opacity":0.35,"polygon":[[-140.154,-49.394],[-116.613,11.566],[-114.708,10.886],[-138.249,-50.482]]},
    {"name":"Swim Start 下水区","semantic":"reserved","color":"#f2d024","opacity":0.4,"polygon":[[33.201,24.765],[61.776,26.398],[65.859,-1.225],[37.828,-1.769]]},
    {"name":"Bay Check Tent 检录棚","semantic":"checkin","color":"#8a8f96","opacity":0.3,"polygon":[[-77.016,44.631],[-46.945,47.353],[-46.128,41.23],[-76.336,38.78]]},
  ],
  facilities: [
    {"templateId":"oneplan:scale:pop-up-tent","name":"TT1–TT26 帐篷","color":"#f2d024","placement":{"kind":"scatter","at":[[-85.045,77.833],[-81.099,78.309],[-77.153,78.785],[-73.206,79.262],[-69.26,79.738],[-65.314,80.214],[-81.779,71.165],[-77.833,71.642],[-73.887,72.118],[-69.941,72.594],[-65.995,73.07],[-84.5,60.28],[-80.554,60.756],[-76.608,61.232],[-72.662,61.708],[-68.716,62.185],[-52.796,81.643],[-48.714,82.187],[-44.631,82.731],[-52.524,74.023],[-48.578,74.567],[-44.495,75.111],[-54.565,62.321],[-50.619,63.001],[-46.809,63.954],[-43.543,65.722]],"rot":0}},
    {"templateId":"oneplan:scale:bike-rack","name":"转换车架组合列（非单个车架）","color":"#3fb544","placement":{"kind":"scatter","at":[[-73.479,-22.044],[-69.396,-22.588],[-65.314,-23.132],[-61.232,-23.676],[-57.15,-24.221],[-53.068,-24.765],[-48.986,-25.309],[-44.904,-25.854],[-40.821,-26.398],[-36.739,-26.942],[-32.657,-27.486],[-28.575,-28.031],[-24.493,-28.575],[-20.411,-29.119],[-16.329,-29.664],[-12.246,-30.208]],"rot":80},"size":{"width":74,"depth":0.35}},
    {"templateId":"oneplan:scale:stretch-tent","name":"Bay Check 检录棚","color":"#f2f2f2","placement":{"kind":"single","x":-61.776,"y":42.999,"rot":0}},
    {"templateId":"oneplan:scale:portable-toilet","name":"Bike TA 厕位","color":"#7fd0e8","placement":{"kind":"scatter","at":[[-3.81,1.089],[-3.81,-1.497],[-3.81,-4.218]],"rot":90}},
    {"templateId":"oneplan:icon:first-aid-point","name":"医疗点（Bike TA）","color":"#2b5fd9","placement":{"kind":"scatter","at":[[-82.187,-0.952],[-5.171,-13.879]],"rot":0}},
    {"templateId":"oneplan:icon:camera-fixed","name":"转播塔 1","color":"#111111","placement":{"kind":"single","x":-134.302,"y":-71.574,"rot":0}},
    {"templateId":"oneplan:scale:generator","name":"发电机","color":"#8a8f96","placement":{"kind":"single","x":-28.847,"y":47.217,"rot":0}},
  ],
  routes: [
    {"name":"Bike Out 骑行出场（粉）","kind":"vehicle","carrier":"vehicle","oneWay":true,"widthM":4,"color":"#e87ab8","points":[[-133.214,1.089],[-131.309,23.132],[-128.315,25.445],[-120.831,25.854],[-116.205,22.996],[-114.98,18.914],[-117.702,8.436],[-118.11,-2.585],[-122.464,-17.553],[-126.819,-34.834],[-132.942,-51.163],[-140.29,-49.802]]},
    {"name":"Run Lane 跑道（紫）","kind":"pedestrian","carrier":"walk","oneWay":true,"widthM":5,"color":"#7a4fd8","points":[[-72.254,-59.599],[-71.438,-71.438],[-59.735,-74.159],[-40.821,-77.289],[-22.044,-80.01],[-2.449,-83.14],[22.452,-85.725]]},
    {"name":"人流 · 检录棚→转换场","kind":"pedestrian","carrier":"walk","oneWay":true,"widthM":3,"color":"#f2c744","points":[[-8.981,22.724],[-0.952,35.651],[3.266,52.115],[4.899,73.751]]},
  ],
  nodes: [
    {"name":"转换区入口","kind":"both","x":-72.254,"y":-59.599},
    {"name":"跑道起端","kind":"entry","x":22.452,"y":-85.725},
  ],
  confirmedView: {"lng":-87.89732,"lat":43.036351,"zoom":17.75,"rotationDeg":0},
};

export const FRANKLINS_GARDENS_NORTHAMPTON_SAINTS: ReplicaCaseSpec = {
  slug: "franklins-gardens-northampton-saints-stadium",
  title: "Franklin's Gardens – Northampton Saints Stadium",
  category: "Venues",
  region: "Europe",
  refImage: "franklins-gardens-northampton-saints-stadium.jpg",
  refLink: "https://www.oneplan.io/inspiration/franklins-gardens-northampton-saints-stadium/",
  anchor: {"lng":-0.919582,"lat":52.239493},
  rotationDeg: 231,
  locationNote: "2026-11-18 按原图逐块描绘；沿用用户右侧已确认位置 / 129° / z17.75，未重新配准。比例 0.141111 m/px；设施占地为模板估计，非现场实测。",
  zones: [
    {"name":"Pitch 球场","semantic":"stage","color":"#3fb544","opacity":0.3,"polygon":[[-59.549,38.806],[55.033,39.37],[54.469,-38.1],[-59.267,-38.382]]},
    {"name":"West Stand 西看台","semantic":"audience","color":"#c0392b","opacity":0.25,"polygon":[[-91.581,38.664],[-61.524,38.806],[-61.666,-43.039],[-92.146,-43.462]]},
    {"name":"Bar Bar 品球台","semantic":"reserved","color":"#f2d024","opacity":0.35,"polygon":[[-53.622,38.806],[-43.18,38.523],[-43.18,27.376],[-25.4,27.093],[-25.4,21.167],[-47.696,20.743],[-47.696,34.996],[-53.622,34.854]]},
    {"name":"Pitch Perimeter 场边通道","semantic":"reserved","color":"#2b5fd9","opacity":0.2,"polygon":[[-61.101,38.947],[-53.763,38.806],[-54.469,-38.1],[-61.383,-38.523]]},
    {"name":"Plaza 中央广场","semantic":"reserved","color":"#3fb544","opacity":0.2,"polygon":[[-168.91,13.406],[-142.24,15.24],[-137.583,1.693],[-124.742,-12.277],[-102.87,-25.682],[-100.612,-44.309],[-154.234,-66.04],[-168.628,-23.283]]},
    {"name":"Car Park 停车场","semantic":"parking","color":"#8a8f96","opacity":0.25,"polygon":[[79.022,57.291],[134.056,56.444],[134.056,20.038],[85.231,33.02],[77.752,38.523]]},
    {"name":"Merchandise 商品棚","semantic":"reserved","color":"#b362c9","opacity":0.3,"polygon":[[-51.647,-19.332],[-24.694,-19.05],[-24.694,-25.118],[-40.64,-25.4],[-40.922,-38.1],[-51.364,-37.959]]},
  ],
  facilities: [
    {"templateId":"oneplan:scale:stretch-tent","name":"中央白帐","color":"#f2f2f2","placement":{"kind":"single","x":-116.84,"y":3.387,"rot":0}},
    {"templateId":"oneplan:icon:bar","name":"吧台点","color":"#c0392b","placement":{"kind":"scatter","at":[[-51.788,37.112],[-50.941,-35.983],[-29.351,24.694],[-29.069,-22.013]],"rot":0}},
    {"templateId":"oneplan:icon:first-aid-point","name":"急救点","color":"#3fb544","placement":{"kind":"scatter","at":[[-66.322,52.352],[-68.016,-53.904]],"rot":0}},
    {"templateId":"oneplan:icon:merchandise","name":"商品点","color":"#b362c9","placement":{"kind":"single","x":72.672,"y":39.088,"rot":0}},
    {"templateId":"oneplan:icon:stanchion","name":"隔离柱","color":"#2b5fd9","placement":{"kind":"scatter","at":[[-163.266,10.442],[-163.266,8.326],[-163.124,6.068],[-162.983,3.951],[-162.701,1.411],[-162.278,-1.129],[-161.713,-3.387],[-161.008,-5.786]],"rot":0}},
    {"templateId":"oneplan:scale:portable-toilet","name":"移动洗手间","placement":{"kind":"scatter","at":[[-80.574,28.081],[-80.574,21.731],[-80.433,-20.884],[-79.869,-30.339]],"rot":90}},
    {"templateId":"oneplan:icon:entry-gate","name":"门","color":"#2b5fd9","placement":{"kind":"scatter","at":[[-90.593,-42.757],[69.427,43.603],[-100.33,-68.157]],"rot":0}},
  ],
  routes: [
    {"name":"人流 · 停车场→广场→看台","kind":"pedestrian","carrier":"walk","oneWay":true,"widthM":3,"color":"#f2c744","points":[[-99.907,-79.587],[-101.6,-42.474],[-106.962,-26.106],[-124.319,-12.277],[-137.866,2.963],[-142.24,14.817],[-63.077,35.701],[-53.622,39.934],[54.469,41.91],[84.949,36.83],[113.171,31.75],[131.092,22.86]]},
    {"name":"人流 · 街侧→看台北","kind":"pedestrian","carrier":"walk","oneWay":true,"widthM":3,"color":"#2b5fd9","points":[[-53.058,32.879],[-47.696,33.161],[-48.119,-7.761],[-40.358,-11.712],[-44.591,-24.553],[-51.223,-34.431],[-58.702,-42.192]]},
  ],
  nodes: [
    {"name":"停车场口","kind":"both","x":69.427,"y":43.603},
    {"name":"北街口","kind":"both","x":-90.593,"y":-42.757},
  ],
  confirmedView: {"lng":-0.919582,"lat":52.239493,"zoom":17.75,"rotationDeg":129},
};
