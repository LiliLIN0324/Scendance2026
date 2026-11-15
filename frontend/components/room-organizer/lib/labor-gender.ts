/**
 * PEOPLE-06 劳动力男女批次登记层（交接包 people06-labor-gender-handoff-20261114）。
 *
 * 16 槽 = 8 岗 × 男女。生成链路：参考图 → 四视图 → 静态人形(G1) → 绑骨 → 动作重定向
 * (Idle_Loop, Walk_Loop)。验收上云前全部 ready:false；assetId 为预留 id，不要改动，
 * 避免与古风漫游槽冲突。验收通过后把带 Idle/Walk 的 GLB 传到
 * people/<assetId>.glb（公开读），再把对应槽 ready 置 true。
 *
 * 经理(executive) 与 主管(manager) 是两个独立岗位；图标库一岗一图标，性别是点位属性，
 * 不拆 16 个库按钮。提示词原文摘自交接包 manifest，不在前端改写。
 */
import type { CrowdTypeId } from './crowd-types';

export type LaborGender = 'male' | 'female';

export type LaborRoleId =
  | 'security'
  | 'police'
  | 'volunteer'
  | 'manager'
  | 'admin'
  | 'fire'
  | 'medical'
  | 'executive';

export interface LaborGenderSlot {
  /** 槽位 id，如 security-m；与交接包 manifest.slot 一致。 */
  id: string;
  role: LaborRoleId;
  gender: LaborGender;
  /** 岗位中文名（manifest.label）。 */
  roleLabel: string;
  /** 人群类型映射；经理/主管各自独立。 */
  crowdType: CrowdTypeId;
  /** 生成提示词原文，摘自 manifest，不在前端改写。 */
  prompt: string;
  /** 预留 R2 assetId；验收上云前不分配模型。 */
  assetId: string;
  /** 验收通过并上云后才置 true。 */
  ready: boolean;
}

/** 岗位 → 人群类型；与 CROWD_TYPES 一一对应。 */
export const LABOR_ROLE_CROWD_TYPE: Readonly<Record<LaborRoleId, CrowdTypeId>> = {
  security: 'security',
  police: 'police',
  volunteer: 'volunteer',
  manager: 'manager',
  admin: 'admin',
  fire: 'fire',
  medical: 'medical',
  executive: 'executive',
};

export const LABOR_GENDER_SLOTS: readonly LaborGenderSlot[] = [
  {
    id: "fire-m",
    role: "fire",
    gender: "male",
    roleLabel: "消防",
    crowdType: "fire",
    prompt: "一位年轻东亚男性的全身立绘，活动现场消防值守造型：深蓝色或深色消防站制服衬衣，深色长裤，肩袢与胸前仅用色块不写机构名，黑色防滑靴，可戴无文字消防头盔；中性A字站姿，双臂明显外展离开身体（为后续绑骨，禁止贴身下垂），双脚分开与肩同宽；全身完整入画，必须看到鞋和双脚，禁止半身或裁到大腿；正面视角，纯白背景，均匀柔光，写实插画，人物居中，单人，无道具，无文字水印。衣摆离地约数厘米，不拖地。硬性要求：仅作活动现场消防值守示意，禁止手持水枪、斧头或其他装备，禁止可识别机构名、编号或徽章文字，不要科幻盔甲造型。",
    assetId: "7a9f1e21-8c34-4d52-a101-b00000000001",
    ready: true,
  },
  {
    id: "fire-f",
    role: "fire",
    gender: "female",
    roleLabel: "消防",
    crowdType: "fire",
    prompt: "一位年轻东亚女性的全身立绘，活动现场消防值守造型：深蓝色或深色消防站制服衬衣，深色长裤，肩袢与胸前仅用色块不写机构名，黑色防滑靴，可戴无文字消防头盔，发式利落；中性A字站姿，双臂明显外展离开身体（为后续绑骨，禁止贴身下垂），双脚分开与肩同宽；全身完整入画，必须看到鞋和双脚，禁止半身或裁到大腿；正面视角，纯白背景，均匀柔光，写实插画，人物居中，单人，无道具，无文字水印。衣摆离地约数厘米，不拖地。硬性要求：仅作活动现场消防值守示意，禁止手持水枪、斧头或其他装备，禁止可识别机构名、编号或徽章文字，不要科幻盔甲造型。",
    assetId: "7a9f1e21-8c34-4d52-a102-b00000000002",
    ready: true,
  },
  {
    id: "executive-m",
    role: "executive",
    gender: "male",
    roleLabel: "经理",
    crowdType: "executive",
    prompt: "一位年轻东亚男性的全身立绘，活动现场经理造型：深炭灰或黑色西装外套，内搭浅色衬衫，可配深色领带，西裤，黑色皮鞋，发式利落；外观比深蓝西装的现场主管更正式；中性A字站姿，双臂明显外展离开身体（为后续绑骨，禁止贴身下垂），双脚分开与肩同宽；全身完整入画，必须看到鞋和双脚，禁止半身或裁到大腿；正面视角，纯白背景，均匀柔光，写实插画，人物居中，单人，无道具，无文字水印。衣摆离地约数厘米，不拖地。硬性要求：禁止手持文件夹、公文包或其他道具，禁止文字水印。",
    assetId: "7a9f1e21-8c34-4d52-a103-b00000000003",
    ready: true,
  },
  {
    id: "executive-f",
    role: "executive",
    gender: "female",
    roleLabel: "经理",
    crowdType: "executive",
    prompt: "一位年轻东亚女性的全身立绘，活动现场经理造型：深炭灰或黑色西装外套，内搭浅色衬衫，西裤（裤摆离地约数厘米，不用拖地长裙，以便行走绑骨），黑色皮鞋，发式利落；外观比深蓝西装的现场主管更正式；中性A字站姿，双臂明显外展离开身体（为后续绑骨，禁止贴身下垂），双脚分开与肩同宽；全身完整入画，必须看到鞋和双脚，禁止半身或裁到大腿；正面视角，纯白背景，均匀柔光，写实插画，人物居中，单人，无道具，无文字水印。衣摆离地约数厘米，不拖地。硬性要求：禁止手持文件夹、公文包或其他道具，禁止文字水印。",
    assetId: "7a9f1e21-8c34-4d52-a104-b00000000004",
    ready: true,
  },
  {
    id: "medical-m",
    role: "medical",
    gender: "male",
    roleLabel: "医务人员",
    crowdType: "medical",
    prompt: "一位年轻东亚男性的全身立绘，活动现场医务人员造型：白色或浅色医护外套，或青绿/浅蓝色医护上衣配长裤，白色或浅色工作鞋；胸前名牌位无文字；中性A字站姿，双臂明显外展离开身体（为后续绑骨，禁止贴身下垂），双脚分开与肩同宽；全身完整入画，必须看到鞋和双脚，禁止半身或裁到大腿；正面视角，纯白背景，均匀柔光，写实插画，人物居中，单人，无道具，无文字水印。衣摆离地约数厘米，不拖地。硬性要求：禁止红十字等可识别徽记，禁止手持听诊器、药箱或其他道具，禁止机构名或文字水印。",
    assetId: "7a9f1e21-8c34-4d52-a105-b00000000005",
    ready: true,
  },
  {
    id: "medical-f",
    role: "medical",
    gender: "female",
    roleLabel: "医务人员",
    crowdType: "medical",
    prompt: "一位年轻东亚女性的全身立绘，活动现场医务人员造型：白色或浅色医护外套，或青绿/浅蓝色医护上衣配长裤，白色或浅色工作鞋，发式利落或束发；胸前名牌位无文字；中性A字站姿，双臂明显外展离开身体（为后续绑骨，禁止贴身下垂），双脚分开与肩同宽；全身完整入画，必须看到鞋和双脚，禁止半身或裁到大腿；正面视角，纯白背景，均匀柔光，写实插画，人物居中，单人，无道具，无文字水印。衣摆离地约数厘米，不拖地。硬性要求：禁止红十字等可识别徽记，禁止手持听诊器、药箱或其他道具，禁止机构名或文字水印。",
    assetId: "7a9f1e21-8c34-4d52-a106-b00000000006",
    ready: true,
  },
  {
    id: "police-m",
    role: "police",
    gender: "male",
    roleLabel: "警察",
    crowdType: "police",
    prompt: "一位年轻东亚男性的全身立绘，活动现场执勤示意用的警式制服：浅蓝色衬衣，深蓝色长裤，黑色皮带（不挂装备），黑色皮鞋，可戴大檐帽；中性A字站姿，双臂明显外展离开身体（为后续绑骨，禁止贴身下垂），双脚分开与肩同宽；全身完整入画，必须看到鞋和双脚，禁止半身或裁到大腿；正面视角，纯白背景，均匀柔光，写实插画，人物居中，单人，无道具，无文字水印。衣摆离地约数厘米，不拖地。硬性要求：仅作活动现场执勤示意，禁止枪支、手铐、对讲机等手持物，禁止复制可识别警徽、警号、肩章编号或机构名。",
    assetId: "7a9f1e21-8c34-4d52-a107-b00000000007",
    ready: true,
  },
  {
    id: "police-f",
    role: "police",
    gender: "female",
    roleLabel: "警察",
    crowdType: "police",
    prompt: "一位年轻东亚女性的全身立绘，活动现场执勤示意用的警式制服：浅蓝色衬衣，深蓝色长裤，黑色皮带（不挂装备），黑色皮鞋，可戴大檐帽，发式利落；中性A字站姿，双臂明显外展离开身体（为后续绑骨，禁止贴身下垂），双脚分开与肩同宽；全身完整入画，必须看到鞋和双脚，禁止半身或裁到大腿；正面视角，纯白背景，均匀柔光，写实插画，人物居中，单人，无道具，无文字水印。衣摆离地约数厘米，不拖地。硬性要求：仅作活动现场执勤示意，禁止枪支、手铐、对讲机等手持物，禁止复制可识别警徽、警号、肩章编号或机构名。",
    assetId: "7a9f1e21-8c34-4d52-a108-b00000000008",
    ready: true,
  },
  {
    id: "security-m",
    role: "security",
    gender: "male",
    roleLabel: "保安",
    crowdType: "security",
    prompt: "一位年轻东亚男性的全身立绘，国内活动现场保安制服：深蓝或黑色长袖/短袖衬衣，肩袢为色块、胸前名牌位无文字，深色西裤，黑色皮鞋，可戴深色贝雷帽；中性A字站姿，双臂明显外展离开身体（为后续绑骨，禁止贴身下垂），双脚分开与肩同宽；全身完整入画，必须看到鞋和双脚，禁止半身或裁到大腿；正面视角，纯白背景，均匀柔光，写实插画，人物居中，单人，无道具，无文字水印。衣摆离地约数厘米，不拖地。硬性要求：这是活动安保示意造型，禁止枪支、对讲机、警棍等手持物，禁止可识别机构名、编号或徽章文字。",
    assetId: "7a9f1e21-8c34-4d52-a109-b00000000009",
    ready: true,
  },
  {
    id: "security-f",
    role: "security",
    gender: "female",
    roleLabel: "保安",
    crowdType: "security",
    prompt: "一位年轻东亚女性的全身立绘，国内活动现场保安制服：深蓝或黑色长袖/短袖衬衣，肩袢为色块、胸前名牌位无文字，深色西裤，黑色皮鞋，可戴深色贝雷帽，发式利落或盘发；中性A字站姿，双臂明显外展离开身体（为后续绑骨，禁止贴身下垂），双脚分开与肩同宽；全身完整入画，必须看到鞋和双脚，禁止半身或裁到大腿；正面视角，纯白背景，均匀柔光，写实插画，人物居中，单人，无道具，无文字水印。衣摆离地约数厘米，不拖地。硬性要求：这是活动安保示意造型，禁止枪支、对讲机、警棍等手持物，禁止可识别机构名、编号或徽章文字。",
    assetId: "7a9f1e21-8c34-4d52-a10a-b0000000000a",
    ready: true,
  },
  {
    id: "admin-m",
    role: "admin",
    gender: "male",
    roleLabel: "管理员",
    crowdType: "admin",
    prompt: "一位年轻东亚男性的全身立绘，活动场地管理员造型：深色Polo衫或薄夹克，卡其裤，胸前挂无字工牌挂绳，休闲皮鞋或运动鞋；中性A字站姿，双臂明显外展离开身体（为后续绑骨，禁止贴身下垂），双脚分开与肩同宽；全身完整入画，必须看到鞋和双脚，禁止半身或裁到大腿；正面视角，纯白背景，均匀柔光，写实插画，人物居中，单人，无道具，无文字水印。衣摆离地约数厘米，不拖地。硬性要求：比西装主管更一线、比保安更便装；工牌无文字，禁止手持对讲机、平板或其他道具。",
    assetId: "7a9f1e21-8c34-4d52-a10b-b0000000000b",
    ready: true,
  },
  {
    id: "admin-f",
    role: "admin",
    gender: "female",
    roleLabel: "管理员",
    crowdType: "admin",
    prompt: "一位年轻东亚女性的全身立绘，活动场地管理员造型：深色Polo衫或薄夹克，卡其裤，胸前挂无字工牌挂绳，休闲皮鞋或运动鞋，发式利落；中性A字站姿，双臂明显外展离开身体（为后续绑骨，禁止贴身下垂），双脚分开与肩同宽；全身完整入画，必须看到鞋和双脚，禁止半身或裁到大腿；正面视角，纯白背景，均匀柔光，写实插画，人物居中，单人，无道具，无文字水印。衣摆离地约数厘米，不拖地。硬性要求：比西装主管更一线、比保安更便装；工牌无文字，禁止手持对讲机、平板或其他道具。",
    assetId: "7a9f1e21-8c34-4d52-a10c-b0000000000c",
    ready: true,
  },
  {
    id: "manager-m",
    role: "manager",
    gender: "male",
    roleLabel: "主管",
    crowdType: "manager",
    prompt: "一位年轻东亚男性的全身立绘，活动现场主管造型：深蓝色西装外套，内搭浅色衬衫，西裤，黑色皮鞋，发式利落；中性A字站姿，双臂明显外展离开身体（为后续绑骨，禁止贴身下垂），双脚分开与肩同宽；全身完整入画，必须看到鞋和双脚，禁止半身或裁到大腿；正面视角，纯白背景，均匀柔光，写实插画，人物居中，单人，无道具，无文字水印。衣摆离地约数厘米，不拖地。硬性要求：商务利落、可现场走动调度，禁止手持文件夹、对讲机或其他道具，禁止文字水印。",
    assetId: "7a9f1e21-8c34-4d52-a10d-b0000000000d",
    ready: true,
  },
  {
    id: "manager-f",
    role: "manager",
    gender: "female",
    roleLabel: "主管",
    crowdType: "manager",
    prompt: "一位年轻东亚女性的全身立绘，活动现场主管造型：深蓝色西装外套，内搭浅色衬衫，西裤（裤摆离地约数厘米不拖地），平底或低跟皮鞋，发式利落；中性A字站姿，双臂明显外展离开身体（为后续绑骨，禁止贴身下垂），双脚分开与肩同宽；全身完整入画，必须看到鞋和双脚，禁止半身或裁到大腿；正面视角，纯白背景，均匀柔光，写实插画，人物居中，单人，无道具，无文字水印。衣摆离地约数厘米，不拖地。硬性要求：商务利落、可现场走动调度，禁止手持文件夹、对讲机或其他道具，禁止文字水印。",
    assetId: "7a9f1e21-8c34-4d52-a10e-b0000000000e",
    ready: true,
  },
  {
    id: "volunteer-m",
    role: "volunteer",
    gender: "male",
    roleLabel: "志愿者",
    crowdType: "volunteer",
    prompt: "一位年轻东亚男性的全身立绘，活动志愿者造型：简洁休闲T恤与长裤，外穿红色或青绿色志愿者马甲（马甲为纯色块、无文字），运动鞋，短发；中性A字站姿，双臂明显外展离开身体（为后续绑骨，禁止贴身下垂），双脚分开与肩同宽；全身完整入画，必须看到鞋和双脚，禁止半身或裁到大腿；正面视角，纯白背景，均匀柔光，写实插画，人物居中，单人，无道具，无文字水印。衣摆离地约数厘米，不拖地。硬性要求：马甲与衣服均无文字，禁止手持物品或标牌。",
    assetId: "7a9f1e21-8c34-4d52-a10f-b0000000000f",
    ready: true,
  },
  {
    id: "volunteer-f",
    role: "volunteer",
    gender: "female",
    roleLabel: "志愿者",
    crowdType: "volunteer",
    prompt: "一位年轻东亚女性的全身立绘，活动志愿者造型：简洁休闲T恤与长裤，外穿红色或青绿色志愿者马甲（马甲为纯色块、无文字），运动鞋，马尾或短发；中性A字站姿，双臂明显外展离开身体（为后续绑骨，禁止贴身下垂），双脚分开与肩同宽；全身完整入画，必须看到鞋和双脚，禁止半身或裁到大腿；正面视角，纯白背景，均匀柔光，写实插画，人物居中，单人，无道具，无文字水印。衣摆离地约数厘米，不拖地。硬性要求：马甲与衣服均无文字，禁止手持物品或标牌。",
    assetId: "7a9f1e21-8c34-4d52-a110-b00000000010",
    ready: true,
  },
];

/** 某岗位下的男女两槽。 */
export function laborSlotsForRole(role: LaborRoleId): LaborGenderSlot[] {
  return LABOR_GENDER_SLOTS.filter((slot) => slot.role === role);
}

/** 某一性别下的全部槽位。 */
export function laborSlotsForGender(gender: LaborGender): LaborGenderSlot[] {
  return LABOR_GENDER_SLOTS.filter((slot) => slot.gender === gender);
}

/** 按预留 assetId 反查槽位。 */
export function laborSlotByAssetId(assetId: string): LaborGenderSlot | undefined {
  return LABOR_GENDER_SLOTS.find((slot) => slot.assetId === assetId);
}

/** 本批预留 assetId 集合，便于与既有古风漫游槽区分。 */
export const LABOR_GENDER_ASSET_IDS: ReadonlySet<string> = new Set(
  LABOR_GENDER_SLOTS.map((slot) => slot.assetId),
);
