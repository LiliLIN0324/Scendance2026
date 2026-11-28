'use client';

import { createContext, useContext, useMemo, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import type { UseHistoryResult } from '../hooks/use-history';
import type { LayoutActions } from '../hooks/use-layout-state';
import type { PlanActions } from '../lib/plan-facility-actions';
import type { SoundCue } from '../lib/sounds';
import type { FloorLayout, GameMode, RoomLayout, ViewSettings } from '../lib/types';
import type { SitePlanData } from '../../../../supabase/functions/_shared/site-plan';
import type { SidecarKind } from '../../../lib/sidecar-records';

export interface RoomEditorContextValue {
  // Session/project identity: single source derived at the editor entry.
  // Persistent buckets and consistency checks read this, not `layout.id` with a `'local'` fallback.
  readonly projectId: string;

  // Layout state
  readonly layout: RoomLayout;
  readonly activeFloor: FloorLayout;
  readonly activeFloorIndex: number;
  readonly actions: LayoutActions;

  // Outdoor plan positive source (S3): the plan the outdoor canvas edits.
  // `null` for the legacy local draft without a bound plan record.
  readonly outdoorPlan: SitePlanData | null;

  // D6-2：侧车独立记录保存成功后，把 recordId 挂回 plan 正源的 ref 字段。
  // 写路收敛到 context 动作；独占壳是唯一 plan 写路，面板/Agent 不直写 plan 存储。
  commitSidecarRef(kind: SidecarKind, recordId: string): void;

  // B-1：plan facility/zone CRUD 写入口通道。无绑定 plan（legacy 草稿）时为 null，
  // 沿用旧通道，不发明 plan 写入；planRevision 是编辑器内结论失效计数，不进 plan JSON 契约。
  readonly planActions: PlanActions | null;
  readonly planRevision: number;

  // View settings
  readonly view: ViewSettings;
  readonly setView: Dispatch<SetStateAction<ViewSettings>>;
  toggle<K extends keyof ViewSettings>(key: K): void;

  // Computed
  readonly collidingIds: ReadonlySet<string>;
  readonly highlightedIds: ReadonlySet<string>;

  // Catalog search (shared between sidebar and 3D highlighting)
  readonly catalogQuery: string;
  setCatalogQuery: Dispatch<SetStateAction<string>>;

  // Utilities
  readonly recentColors: readonly string[];
  pushColor(color: string): void;
  playCue(cue: SoundCue): void;

  // History
  readonly history: UseHistoryResult;

  // Engine state
  readonly isReady: boolean;
  readonly error: string | null;

  // Game / lighting
  readonly gameMode: GameMode;
  setGameMode: Dispatch<SetStateAction<GameMode>>;
  readonly autoCycleLighting: boolean;
  setAutoCycleLighting: Dispatch<SetStateAction<boolean>>;
}

const RoomEditorContext = createContext<RoomEditorContextValue | null>(null);

export function useRoomEditor(): RoomEditorContextValue {
  const ctx = useContext(RoomEditorContext);
  if (!ctx) throw new Error('useRoomEditor must be used within a RoomEditorProvider');
  return ctx;
}

/** 面板在缺少 RoomEditorProvider 的测试壳/独立挂载下取用 context；返回 null 时按 legacy 草稿口径回落。 */
export function useRoomEditorOptional(): RoomEditorContextValue | null {
  return useContext(RoomEditorContext);
}

export interface RoomEditorProviderProps {
  value: RoomEditorContextValue;
  children: ReactNode;
}

export function RoomEditorProvider({ value, children }: RoomEditorProviderProps): JSX.Element {
  // The parent rebuilds `value` every render, so depending on it would make
  // this memo a no-op; the enumerated fields are the real invalidation keys.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const memoised = useMemo(() => value, [
    value.projectId,
    value.layout,
    value.activeFloor,
    value.activeFloorIndex,
    value.actions,
    value.outdoorPlan,
    value.commitSidecarRef,
    value.planActions,
    value.planRevision,
    value.view,
    value.setView,
    value.collidingIds,
    value.highlightedIds,
    value.catalogQuery,
    value.setCatalogQuery,
    value.recentColors,
    value.pushColor,
    value.playCue,
    value.history,
    value.isReady,
    value.error,
    value.gameMode,
    value.setGameMode,
    value.autoCycleLighting,
    value.setAutoCycleLighting,
    value.toggle,
  ]);
  return <RoomEditorContext.Provider value={memoised}>{children}</RoomEditorContext.Provider>;
}
