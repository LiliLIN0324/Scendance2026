/**
 * layout ↔ plan 双向镜像写点冻结登记（S3-3，2026-11-26 裁定）。
 *
 * 第一性原理（用户拍板，不造 layout↔plan 互转层）：
 * 1. 互转层是永久维护成本，还会产出「看起来对、其实不是源数据」的显示，比留旧壳体更糟。
 * 2. 下列壳体回写点展示/承载的是壳体自己的内容（zones/items 坐标、壳体 2D 渲染、
 *    壳体锚点帧），plan 里没有同构字段；写侧现在仍以 layout 为准，提前切 plan 反而显示陈旧数据。
 * 3. 壳体本身是「读取兼容层 + 最后单独一刀删」：壳体内部回写随壳一起退役，不迁、不补互转。
 *
 * 冻结口径：
 * - **禁止新增**任何把 plan 派生回写进 layout、或把 layout 几何回写进 plan 的双向镜像写点；
 *   新代码需要跨双源取数时，先在本模块登记方向与归属，经评审后再落。
 * - 标 `retire-with-shell` 的既有回写点：随壳体整刀退役那一刀一并移除并补套件，本批只标注、不停写。
 * - 标 `positive-source-ground` 的：`plan.ground` 是正源写入（非几何镜像），保留；layout.id/name
 *   仅作身份/元信息透传，不回写几何。
 */

/** 回写方向：plan 派生投影进壳体 layout；或壳体内容写进 plan。 */
export type MirrorDirection = 'plan-to-layout' | 'layout-to-plan';

/** 归属处置：随壳整刀删；或属于 plan 正源写入、保留在案。 */
export type MirrorDisposition = 'retire-with-shell' | 'positive-source-ground';

export interface MirrorWritePoint {
  /** 稳定登记键（不用行号，行号漂移不影响清单）。 */
  id: string;
  /** 相对 frontend/ 的文件路径。 */
  file: string;
  /** 函数 / 代码段描述，便于定位。 */
  location: string;
  direction: MirrorDirection;
  /** 被写进对方那份的字段。 */
  fields: readonly string[];
  disposition: MirrorDisposition;
  note: string;
  /**
   * 仍在读这份壳字段的消费方（文件:角色）。退役前不得删写侧——
   * 提前切 plan 会显示陈旧数据。消费者本身也是壳，随整刀一起退役。
   */
  consumers: readonly string[];
  /** 退役批次归属：retire-with-shell 点随壳整刀；正源点 keep。 */
  retireBatch: 'shell-whole-cut' | 'keep';
}

/**
 * 既有镜像写点全量清单。新增双向写点必须先补登记并通过评审；测试以此清单为准核对未登记新增。
 */
export const MIRROR_WRITE_POINTS: readonly MirrorWritePoint[] = [
  {
    id: 'm1-ground-basemap-anchor',
    file: 'components/room-organizer/room-organizer.tsx',
    location: 'applyOutdoorGroundBasemap 拼图回调',
    direction: 'plan-to-layout',
    fields: ['sceneAnchor'],
    disposition: 'retire-with-shell',
    note: 'plan.anchor/边界拼出贴地帧后，派生 sceneAnchor 写回 layout；已有 sceneAnchor 则不动。',
    consumers: [
      'three/research-basemap.ts: 3D 调研底图取锚点',
      'lib/scan-placement.ts: 放置锚点（几何基线，禁改）',
      'lib/scene-anchor.ts: sceneAnchorOf 读取与世界投影',
      'lib/venue-scale-basis.ts / event-operations.ts / scene-handoff.ts: 评审·导出·任务·交接读点',
      'panels/agent-panel.tsx:2045: agent 提案场地尺度',
      'room-organizer.tsx:1783: 读侧 outdoorPlan.anchor 回退到 layout.sceneAnchor',
      'lib/schema.ts: 旧快照持久化校验',
    ],
    retireBatch: 'shell-whole-cut',
  },
  {
    id: 'm2-research-area-anchor',
    file: 'components/room-organizer/room-organizer.tsx',
    location: '研究区选址 effect（researchArea 落壳）',
    direction: 'plan-to-layout',
    fields: ['sceneAnchor', 'researchArea'],
    disposition: 'retire-with-shell',
    note: '研究区圈画后把 area.center 写成 sceneAnchor 并入 layout；锚点正源应是 plan.anchor。',
    consumers: [
      'three/research-basemap.ts: 3D 调研底图取 researchArea',
      'lib/scan-placement.ts:129: 放置回退到 researchArea.center（几何基线，禁改）',
      'lib/west-lake-basemap.ts: 西湖调研底图读写',
      'lib/venue-scale-basis.ts / project-manifest.ts: 评审·导出·素材引用读点',
      'panels/agent-panel.tsx:2033-2038: agent 提案回写 researchArea',
      'lib/amap-venue.ts:587/665 + ground-basemap.ts: 地图定位矩形与底图样式',
      'panels/space-panel.tsx:462: 返回地图按钮文案',
      'lib/schema.ts: 旧快照持久化校验',
    ],
    retireBatch: 'shell-whole-cut',
  },
  {
    id: 'm3-orient-shell-north-up',
    file: 'components/room-organizer/lib/amap-venue.ts',
    location: 'orientMapShellNorthUp',
    direction: 'plan-to-layout',
    fields: ['mapGroundFrame', 'sceneAnchor'],
    disposition: 'retire-with-shell',
    note: '打开存档翻北时由登记帧派生壳体 mapGroundFrame 与 sceneAnchor。',
    consumers: [
      'lib/schema.ts:503: parseStoredLayout 清理管线调用 orientMapShellNorthUp（读侧兼容）',
      'lib/scene-anchor.ts:28: mapGroundFrame 反推 sceneAnchor 的逆推读取',
    ],
    retireBatch: 'shell-whole-cut',
  },
  {
    id: 'm4-satellite-ground-patch',
    file: 'components/room-organizer/lib/amap-venue.ts',
    location: 'ensureSatelliteGround / ensurePlanGround',
    direction: 'plan-to-layout',
    fields: ['mapGroundFrame', 'sceneAnchor'],
    disposition: 'retire-with-shell',
    note: '旧地图取图返回的壳体底图补丁，未锚定时附壳体帧与 sceneAnchor。',
    consumers: [
      'lib/amap-venue.ts:754/772/778/798/801/823: legacyGroundOf.mapGroundFrame 回退与补丁落壳',
      'lib/scene-anchor.ts: mapGroundFrame 逆推 sceneAnchor',
    ],
    retireBatch: 'shell-whole-cut',
  },
  {
    id: 'm5-venue-from-pick',
    file: 'components/room-organizer/lib/amap-venue.ts',
    location: 'createVenueFromPick',
    direction: 'plan-to-layout',
    fields: ['sceneAnchor'],
    disposition: 'retire-with-shell',
    note: '圈画选址落壳：展开壳体 plan.layout 后附 sceneAnchor；地面定位另走 plan.ground 正源。',
    consumers: [
      'panels/agent-panel.tsx:2022: agent 选址落壳生产调用',
      '产物 sceneAnchor 下游同 m1 读链（research-basemap / scan-placement / scene-anchor / 评审导出 / schema）',
    ],
    retireBatch: 'shell-whole-cut',
  },
  {
    id: 'g1-ground-basemap-write',
    file: 'components/room-organizer/room-organizer.tsx',
    location: 'applyOutdoorGroundBasemap 画布未挂载时直写记录',
    direction: 'layout-to-plan',
    fields: ['plan.ground'],
    disposition: 'positive-source-ground',
    note: '只写 plan.ground；recordId/name 取 layout.id/name 作身份与元信息透传，不回写几何。',
    consumers: [],
    retireBatch: 'keep',
  },
  {
    id: 'g2-ground-sync-write',
    file: 'components/room-organizer/room-organizer.tsx',
    location: 'planGroundSync effect 首帧迁移',
    direction: 'layout-to-plan',
    fields: ['plan.ground'],
    disposition: 'positive-source-ground',
    note: '旧 layout 底图字节迁进 plan.ground 后整键擦除 layout 镜像；方向只 to-plan，无反向投影。',
    consumers: [],
    retireBatch: 'keep',
  },
  {
    id: 'g3-agent-ground-write',
    file: 'components/room-organizer/panels/agent-panel.tsx',
    location: '助手落贴地底图回写',
    direction: 'layout-to-plan',
    fields: ['plan.ground'],
    disposition: 'positive-source-ground',
    note: 'writeGroundToPlan 只写 plan.ground；id/name 透传身份，不回写几何。',
    consumers: [],
    retireBatch: 'keep',
  },
];

/** 冻结开关：true = 禁止新增未登记的双向镜像写点。 */
export const MIRROR_WRITE_FROZEN = true;

/** 按处置过滤：随壳退役的 plan→layout 回写点。 */
export function shellRetiredMirrorPoints(): readonly MirrorWritePoint[] {
  return MIRROR_WRITE_POINTS.filter(point => point.disposition === 'retire-with-shell');
}
