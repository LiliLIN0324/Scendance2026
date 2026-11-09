/**
 * 平湖秋月 WGS-84 → GCJ-02 换算核对（一次性核对脚本，可复跑）。
 *
 * 用途：XH-03 要把 0233 实景对齐到地图场地。控制点坐标来自维基条目（WGS-84），
 * 而幕景地图链路（高德 POI / 瓦片 / 静态图）全是 GCJ-02，两套坐标不能混用。
 * 这里用仓库自己的 geo-coords 换算，并打印偏移量，便于核对换算方向与量级。
 *
 * 跑法：node --experimental-transform-types scripts/check-pinghu-qiuyue-coords.ts
 */
import { wgs84ToGcj02 } from '../frontend/components/room-organizer/lib/geo-coords.ts';

/** 平湖秋月：维基条目坐标（WGS-84）。 */
const PINGHU_QIUYUE_WGS84 = { lng: 120.141306, lat: 30.254500 };

const gcj = wgs84ToGcj02(PINGHU_QIUYUE_WGS84.lng, PINGHU_QIUYUE_WGS84.lat);
const eastM = (gcj.lng - PINGHU_QIUYUE_WGS84.lng) * 111_320 * Math.cos((PINGHU_QIUYUE_WGS84.lat * Math.PI) / 180);
const northM = (gcj.lat - PINGHU_QIUYUE_WGS84.lat) * 110_574;

console.log('平湖秋月 WGS-84 :', PINGHU_QIUYUE_WGS84.lng.toFixed(6), PINGHU_QIUYUE_WGS84.lat.toFixed(6));
console.log('平湖秋月 GCJ-02 :', gcj.lng.toFixed(6), gcj.lat.toFixed(6));
console.log(`偏移：东 ${eastM.toFixed(1)} m / 北 ${northM.toFixed(1)} m（国内 GCJ-02 偏移量级，与 geo-coords.ts 注释一致）`);
