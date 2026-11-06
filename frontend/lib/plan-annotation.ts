/**
 * 第 7.5 批「规划标注层」纯数据与纯函数。
 *
 * 设计红线（见 docs/plans/smart-build-next-phase-2026-11-05.md §10.2）：
 * - 标注与阶段计划独立在 LayoutPlanDraft 里，**不进 RoomLayout 主树、不进必填 wire**；
 * - 纯函数、不可变更新，便于「换一版计划」时整份撤销并断言 RoomLayout 未被改动；
 * - 坐标一律米制、房间中心为原点（与 FurnitureItem.position 同一套约定）。
 */

export type PlanAnnotationKind = 'zone' | 'route' | 'measure';

/** 米制二维点（x 向右，z 向下，房间中心为原点）。 */
export interface PlanPoint {
  x: number;
  z: number;
}

/** 标注几何：矩形区域 / 折线动线 / 两点测距，三种互斥形态。 */
export type PlanAnnotationGeometry =
  | { kind: 'rect'; x: number; z: number; width: number; depth: number }
  | { kind: 'polyline'; points: PlanPoint[] }
  | { kind: 'measure'; from: PlanPoint; to: PlanPoint };

export interface PlanAnnotation {
  id: string;
  kind: PlanAnnotationKind;
  /** 中文标签，如「主舞台区」「宾客入场动线」。 */
  label: string;
  geometry: PlanAnnotationGeometry;
  /** 对应计划卡第几阶段，1-based。 */
  stageNo: number;
}

export interface LayoutPlanStage {
  stageNo: number;
  /** 中文阶段名，如「动线与退界」。 */
  title: string;
  /** 空间关系理由，如「在前广场与舞台之间」。 */
  rationale: string;
  annotationIds: string[];
}

export interface LayoutPlanDraft {
  id: string;
  stages: LayoutPlanStage[];
  annotations: PlanAnnotation[];
  createdAt: number;
}

/** 活动行业预设标签（key 给 agent / 代码用，value 是画布与卡片上显示的中文）。 */
export const ANNOTATION_PRESET_LABELS: Record<string, string> = {
  stage: '主舞台区',
  roundtable: '圆桌区',
  checkin: '签到区',
  prep: '备餐区',
  guest_route: '宾客动线',
  fire_route: '消防疏散',
  reserved: '预留区',
};

let draftIdCounter = 0;

/** 生成一份空草案（无阶段、无标注）。 */
export function createEmptyPlanDraft(): LayoutPlanDraft {
  draftIdCounter += 1;
  const id = `plan-${Date.now().toString(36)}-${draftIdCounter}`;
  return {
    id,
    stages: [],
    annotations: [],
    createdAt: Date.now(),
  };
}

/** 不可变追加一条标注，返回新 draft；同 stageNo 的阶段自动归集，没有就补一个默认阶段。 */
export function addAnnotation(
  draft: LayoutPlanDraft,
  annotation: PlanAnnotation,
): LayoutPlanDraft {
  const annotations = [...draft.annotations, annotation];
  const existingStage = draft.stages.find((stage) => stage.stageNo === annotation.stageNo);
  const stages = existingStage
    ? draft.stages.map((stage) =>
      stage.stageNo === annotation.stageNo
        ? { ...stage, annotationIds: [...stage.annotationIds, annotation.id] }
        : stage,
    )
    : [
      ...draft.stages,
      {
        stageNo: annotation.stageNo,
        title: `第 ${annotation.stageNo} 阶段`,
        rationale: '画布标注自动归集',
        annotationIds: [annotation.id],
      },
    ];
  return {
    ...draft,
    annotations,
    stages,
  };
}

/** 不可变删除一条标注，返回新 draft；id 不存在时原样返回。 */
export function removeAnnotation(
  draft: LayoutPlanDraft,
  id: string,
): LayoutPlanDraft {
  if (!draft.annotations.some((a) => a.id === id)) return draft;
  return {
    ...draft,
    annotations: draft.annotations.filter((a) => a.id !== id),
  };
}

/** 清空所有阶段与标注，但保留 draft.id 与 createdAt（用于「换一版」）。 */
export function clearAllAnnotations(draft: LayoutPlanDraft): LayoutPlanDraft {
  return {
    ...draft,
    stages: [],
    annotations: [],
  };
}

/**
 * 测距类标注返回两端点的欧氏距离（米）；其余 kind 返回 NaN。
 * 浮点尾数不做取整——距离由 formatMeasureLabel 在展示层对齐 0.1 m。
 */
export function measureDistanceM(annotation: PlanAnnotation): number {
  if (annotation.geometry.kind !== 'measure') return NaN;
  const { from, to } = annotation.geometry;
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  return Math.hypot(dx, dz);
}

/** 把两点距离对齐到 0.1 m 半格并格式化为「12.4 m」。 */
export function formatMeasureLabel(from: PlanPoint, to: PlanPoint): string {
  const raw = Math.hypot(to.x - from.x, to.z - from.z);
  const snapped = Math.round(raw * 10) / 10;
  return `${snapped.toFixed(1)} m`;
}
