/**
 * 统一交付面板（户外场地方案）——纯常量与可见性判定。
 *
 * 2026-11-20：本文件原先的首访三步引导（GUIDE_STEPS / GUIDE_STEP_CONTENT）已随旧气泡
 * 组件退役，上手引导统一走 onboarding/（一条状态源、可续播可重看）。这里只剩交付
 * 面板的口径：段对谁可见、导出项接通了没有。文件名沿用，docs/evidence/H4b 的引用不失效。
 */

/* ---------------- 统一交付面板（户外场地方案） ---------------- */

/**
 * 交付对象（第一期轻量权限）：按对象打包可见动作，不依赖登录角色。
 * - client 对外交付：对方只读查看，不改动本地方案；
 * - review 送评审方：可在方案上落钉、完成评审，回执收进 Bingo；
 * - internal 内部协作：含工作资料与导出，仅团队内部使用。
 */
export const DELIVERY_AUDIENCES = [
  { id: 'client', label: '发给客户', note: '对外交付：对方只读查看，不改动本地方案' },
  { id: 'review', label: '送评审方', note: '送评审方：可在方案上落钉、完成评审，回执收进 Bingo' },
  { id: 'internal', label: '内部协作', note: '内部协作：含工作资料与导出，仅团队内部使用' },
] as const;

export type DeliveryAudience = (typeof DELIVERY_AUDIENCES)[number]['id'];

/** 面板三段：段对哪些交付对象可见（audiences 即定稿 data-aud 清单）。 */
export const DELIVERY_SEGMENTS = [
  { id: 'online', title: '在线分享', tag: '在线链接 · 不改本地方案', audiences: ['client', 'review', 'internal'] },
  { id: 'review', title: '送审 Bingo', tag: '评审留言与回执收进 Bingo 面板', audiences: ['review', 'internal'] },
  { id: 'export', title: '导出资料', tag: '勾选要带走的文件，参数在展开层选', audiences: ['client', 'internal'] },
] as const;

export type DeliverySegmentId = (typeof DELIVERY_SEGMENTS)[number]['id'];

/** 某段对给定交付对象是否可见（纯函数，便于测试）。 */
export function segmentVisible(
  segment: { audiences: readonly DeliveryAudience[] },
  audience: DeliveryAudience,
): boolean {
  return segment.audiences.includes(audience);
}

export type DeliveryExportId = 'png' | 'csv' | 'geojson' | 'pdf' | 'album' | 'handoff';

/** 导出二级参数组（视角 / 画质）；选项先记录选择，档位映射随后端能力补齐。 */
export interface DeliveryExportParamGroup {
  label: string;
  optionsKey: 'view' | 'scale';
  options: string[];
}

export interface DeliveryExportItem {
  id: DeliveryExportId;
  label: string;
  desc: string;
  /** 户外后端是否已接通；未通项进「规划中」折叠区置灰，不绑可点动作。 */
  enabled: boolean;
  /** 未通项的待接通说明。 */
  disabledHint?: string;
  params?: DeliveryExportParamGroup[];
}

/**
 * 导出清单：enabled 按户外真实后端口径——本机已接只读链接 / PNG / CSV / GeoJSON / PDF；
 * 机位册（四机位 three 抓帧）与交接包（任务表 / 物料台账 / 点验资料）尚缺户外对应链路，禁用占位。
 * 注：原型稿曾把 CSV / GeoJSON / PDF 标为规划中，现三项后端已接通，上移到可勾选主清单。
 */
export const DELIVERY_EXPORT_ITEMS: DeliveryExportItem[] = [
  {
    id: 'png',
    label: 'PNG 单帧',
    desc: '按所选机位出一张成图',
    enabled: true,
    params: [
      { label: '视角', optionsKey: 'view', options: ['跟随当前', '整体', '俯视', '正面', '对角'] },
      { label: '画质', optionsKey: 'scale', options: ['1080p', '4K', '6K'] },
    ],
  },
  { id: 'csv', label: '物料清单 CSV', desc: '分区、设施、动线、人员清单，Excel 直开', enabled: true },
  { id: 'geojson', label: 'GeoJSON 几何', desc: '分区与动线几何导出，GIS 可用', enabled: true },
  { id: 'pdf', label: 'PDF 演示稿', desc: '给客户讲解的排版稿', enabled: true },
  {
    id: 'album',
    label: '机位册 HTML',
    desc: '整体 / 俯视 / 正面 / 对角四机位现场出图，附离线图册',
    enabled: false,
    disabledHint: '户外四机位抓帧链路待接通',
    params: [{ label: '画质', optionsKey: 'scale', options: ['1080p', '4K', '6K'] }],
  },
  {
    id: 'handoff',
    label: '交接包 HTML',
    desc: '平面 + 任务表 + 物料工作单 + 点验资料',
    enabled: false,
    disabledHint: '任务表 / 物料 / 点验资料链路待接通',
  },
];

/** 已接通、可勾选导出的项。 */
export const enabledDeliveryExports = DELIVERY_EXPORT_ITEMS.filter(item => item.enabled);
/** 未接通、收进规划中折叠区的项。 */
export const futureDeliveryExports = DELIVERY_EXPORT_ITEMS.filter(item => !item.enabled);

