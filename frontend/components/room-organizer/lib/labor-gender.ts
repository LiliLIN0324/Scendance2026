/**
 * 劳动力岗位的性别属性，以及 8 岗 × 男女共 16 个未来 Aholo 小人槽位。
 *
 * 图标库仍是「一岗一图标」；性别是点位上的属性，不拆成 16 个库按钮。
 * 槽位先占好名字和 assetId，等出模验收后再把 `ready` 打开。未就绪时
 * 3D 仍走现有回落（消防/医务人员的低模 GLB，或 2D 贴纸 / 无人模标记），
 * 不虚构灰盒子，也不把 people05 里尚未生成的制服漫游槽当成真模型。
 */

import { cloudPeopleUrl } from './cloud-assets';
import {
  CUSTOM_POINT_ROLE,
  LABOR_PERSON_ROLES,
  type LaborPersonRole,
} from './oneplan-catalog';

export const LABOR_GENDERS = ['male', 'female'] as const;
export type LaborGender = (typeof LABOR_GENDERS)[number];

export const DEFAULT_LABOR_GENDER: LaborGender = 'male';

export const LABOR_GENDER_LABELS: Record<LaborGender, string> = {
  male: '男',
  female: '女',
};

/** 「自定义点」不是小人：没有性别，也不出人物模型。 */
export function isCustomPointRole(role: string): boolean {
  return role.trim() === CUSTOM_POINT_ROLE;
}

/** 除自定义点外的人员点位都可以带性别（8 个劳动力岗位 + 手改岗位名）。 */
export function laborRoleHasGender(role: string): boolean {
  return role.trim().length > 0 && !isCustomPointRole(role);
}

export function isLaborPersonRole(role: string): role is LaborPersonRole {
  return (LABOR_PERSON_ROLES as readonly string[]).includes(role.trim());
}

/** 旧数据或缺省值回落为男，不合法的值同样回落，避免撑破旧规划。 */
export function normalizeLaborGender(value: unknown): LaborGender {
  return value === 'female' ? 'female' : DEFAULT_LABOR_GENDER;
}

export interface LaborAholoSlot {
  role: LaborPersonRole;
  gender: LaborGender;
  /** 预留的云端 people/ assetId；出模验收前不要拿来请求 GLB。 */
  assetId: string;
  /** 只有生成并入库后才为 true。当前批次全部为 false。 */
  ready: boolean;
}

/**
 * 16 个预留槽。assetId 使用与古风漫游不同的 4d52 段，避免撞上
 * walk-roles.ts 里尚未真正出模的制服占位 id。
 */
const LABOR_AHOLO_SLOT_DEFS: ReadonlyArray<{
  role: LaborPersonRole;
  maleId: string;
  femaleId: string;
}> = [
  { role: '消防', maleId: '7a9f1e21-8c34-4d52-a101-b00000000001', femaleId: '7a9f1e21-8c34-4d52-a102-b00000000002' },
  { role: '经理', maleId: '7a9f1e21-8c34-4d52-a103-b00000000003', femaleId: '7a9f1e21-8c34-4d52-a104-b00000000004' },
  { role: '医务人员', maleId: '7a9f1e21-8c34-4d52-a105-b00000000005', femaleId: '7a9f1e21-8c34-4d52-a106-b00000000006' },
  { role: '警察', maleId: '7a9f1e21-8c34-4d52-a107-b00000000007', femaleId: '7a9f1e21-8c34-4d52-a108-b00000000008' },
  { role: '保安', maleId: '7a9f1e21-8c34-4d52-a109-b00000000009', femaleId: '7a9f1e21-8c34-4d52-a10a-b0000000000a' },
  { role: '管理员', maleId: '7a9f1e21-8c34-4d52-a10b-b0000000000b', femaleId: '7a9f1e21-8c34-4d52-a10c-b0000000000c' },
  { role: '主管', maleId: '7a9f1e21-8c34-4d52-a10d-b0000000000d', femaleId: '7a9f1e21-8c34-4d52-a10e-b0000000000e' },
  { role: '志愿者', maleId: '7a9f1e21-8c34-4d52-a10f-b0000000000f', femaleId: '7a9f1e21-8c34-4d52-a110-b00000000010' },
];

export const LABOR_AHOLO_SLOTS: readonly LaborAholoSlot[] = LABOR_AHOLO_SLOT_DEFS.flatMap(def => [
  { role: def.role, gender: 'male' as const, assetId: def.maleId, ready: false },
  { role: def.role, gender: 'female' as const, assetId: def.femaleId, ready: false },
]);

const SLOT_BY_KEY = new Map(
  LABOR_AHOLO_SLOTS.map(slot => [`${slot.role}:${slot.gender}`, slot] as const),
);

export function laborAholoSlot(role: string, gender?: unknown): LaborAholoSlot | null {
  if (!isLaborPersonRole(role)) return null;
  return SLOT_BY_KEY.get(`${role.trim()}:${normalizeLaborGender(gender)}`) ?? null;
}

/** 只有槽位标记 ready 时才返回云端人物地址；未出模一律为 null。 */
export function laborAholoGlbUrl(role: string, gender?: unknown): string | null {
  const slot = laborAholoSlot(role, gender);
  return slot?.ready ? cloudPeopleUrl(slot.assetId) : null;
}
