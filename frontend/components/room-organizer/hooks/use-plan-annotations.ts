import { useCallback, useMemo, useReducer } from 'react';
import {
  addAnnotation as addAnnotationToDraft,
  createEmptyPlanDraft,
  DOOR_DEFAULT_WIDTH_M,
  type LayoutPlanDraft,
  type PlanAnnotation,
  type PlanAnnotationKind,
  type PlanDoorWall,
  type PlanPoint,
  type ZoneSemanticType,
} from '../../../lib/plan-annotation';

/** 绘制模式：off 表示不在画标注；其余三种对应标注 kind。 */
export type PlanDrawMode = 'off' | PlanAnnotationKind;

interface PlanAnnotationState {
  draft: LayoutPlanDraft | null;
  drawMode: PlanDrawMode;
  annotationsVisible: boolean;
  /** 单调递增的标注 id 计数器，避免同一草案里 id 撞车。 */
  nextId: number;
  /**
   * 结论失效计数器：任何 draft/annotation 变更 action 都 +1。
   * 消费侧（评分 / reachability / 门弧检查）依赖它重算，旧结论标记 stale。
   * TOGGLE_VISIBLE / SET_DRAW_MODE 这类 UI 偏好不 +1，因为不改数据。
   */
  revision: number;
}

const initialState: PlanAnnotationState = {
  draft: null,
  drawMode: 'off',
  annotationsVisible: true,
  nextId: 1,
  revision: 0,
};

type Action =
  | { type: 'START_DRAFT' }
  | { type: 'CLEAR_DRAFT' }
  | { type: 'REPLACE_DRAFT'; draft: LayoutPlanDraft }
  | { type: 'TOGGLE_VISIBLE' }
  | { type: 'SET_DRAW_MODE'; mode: PlanDrawMode }
  | { type: 'ADD_ANNOTATION'; annotation: PlanAnnotation }
  | { type: 'ADD_ZONE_RECTS'; items: readonly ZoneRectItem[] };

/** 批量落区的输入形状：zone 类型 + 标签 + 中心矩形（x/z 是中心，width/depth 是米）。 */
export interface ZoneRectItem {
  zoneType: ZoneSemanticType;
  label: string;
  rect: { x: number; z: number; width: number; depth: number };
}

function bump(state: PlanAnnotationState, next: Omit<PlanAnnotationState, 'revision'>): PlanAnnotationState {
  return { ...next, revision: state.revision + 1 };
}

function reducer(state: PlanAnnotationState, action: Action): PlanAnnotationState {
  switch (action.type) {
    case 'START_DRAFT':
      // 重新开一份草案，绘制模式默认关、可见性保持。
      return bump(state, {
        draft: createEmptyPlanDraft(),
        nextId: 1,
        drawMode: 'off',
        annotationsVisible: state.annotationsVisible,
      });
    case 'CLEAR_DRAFT':
      if (!state.draft) return state;
      // 取消/换一版必须整份关闭（draft 置 null），否则空草案会永远卡在「还没有阶段」。
      return bump(state, { ...state, draft: null, drawMode: 'off' });
    case 'REPLACE_DRAFT':
      return bump(state, { ...state, draft: action.draft, nextId: 1 });
    case 'TOGGLE_VISIBLE':
      // 可见性是 UI 偏好，不改数据，不 bump revision。
      return { ...state, annotationsVisible: !state.annotationsVisible };
    case 'SET_DRAW_MODE':
      // 绘制模式也是 UI 偏好，不 bump revision。
      return { ...state, drawMode: action.mode };
    case 'ADD_ANNOTATION': {
      // 调用方没先 startDraft 也能直接落（例如「回好自动落区」在一个事件回调里连落多个矩形）：
      // reducer 自己补一份空草案，避免闭包里 state.draft 还是 null 被静默丢弃。
      const base = state.draft ?? createEmptyPlanDraft();
      const nextDraft = addAnnotationToDraft(base, action.annotation);
      return bump(state, {
        ...state,
        draft: nextDraft,
        nextId: state.nextId + 1,
      });
    }
    case 'ADD_ZONE_RECTS': {
      // 「回好自动落区」专用：一次 dispatch 落多个矩形，id 在 reducer 里连续自增，
      // 避免闭包里 state.nextId 还是旧值导致同帧多个 annotation id 撞车。
      if (action.items.length === 0) return state;
      const base = state.draft ?? createEmptyPlanDraft();
      const stageNo = base.stages.reduce((max, s) => Math.max(max, s.stageNo), 0) || 1;
      let draft = base;
      let nextId = state.nextId;
      for (const item of action.items) {
        const p1 = { x: item.rect.x - item.rect.width / 2, z: item.rect.z - item.rect.depth / 2 };
        const p2 = { x: item.rect.x + item.rect.width / 2, z: item.rect.z + item.rect.depth / 2 };
        const x = Math.min(p1.x, p2.x);
        const z = Math.min(p1.z, p2.z);
        draft = addAnnotationToDraft(draft, {
          id: `ann-${nextId}`,
          kind: 'zone',
          label: item.label,
          stageNo,
          geometry: {
            kind: 'rect',
            x,
            z,
            width: Math.abs(p2.x - p1.x),
            depth: Math.abs(p2.z - p1.z),
          },
          zoneType: item.zoneType,
        });
        nextId += 1;
      }
      return bump(state, { ...state, draft, nextId });
    }
    default:
      return state;
  }
}

export interface UsePlanAnnotationsResult {
  draft: LayoutPlanDraft | null;
  drawMode: PlanDrawMode;
  annotationsVisible: boolean;
  /** 直接喂给 2D 覆盖渲染层的标注数组。 */
  annotations: PlanAnnotation[];
  /**
   * 结论失效计数器：任何 draft/annotation 变更都 +1。
   * 消费侧 useEffect 依赖它重跑评分 / reachability / 门弧检查；
   * 旧结论在重算完成前应标记为 stale / 「核验中」。
   */
  revision: number;
  startDraft(): void;
  clearDraft(): void;
  replaceDraft(draft: LayoutPlanDraft): void;
  toggleVisible(): void;
  setDrawMode(mode: PlanDrawMode): void;
  /**
   * 从一组米制点构造标注并落进当前草案。
   * - zone：取两个对角点生成矩形；
   * - route：整条折线原样落地；
   * - measure：取首尾两点成测距段。
   * 没有当前草案时静默丢弃（调用方应先 startDraft）。
   */
  addAnnotationFromPoints(
    points: PlanPoint[],
    kind: PlanAnnotationKind,
    label: string,
    zoneType?: ZoneSemanticType,
  ): void;
  /**
   * 批量落 zone 矩形（「回好自动落区」专用）。
   * 一次 dispatch 落多个矩形，id 在 reducer 里连续自增；没 draft 时自动建一份空草案。
   * drawMode 保持不变，不强迫用户进绘制模式。
   */
  addZoneRects(items: readonly ZoneRectItem[]): void;
  /**
   * 落一扇用户在画布上真实画的门（inferred 缺省 = 真门，非 withDefaultDoor 推测）。
   * 落地后 draft_unverified 小字与推测门虚线随之消失，评分层走 verified 门弧检查。
   * 没 draft 时由 reducer 自动补一份空草案（同 ADD_ANNOTATION 语义）。
   */
  addDoorAnnotation(door: { wall: PlanDoorWall; position: number; widthM?: number }): void;
}

/**
 * 第 7.5 批「规划标注层」本地态：草案、绘制模式、显示开关。
 * 不接 zustand，纯 useReducer；「换一版」由 replaceDraft / clearDraft 完成，
 * RoomLayout 完全不参与，因此规划反复横跳不会污染家具。
 */
export function usePlanAnnotations(): UsePlanAnnotationsResult {
  const [state, dispatch] = useReducer(reducer, initialState);

  const startDraft = useCallback(() => dispatch({ type: 'START_DRAFT' }), []);
  const clearDraft = useCallback(() => dispatch({ type: 'CLEAR_DRAFT' }), []);
  const replaceDraft = useCallback(
    (draft: LayoutPlanDraft) => dispatch({ type: 'REPLACE_DRAFT', draft }),
    [],
  );
  const toggleVisible = useCallback(() => dispatch({ type: 'TOGGLE_VISIBLE' }), []);
  const setDrawMode = useCallback(
    (mode: PlanDrawMode) => dispatch({ type: 'SET_DRAW_MODE', mode }),
    [],
  );

  const addAnnotationFromPoints = useCallback(
    (points: PlanPoint[], kind: PlanAnnotationKind, label: string, zoneType?: ZoneSemanticType) => {
      if (points.length === 0) return;
      // draft 为 null 时由 reducer 自动补一份空草案（见 ADD_ANNOTATION case），
      // 所以这里不再 early-return；nextId 读闭包，连续多个 annotation 会在 reducer 里自增。
      const id = `ann-${state.nextId}`;
      // 默认挂到现有最大阶段号；没有阶段时落 1。
      const stageNo = state.draft?.stages.reduce(
        (max, s) => Math.max(max, s.stageNo),
        0,
      ) || 1;

      let geometry: PlanAnnotation['geometry'];
      if (kind === 'zone') {
        const [p1, p2] = points;
        const x = Math.min(p1.x, p2.x);
        const z = Math.min(p1.z, p2.z);
        geometry = {
          kind: 'rect',
          x,
          z,
          width: Math.abs(p2.x - p1.x),
          depth: Math.abs(p2.z - p1.z),
        };
      } else if (kind === 'route') {
        geometry = { kind: 'polyline', points: [...points] };
      } else {
        const from = points[0];
        const to = points[points.length - 1];
        geometry = { kind: 'measure', from, to };
      }

      const annotation: PlanAnnotation = {
        id,
        kind,
        label,
        stageNo,
        geometry,
        ...(kind === 'zone' && zoneType ? { zoneType } : {}),
      };
      dispatch({ type: 'ADD_ANNOTATION', annotation });
    },
    [state.draft, state.nextId],
  );

  const addZoneRects = useCallback(
    (items: readonly ZoneRectItem[]) => {
      if (items.length === 0) return;
      dispatch({ type: 'ADD_ZONE_RECTS', items });
    },
    [],
  );

  const addDoorAnnotation = useCallback(
    (door: { wall: PlanDoorWall; position: number; widthM?: number }) => {
      const id = `ann-${state.nextId}`;
      const stageNo = state.draft?.stages.reduce(
        (max, s) => Math.max(max, s.stageNo),
        0,
      ) || 1;
      const annotation: PlanAnnotation = {
        id,
        kind: 'door',
        label: '主入口门',
        stageNo,
        // 用户真实画的门不带 inferred——渲染层实线门弧、评分层 verified。
        geometry: {
          kind: 'door',
          wall: door.wall,
          position: door.position,
          widthM: door.widthM ?? DOOR_DEFAULT_WIDTH_M,
        },
      };
      dispatch({ type: 'ADD_ANNOTATION', annotation });
    },
    [state.draft, state.nextId],
  );

  const annotations = useMemo(
    () => (state.draft ? state.draft.annotations : []),
    [state.draft],
  );

  return {
    draft: state.draft,
    drawMode: state.drawMode,
    annotationsVisible: state.annotationsVisible,
    annotations,
    revision: state.revision,
    startDraft,
    clearDraft,
    replaceDraft,
    toggleVisible,
    setDrawMode,
    addAnnotationFromPoints,
    addZoneRects,
    addDoorAnnotation,
  };
}
