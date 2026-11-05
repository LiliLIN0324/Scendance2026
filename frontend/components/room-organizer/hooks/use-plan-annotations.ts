import { useCallback, useMemo, useReducer } from 'react';
import {
  addAnnotation as addAnnotationToDraft,
  createEmptyPlanDraft,
  type LayoutPlanDraft,
  type PlanAnnotation,
  type PlanAnnotationKind,
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
}

const initialState: PlanAnnotationState = {
  draft: null,
  drawMode: 'off',
  annotationsVisible: true,
  nextId: 1,
};

type Action =
  | { type: 'START_DRAFT' }
  | { type: 'CLEAR_DRAFT' }
  | { type: 'REPLACE_DRAFT'; draft: LayoutPlanDraft }
  | { type: 'TOGGLE_VISIBLE' }
  | { type: 'SET_DRAW_MODE'; mode: PlanDrawMode }
  | { type: 'ADD_ANNOTATION'; annotation: PlanAnnotation };

function reducer(state: PlanAnnotationState, action: Action): PlanAnnotationState {
  switch (action.type) {
    case 'START_DRAFT':
      // 重新开一份草案，绘制模式默认关、可见性保持。
      return {
        ...state,
        draft: createEmptyPlanDraft(),
        nextId: 1,
        drawMode: 'off',
      };
    case 'CLEAR_DRAFT':
      if (!state.draft) return state;
      // 取消/换一版必须整份关闭（draft 置 null），否则空草案会永远卡在「还没有阶段」。
      return { ...state, draft: null, drawMode: 'off' };
    case 'REPLACE_DRAFT':
      return { ...state, draft: action.draft, nextId: 1 };
    case 'TOGGLE_VISIBLE':
      return { ...state, annotationsVisible: !state.annotationsVisible };
    case 'SET_DRAW_MODE':
      return { ...state, drawMode: action.mode };
    case 'ADD_ANNOTATION': {
      if (!state.draft) return state;
      return {
        ...state,
        draft: addAnnotationToDraft(state.draft, action.annotation),
        nextId: state.nextId + 1,
      };
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
      if (!state.draft || points.length === 0) return;
      const id = `ann-${state.nextId}`;
      // 默认挂到现有最大阶段号；没有阶段时落 1。
      const stageNo = state.draft.stages.reduce(
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

  const annotations = useMemo(
    () => (state.draft ? state.draft.annotations : []),
    [state.draft],
  );

  return {
    draft: state.draft,
    drawMode: state.drawMode,
    annotationsVisible: state.annotationsVisible,
    annotations,
    startDraft,
    clearDraft,
    replaceDraft,
    toggleVisible,
    setDrawMode,
    addAnnotationFromPoints,
  };
}
