/**
 * 判据执行器的输入类型（2026-11-18）。
 *
 * 刻意不 import `supabase/functions/_shared/site-plan.ts`：
 * 1) 那份 schema 属于契约面，改动需要 review；这里只依赖它的结构形状。
 * 2) 结构类型让 `SitePlanData` 与测试夹具都能直接传进来，不需要先 zod 解析。
 *
 * 坐标系：与 site-plan 一致，单位米，1 格 = 1 m。旋转只支持 0/90/180/270
 * （`docs/plans/2026-11-05-activity-space-norms.md` §0.2）。
 */

export type Point = { x: number; y: number };

export type Rect = { minX: number; minY: number; maxX: number; maxY: number };

/** 判据文件里的阈值形状（与 data/agent-corpus/layout-assertions.json 对齐）。 */
export type CorpusThreshold = {
  label: string;
  m?: number;
  m2?: number;
  count?: number;
  value?: number;
  cells?: number;
  rounding?: 'ceil' | 'floor';
  unit: string;
};

export type CorpusRule = {
  id: string;
  scope: string;
  zh: string;
  en: string;
  thresholds: CorpusThreshold[];
  formula?: string;
  spec?: string;
  check: string;
  severity: 'hard' | 'warn' | 'ideal';
  runtime: 'static' | 'runtime';
  sourceLevel: 'A' | 'B' | 'C';
  source: string;
  conflictWith: string[];
  promptCore: boolean;
};

export type LayoutFacility = {
  id: string;
  templateId: string;
  name: string;
  position: Point;
  rotationDeg: number;
  size: { width: number; depth: number };
};

export type LayoutZone = {
  id: string;
  semantic: string;
  name: string;
  polygon: Point[];
};

export type LayoutNode = {
  id: string;
  kind: 'entry' | 'exit' | 'both';
  name: string;
  position: Point;
};

/** 场地上的硬障碍（建筑足迹、水域面等），来自场地证据而不是 plan 本身。 */
export type LayoutObstacle = {
  id: string;
  kind: 'building' | 'water' | 'barrier';
  name: string;
  polygon: Point[];
};

export type Layout = {
  facilities: LayoutFacility[];
  zones?: LayoutZone[];
  nodes?: LayoutNode[];
  obstacles?: LayoutObstacle[];
  /** 场地边界；缺省时按所有几何外接框兜底，MKT-10 会随之标 skipped。 */
  boundary?: Point[];
  /** 预计人数；缺省时密度类判据返回 skipped 而不是猜。 */
  people?: number;
  /** 舞台台面高度（米）；缺省按 0 计算首排退距，回执里会注明。 */
  stageHeightM?: number;
};

/**
 * 回执。
 * - pass / violation：本条判据真的算了；
 * - skipped：规则可算，但输入缺料（没有人数、没有舞台区……）；必须带 reason；
 * - unsupported：该判据需要当前模型不具备的信息（栅格、水深、树冠、传感器……），
 *   **不参与判定**，也不许被当成通过。
 */
export type ReceiptStatus = 'pass' | 'violation' | 'skipped' | 'unsupported';

export type Receipt = {
  ruleId: string;
  severity: CorpusRule['severity'];
  status: ReceiptStatus;
  actual: string;
  expected: string;
  detail: string;
  objectIds: string[];
  reason?: string;
};

export type Evaluation = {
  receipts: Receipt[];
  unsupported: { ruleId: string; reason: string }[];
};
