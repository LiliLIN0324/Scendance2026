/**
 * OnePlan 复刻规格 · 竞技/马术类（1 案：补上灵感库第 45 案 Senior Pro Rodeo Finals）。
 *
 * 2026-11-17 用户：「把缺的第 45 案 senior-pro-rodeo-finals 补上：按参考图排边界、
 * 橙色停车列、环流线，锚点先标「示意」」。
 *
 * 参考图 learning-library/oneplan-siteplans/senior-pro-rodeo-finals.png 读出来的东西：
 * 中央一块土质竞技场（北端蓝框 OFFICE、场内上下各一块橙色作业块），
 * 竞技场西、东各一条长看台，东侧两条橙色斜纹拖车位（房车/马拖车），
 * 南侧铺装热身场 + 一排拖车停车列，西南角一栋白色室内馆（马厩/备场），
 * 出入口在北（检录）、南（拖车）、东（侧门），黄点=信息点、红点=急救点。
 *
 * 这一案 OnePlan 页面取不到（403），没有官方坐标：锚点按参考图的荒漠地貌取亚利桑那示意点，
 * locationNote 如实写「示意」，不要当成实际场地用。
 */

import type { ReplicaCaseSpec } from './replica-kit';


export const SENIOR_PRO_RODEO_FINALS: ReplicaCaseSpec = {
  slug: "senior-pro-rodeo-finals",
  title: "Senior Pro Rodeo Finals",
  category: "Festivals",
  region: "North America",
  refImage: "senior-pro-rodeo-finals.png",
  refLink: "https://www.oneplan.io/inspiration/senior-pro-rodeo-finals/",
  anchor: {"lng":-111.979433,"lat":33.270855},
  locationNote: "2026-11-18 按原图逐块描绘；沿用用户右侧已确认位置 / 0° / z17，未重新配准。比例 0.521026 m/px；设施占地为模板估计，非现场实测。",
  zones: [
    {"name":"Rodeo Arena 竞技场","semantic":"stage","color":"#c9a54a","opacity":0.3,"polygon":[[-37.347,193.405],[38.681,192.071],[40.015,157.391],[34.679,44.016],[-36.013,44.016]]},
    {"name":"West Grandstand 西看台","semantic":"audience","color":"#8f9aa6","opacity":0.42,"polygon":[[-74.694,188.069],[-37.347,188.069],[-37.347,53.353],[-72.027,53.353]]},
    {"name":"East Grandstand 东看台","semantic":"audience","color":"#8f9aa6","opacity":0.42,"polygon":[[40.015,186.736],[77.362,186.736],[77.362,52.019],[42.682,52.019]]},
    {"name":"Trailer Parking A 拖车位 A","semantic":"parking","color":"#e07b30","opacity":0.32,"polygon":[[84.031,188.069],[112.041,188.069],[110.708,-40.015],[84.031,-40.015]]},
    {"name":"Trailer Parking B 拖车位 B","semantic":"parking","color":"#e07b30","opacity":0.32,"polygon":[[148.055,217.414],[172.064,210.744],[170.73,-37.347],[148.055,-29.344]]},
    {"name":"Warm-up Arena 热身场","semantic":"reserved","color":"#d9d2c2","opacity":0.5,"polygon":[[-34.679,-76.028],[126.713,-76.028],[126.713,-137.384],[109.374,-149.388],[-20.007,-148.055],[-36.013,-133.383]]},
    {"name":"Indoor Barn 室内馆","semantic":"indoor","color":"#b9c7c0","opacity":0.5,"polygon":[[-232.086,13.338],[-136.05,14.672],[-133.383,-170.73],[-233.419,-172.064]]},
    {"name":"Horse Trailer Lot 拖车场","semantic":"parking","color":"#e07b30","opacity":0.28,"polygon":[[-6.669,-248.092],[133.383,-248.092],[110.708,-294.775],[-30.678,-294.775]]},
    {"name":"Check-in & Office 检录处","semantic":"checkin","color":"#2b5fd9","opacity":0.35,"polygon":[[-36.013,222.749],[36.013,222.749],[36.013,198.74],[-36.013,198.74]]},
  ],
  facilities: [
    {"templateId":"oneplan:scale:portable-toilet","name":"移动洗手间","placement":{"kind":"scatter","at":[[85.365,217.414],[86.699,210.744],[84.031,225.417],[-72.027,0]],"rot":90}},
    {"templateId":"oneplan:icon:first-aid-point","name":"急救点","color":"#c0392b","placement":{"kind":"single","x":102.705,"y":206.743,"rot":0}},
    {"templateId":"oneplan:icon:information-point","name":"信息点","color":"#f2d024","placement":{"kind":"single","x":-152.056,"y":-102.705,"rot":0}},
    {"templateId":"oneplan:icon:entry-gate","name":"门架","color":"#3fb544","placement":{"kind":"scatter","at":[[169.396,-220.081],[168.062,-240.089]],"rot":0}},
  ],
  routes: [
    {"name":"环流线 · 场地环路","kind":"pedestrian","carrier":"walk","oneWay":true,"widthM":3,"color":"#f2c744","points":[[120.044,189.403],[117.377,208.077],[106.706,238.755]]},
    {"name":"车行 · 南门→拖车位","kind":"vehicle","carrier":"vehicle","oneWay":true,"widthM":6,"color":"#e07b30","points":[[126.713,-54.687],[126.713,-20.007],[126.713,-9.337]]},
    {"name":"人流 · 检录→西看台","kind":"pedestrian","carrier":"walk","oneWay":true,"widthM":3,"color":"#2b5fd9","points":[[-113.375,41.349],[-110.708,264.097],[-96.035,268.099],[-81.363,278.77],[150.722,269.433],[173.397,262.764],[185.402,236.087],[185.402,-32.012],[177.399,-208.077],[144.053,-208.077],[144.053,-273.434],[-110.708,-273.434]]},
    {"name":"后勤 · 室内馆→热身场","kind":"service","carrier":"mixed","oneWay":false,"widthM":4,"color":"#7d8a84","points":[[-208.077,-268.099],[-208.077,-212.078],[-118.71,-202.741],[-141.386,-172.064]]},
  ],
  nodes: [
    {"name":"北门 · 检录","kind":"both","x":-113.375,"y":41.349},
    {"name":"南门 · 拖车口","kind":"entry","x":169.396,"y":-220.081},
    {"name":"室内馆口","kind":"both","x":-208.077,"y":-268.099},
  ],
  confirmedView: {"lng":-111.979433,"lat":33.270855,"zoom":17,"rotationDeg":0},
  rotationDeg: 0,
};
