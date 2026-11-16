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

import { REPLICA_FLOW_COLOR } from './replica-kit';
import type { ReplicaCaseSpec } from './replica-kit';

const LINK = (slug: string) => `https://www.oneplan.io/inspiration/${slug}/`;

export const SENIOR_PRO_RODEO_FINALS: ReplicaCaseSpec = {
  slug: 'senior-pro-rodeo-finals',
  title: 'Senior Pro Rodeo Finals',
  category: 'Festivals',
  region: 'North America',
  refImage: 'senior-pro-rodeo-finals.png',
  refLink: LINK('senior-pro-rodeo-finals'),
  anchor: { lng: -112.074, lat: 33.448 },
  locationNote: '锚点示意：参考图为美国西南部竞技场，未取到官方坐标',
  zones: [
    // 中央竞技场：参考图里那块被看台和拖车位夹住的土场。
    { name: 'Rodeo Arena 竞技场', semantic: 'stage', color: '#c9a54a', opacity: 0.3, rect: { cx: 0, cy: 10, w: 62, h: 96 } },
    // 西/东两条长看台（白色长条建筑）。
    { name: 'West Grandstand 西看台', semantic: 'audience', color: '#8f9aa6', opacity: 0.42, rect: { cx: -38, cy: 12, w: 12, h: 96 } },
    { name: 'East Grandstand 东看台', semantic: 'audience', color: '#8f9aa6', opacity: 0.42, rect: { cx: 37, cy: 18, w: 10, h: 64 } },
    // 场东两条橙色斜纹拖车位（参考图最显眼的两列）。
    { name: 'Trailer Parking A 拖车位 A', semantic: 'parking', color: '#e07b30', opacity: 0.32, rect: { cx: 56, cy: 12, w: 9, h: 96 } },
    { name: 'Trailer Parking B 拖车位 B', semantic: 'parking', color: '#e07b30', opacity: 0.32, rect: { cx: 72, cy: 12, w: 9, h: 96 } },
    // 南侧铺装热身场（参考图下方那块带橙色作业块的硬地）。
    { name: 'Warm-up Arena 热身场', semantic: 'reserved', color: '#d9d2c2', opacity: 0.5, rect: { cx: 18, cy: -58, w: 46, h: 26 } },
    // 西南角白色室内馆。
    { name: 'Indoor Barn 室内馆', semantic: 'indoor', color: '#b9c7c0', opacity: 0.5, rect: { cx: -62, cy: -62, w: 44, h: 56 } },
    // 最南一排拖车停车（参考图底部那排橙纹）。
    { name: 'Horse Trailer Lot 拖车场', semantic: 'parking', color: '#e07b30', opacity: 0.28, rect: { cx: 6, cy: -118, w: 88, h: 24 } },
    // 北端蓝框检录/办公。
    { name: 'Check-in & Office 检录处', semantic: 'checkin', color: '#2b5fd9', opacity: 0.35, rect: { cx: -12, cy: 84, w: 44, h: 12 } },
  ],
  facilities: [
    { templateId: 'booth-2x2', name: '检录棚', color: '#2b5fd9', placement: { kind: 'row', x: -20, y: 84, count: 3, dx: 8 }, zoneIndex: 8 },
    { templateId: 'stage-platform-8x6', name: '播报台', color: '#c9a54a', placement: { kind: 'single', x: 0, y: 56 }, zoneIndex: 0 },
    { templateId: 'booth-2x2', name: '裁判席', color: '#e07b30', placement: { kind: 'scatter', at: [[-7, 16], [0, 16], [7, 16]] }, zoneIndex: 0 },
    { templateId: 'oneplan:icon:cone', name: '场内锥桶', color: '#e07b30', placement: { kind: 'row', x: -24, y: -34, count: 7, dx: 8 }, zoneIndex: 0 },
    { templateId: 'oneplan:scale:caravan', name: 'A 列房车', color: '#e07b30', placement: { kind: 'row', x: 56, y: -34, count: 7, dy: 9 }, zoneIndex: 3 },
    { templateId: 'oneplan:scale:caravan', name: 'B 列马拖车', color: '#e07b30', placement: { kind: 'row', x: 72, y: -30, count: 6, dy: 9 }, zoneIndex: 4 },
    { templateId: 'oneplan:scale:car', name: 'A 列牵引车', color: '#3d4b45', placement: { kind: 'row', x: 62, y: -30, count: 6, dy: 9 }, zoneIndex: 3 },
    { templateId: 'oneplan:scale:stage', name: '热身场作业台', color: '#e07b30', placement: { kind: 'single', x: 18, y: -58 }, zoneIndex: 5 },
    { templateId: 'oneplan:scale:car', name: '南场停车', color: '#3d4b45', placement: { kind: 'grid', x: -18, y: -124, cols: 5, rows: 2, dx: 8, dy: 7 }, zoneIndex: 7 },
    { templateId: 'oneplan:scale:caravan', name: '南场拖车', color: '#e07b30', placement: { kind: 'row', x: 24, y: -124, count: 5, dx: 9 }, zoneIndex: 7 },
    { templateId: 'oneplan:scale:portable-toilet', name: '移动洗手间', placement: { kind: 'row', x: -88, y: 34, count: 5, dy: 3.2, rot: 90 } },
    { templateId: 'oneplan:icon:first-aid-point', name: '急救点', color: '#c0392b', placement: { kind: 'scatter', at: [[-88, -6], [50, -44]] } },
    { templateId: 'oneplan:icon:information-point', name: '信息点', color: '#f2d024', placement: { kind: 'scatter', at: [[-86, 66], [10, -96], [58, -62]] } },
    { templateId: 'oneplan:scale:large-waste-container', name: '垃圾大桶', color: '#7d8a84', placement: { kind: 'scatter', at: [[-86, -34], [62, -92]] } },
    { templateId: 'security-post-1.5x1.5', name: '安保岗', color: '#2b5fd9', placement: { kind: 'scatter', at: [[-86, 90], [84, -56]] } },
    { templateId: 'oneplan:icon:entry-gate', name: '门架', color: '#3fb544', placement: { kind: 'scatter', at: [[-12, 94], [30, -132]] } },
    { templateId: 'oneplan:scale:generator', name: '发电机', color: '#7d8a84', placement: { kind: 'single', x: -68, y: -30 } },
  ],
  routes: [
    // 参考图里那圈黄线：绕竞技场一圈的单向环流，看台、拖车位、热身场都挂在这圈上。
    { name: '环流线 · 场地环路', kind: 'pedestrian', carrier: 'walk', oneWay: true, widthM: 3, color: REPLICA_FLOW_COLOR, startNode: 0,
      points: [[-78, 72], [-78, -20], [-52, -44], [24, -44], [46, -30], [46, 66], [16, 76], [-12, 94]] },
    // 南侧拖车进场：从南门沿东侧一路顶到两条拖车位。
    { name: '车行 · 南门→拖车位', kind: 'vehicle', carrier: 'vehicle', oneWay: true, widthM: 6, color: '#e07b30', startNode: 1,
      points: [[30, -132], [34, -104], [50, -70], [62, -40], [66, 40], [64, 66]] },
    // 检录进观众区。
    { name: '人流 · 检录→西看台', kind: 'pedestrian', carrier: 'walk', oneWay: true, widthM: 3, color: '#2b5fd9', startNode: 0,
      points: [[-12, 94], [-30, 76], [-44, 62], [-44, 30]] },
    // 后勤：室内馆出来去热身场（人与车/推车共用）。
    { name: '后勤 · 室内馆→热身场', kind: 'service', carrier: 'mixed', oneWay: false, widthM: 4, color: '#7d8a84', startNode: 2,
      points: [[-62, -34], [-46, -46], [-10, -54], [16, -58]] },
  ],
  nodes: [
    { name: '北门 · 检录', kind: 'both', x: -12, y: 94 },
    { name: '南门 · 拖车口', kind: 'entry', x: 30, y: -132 },
    { name: '室内馆口', kind: 'both', x: -62, y: -34 },
  ],
};
