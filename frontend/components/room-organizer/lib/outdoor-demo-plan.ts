/**
 * 内置示范场景（#81）：一份过 sitePlanDataSchema 的完整户外起步方案，
 * 供编辑器内一键载入 / 复位，替代过去靠 Playwright 脚本往 localStorage 注入的一次性测试场景。
 *
 * 口径：
 * - 矩形闭合边界（±15 m 东 / ±10 m 北），7 个岗位点位 + 5 个可交互设施；
 * - 岗位不绑 assetId，按岗位归类取该类默认云端 walk 角色兜底；
 * - 设施 templateId 全部取设施模板目录在册值（见 site-plan-facilities.ts）；
 * - 固定全十六进制 UUID（zod `.uuid()` 拒收含 w/f 之类非 hex 字符的手写 id）；
 * - 工厂每次返回独立新对象，调用方就地改不会污染内置常量。
 */

import type { SitePlanData } from '../../../../supabase/functions/_shared/site-plan';
import { DEFAULT_OUTDOOR_PLAN_ANCHOR } from './outdoor-project-store';

/** 示范场景岗位总数 / 设施总数（面板提示与单测复用）。 */
export const DEMO_OUTDOOR_WORKER_COUNT = 7;
export const DEMO_OUTDOOR_FACILITY_COUNT = 5;

const DEMO_BOUNDARY: SitePlanData['boundary'] = [
  { x: -15, y: -10 },
  { x: 15, y: -10 },
  { x: 15, y: 10 },
  { x: -15, y: 10 },
];

/** 生成一份独立的示范方案（带预置地理锚点；载入后可被真实选址覆盖）。 */
export function createDemoOutdoorPlan(): SitePlanData {
  return {
    schemaVersion: 1,
    anchor: DEFAULT_OUTDOOR_PLAN_ANCHOR,
    boundary: DEMO_BOUNDARY.map(point => ({ ...point })),
    zones: [],
    facilities: [
      {
        id: '7a9f1e21-8c34-400a-800a-000000000001',
        templateId: 'security-post-1.5x1.5',
        name: '签到岗亭',
        position: { x: -13, y: 0 },
        rotationDeg: 0,
        size: { width: 1.5, depth: 1.5 },
        notes: '',
      },
      {
        id: '7a9f1e21-8c34-400a-800a-000000000002',
        templateId: 'booth-2x2',
        name: '服务台',
        position: { x: 0, y: 0 },
        rotationDeg: 0,
        size: { width: 2, depth: 2 },
        notes: '',
      },
      {
        id: '7a9f1e21-8c34-400a-800a-000000000003',
        templateId: 'medical-tent-4x3',
        name: '急救站',
        position: { x: 13, y: 2 },
        rotationDeg: 0,
        size: { width: 4, depth: 3 },
        notes: '',
      },
      {
        id: '7a9f1e21-8c34-400a-800a-000000000004',
        templateId: 'booth-2x2',
        name: '展位 A',
        position: { x: -6, y: 5 },
        rotationDeg: 0,
        size: { width: 2, depth: 2 },
        notes: '',
      },
      {
        id: '7a9f1e21-8c34-400a-800a-000000000005',
        templateId: 'booth-2x2',
        name: '展位 B',
        position: { x: 6, y: -5 },
        rotationDeg: 0,
        size: { width: 2, depth: 2 },
        notes: '',
      },
    ],
    routes: [],
    nodes: [],
    workers: [
      {
        id: '7a9f1e21-8c34-400b-800b-000000000001',
        role: '保安',
        count: 2,
        position: { x: -12, y: -6 },
        notes: '',
      },
      {
        id: '7a9f1e21-8c34-400b-800b-000000000002',
        role: '警察',
        count: 1,
        position: { x: -12, y: 6 },
        notes: '',
      },
      {
        id: '7a9f1e21-8c34-400b-800b-000000000003',
        role: '消防',
        count: 1,
        position: { x: 12, y: -6 },
        notes: '',
      },
      {
        id: '7a9f1e21-8c34-400b-800b-000000000004',
        role: '医务人员',
        count: 1,
        position: { x: 12, y: 6 },
        notes: '',
      },
      {
        id: '7a9f1e21-8c34-400b-800b-000000000005',
        role: '志愿者',
        count: 2,
        position: { x: 0, y: -8 },
        notes: '',
      },
      {
        id: '7a9f1e21-8c34-400b-800b-000000000006',
        role: '主管',
        count: 1,
        position: { x: -7, y: 0 },
        notes: '',
      },
      {
        id: '7a9f1e21-8c34-400b-800b-000000000007',
        role: '管理员',
        count: 1,
        position: { x: 7, y: 0 },
        notes: '',
      },
    ],
  };
}
