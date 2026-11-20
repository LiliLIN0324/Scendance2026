'use client';
import { downloadOutdoorPlanDraft } from '../lib/outdoor-plan-handoff';

/**
 * 户外 2D 规划覆盖层（P2-e · 融进 3D 页面框架）：**本组件只负责画布本体**——
 * 满幅 OutdoorPlanCanvas + 引导 + 分享弹窗，再无任何自造按钮/顶条/侧栏。
 * 其余功能全部 portal 进主产品 3D 页面**现有的框架锚点**（由 room-organizer 渲染）：
 * - `#outdoor-panel-host-layers`：主产品左栏「已放置物件」宿主；
 * - `#outdoor-panel-host-inventory`：左栏户外卡「清单」页宿主（统计 + 清单，不挂在地图上）；
 * - `#outdoor-tools-dock`：主产品右侧工具排位置（sc-editor-dock 内，同款
 *   sc-view-tools/sc-canvas-rail 框架），挂图源循环 / 导出 / 引导三枚钮。
 * 开关由左轨「户外规划」钮 toggle；活动名/保存态归主产品原位（左栏活动卡/左轨 foot）。
 */

import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react';
import OutdoorPlanCanvas, {
  type CanvasBasemapSource,
  type OutdoorPlanCanvasHandle,
} from '@/components/room-organizer/components/outdoor-plan-canvas';
import { enuToLngLat } from '@/components/room-organizer/lib/outdoor-plan-canvas';
import type { PlanPoint } from '../../../../supabase/functions/_shared/site-plan';
import { REPLICA_CASES } from '../lib/replica-cases';
import { planBoundaryFromSearchArea } from '@/components/room-organizer/lib/outdoor-venue-sync';
import { readPlanGroundMode, readPlanGroundSource, subscribePlanGroundMode, writePlanGroundMode, writePlanGroundSource } from '@/components/room-organizer/lib/plan-basemap-source';
import { downloadPlanCsv } from '@/components/room-organizer/lib/site-plan-csv';
import { downloadPlanPng, composePlanPng } from '@/components/room-organizer/lib/site-plan-png';
import { printPlanDeck } from '@/components/room-organizer/lib/site-plan-pdf';
import { downloadPlanGeoJson } from '@/components/room-organizer/lib/site-plan-geojson';
import { normalizePlanFacilityFootprints } from '@/components/room-organizer/lib/facility-footprint-lock';
import { usePlaceShapeLookup } from '../hooks/use-place-shape-lookup';
import { isOverseasLocation } from '../lib/basemap-alignment';
import {
  MAP_SLOT_GROUP_LABELS,
  MAP_SLOT_LABELS,
  MAP_SLOT_ROLES,
  pinMapSource,
  readMapSlots,
  slotRoleForSource,
  subscribeMapSlots,
  type MapSlotRole,
} from '../lib/map-source-slots';
import type { BackendSession } from '@/lib/backend-session';
import { createOutdoorMapContext,type OutdoorEvidenceHighlight } from '../lib/outdoor-map-context';
import { restoreOutdoorLibraryModels } from '../lib/outdoor-personal-library';
import { boundaryKey } from '../lib/outdoor-agent-contract';
import { loadFacilityModelCandidates } from '../lib/plan-facility-models';
import { findGeneratedFacilityModel,listGeneratedFacilityModels } from '../lib/facility-generated-models';
import { openGenerationSheet } from '../lib/generation-sheet';
import { useAgentOptional } from '@/components/room-organizer/panels/agent-panel';
import { Layers3, LayoutGrid, X } from 'lucide-react';
import {
  adoptLegacyOutdoorPlanForActivity,
  createStarterOutdoorPlan,
  DEFAULT_OUTDOOR_PLAN_ANCHOR,
  DEFAULT_OUTDOOR_OVERVIEW_ZOOM,
  outdoorSaveScope,
  patchOutdoorProjectRemote,
  readOutdoorProjectRecord,
  saveOutdoorProjectRecord,
  type OutdoorProjectRecord,
  type OutdoorSaveResult,
} from '@/components/room-organizer/lib/outdoor-project-store';
import { createOutdoorPlanSession, samePlanContent } from '@/components/room-organizer/lib/outdoor-plan-session';
import { createOutdoorWriteGuard } from '@/components/room-organizer/lib/outdoor-write-guard';
import { pushOutdoorPlan, forcePushOutdoorPlan, pullOutdoorPlan } from '@/components/room-organizer/lib/outdoor-plan-sync';
import { failCloudSync, failLocalSave, finishCloudSync, noteLocalSave, reportConflict, startCloudSync } from '@/components/room-organizer/lib/save-status';
import { RealSourceThumb } from './map-source-thumb';
import { OutdoorSyncBanner, type OutdoorSyncConflict } from './outdoor-sync-banner';
import type { SitePlanData } from '../../../../supabase/functions/_shared/site-plan';
import type { DisplayUnit } from '../lib/types';
import type { PlanSceneObject } from '@/components/room-organizer/lib/plan-item-bridge';

/** 图源循环顺序（左下「图层」入口选图源）。方格内为示意地图画面（非真实瓦片预览）。 */
const SOURCE_CYCLE: { id: CanvasBasemapSource; label: string; featured?: boolean }[] = [
  { id: 'osm', label: 'OSM 街道' },
  { id: 'carto-light', label: 'Carto 浅色' },
  { id: 'carto-dark', label: 'Carto 深色', featured: true },
  { id: 'amap-satellite', label: '高德卫星', featured: true },
  { id: 'amap-streets', label: '高德街道', featured: true },
  { id: 'amap-streets-labels', label: '高德街道注记' },
  { id: 'esri-satellite', label: '全球卫星' },
  { id: 'vec', label: '天地图矢量' },
  { id: 'img', label: '天地图影像' },
];

/** 面板清单短名：268px 宽、一格约 72px，长名会被省略号截断，这里统一给短名。 */
const LIST_SOURCE_LABELS: Record<string, string> = {
  osm: 'OSM 街道',
  'carto-light': 'Carto 浅色',
  'carto-dark': 'Carto 深色',
  'amap-satellite': '高德卫星',
  'amap-streets': '高德街道',
  'amap-streets-labels': '高德注记',
  'esri-satellite': '全球卫星',
  vec: '天地图矢量',
  img: '天地图影像',
};

/** 面板里图源的人话名（短名优先；查不到退循环表的名字，再不行用 id）。 */
function sourceDisplayName(id: CanvasBasemapSource): string {
  return LIST_SOURCE_LABELS[id] ?? SOURCE_CYCLE.find(option => option.id === id)?.label ?? id;
}

/**
 * 2026-11-17 用户指令：下方清单按用途分组（街道类 / 卫星类 / 视觉类），与上排四个槽位一一对应。
 * 分组直接由 map-source-slots 的用途表推出，新增图源只需在那边表态，这里自动归位。
 */
const SOURCE_GROUPS = MAP_SLOT_ROLES.map(role => ({
  role,
  label: MAP_SLOT_GROUP_LABELS[role],
  items: SOURCE_CYCLE.filter(option => slotRoleForSource(option.id) === role).map(option => ({
    id: option.id,
    label: LIST_SOURCE_LABELS[option.id] ?? option.label,
  })),
}));

/** 悬停竖列里的高频底图（上一版结构）：地图 / 卫星 / 深色，其余走「展开」。 */
const FEATURED_SOURCES: { id: CanvasBasemapSource; label: string }[] = [
  { id: 'amap-streets', label: '地图' },
  { id: 'amap-satellite', label: '卫星' },
  { id: 'carto-dark', label: '深色' },
];

function MapDetailsPanel({ source, geoHidden, showPaperMode = true, lngLat, onPickSource, onTogglePaper, onClose }: {
  source: CanvasBasemapSource;
  geoHidden: boolean;
  /** 2026-11-17 docs/46 V-P1：纸面升为一等形态（3D 地面也认），默认渲染；保留参数只为将来按需隐藏。 */
  showPaperMode?: boolean;
  /** 真瓦片缩略图取图中心（plan.anchor，GCJ-02）；null 时缩略图回落手绘示意。 */
  lngLat: { lng: number; lat: number } | null;
  onPickSource: (id: CanvasBasemapSource) => void;
  onTogglePaper: () => void;
  onClose: () => void;
}) {
  // 2026-11-17 用户指令「上面留四个、下面的可以置顶」：上排四格读槽位 store，
  // 置顶写入后立刻重绘（模块级 store + useSyncExternalStore）。
  const slots = useSyncExternalStore(subscribeMapSlots, readMapSlots, readMapSlots);
  const overseas = isOverseasLocation(lngLat?.lng, lngLat?.lat);

  /** 上排格：标题是用途（卫星/街道/单色），底下小字是置顶进来的具体图源。 */
  const slotTile = (role: MapSlotRole) => {
    const pinned = slots[role] as CanvasBasemapSource;
    const active = !geoHidden && pinned === source;
    return (
      <button
        key={role}
        type="button"
        role="radio"
        aria-checked={active}
        aria-label={`底图：${MAP_SLOT_LABELS[role]}（${sourceDisplayName(pinned)}）`}
        data-testid={`map-slot-${role}`}
        onClick={() => onPickSource(pinned)}
        className="oc-map-details__source"
      >
        <span className="oc-map-details__thumb" aria-hidden="true">
          <RealSourceThumb id={pinned} lngLat={lngLat} />
        </span>
        <span className="oc-map-details__name">{MAP_SLOT_LABELS[role]}</span>
        <span className="oc-map-details__sub">{sourceDisplayName(pinned)}</span>
      </button>
    );
  };

  /** 下排清单项：点方格选图源；「置顶」只换上面同类槽位，不改当前底图（可预期）。 */
  const sourceItem = ({ id, label }: { id: CanvasBasemapSource; label: string }) => {
    const active = !geoHidden && id === source;
    const role = slotRoleForSource(id);
    const pinnedHere = slots[role] === id;
    const slotName = MAP_SLOT_LABELS[role];
    return (
      <div key={id} className="oc-map-details__item">
        <button
          type="button"
          role="radio"
          aria-checked={active}
          aria-label={`底图：${label}`}
          data-testid={`map-source-${id}`}
          onClick={() => onPickSource(id)}
          className="oc-map-details__source"
        >
          <span className="oc-map-details__thumb" aria-hidden="true">
            <RealSourceThumb id={id} lngLat={lngLat} />
          </span>
          <span className="oc-map-details__name">{label}</span>
        </button>
        <button
          type="button"
          className="oc-map-details__pin"
          data-testid={`map-pin-${id}`}
          aria-label={pinnedHere ? `${label}已在${slotName}槽位` : `把${label}置顶到${slotName}`}
          title={pinnedHere ? `已在${slotName}槽位` : `置顶到${slotName}`}
          disabled={pinnedHere}
          onClick={() => pinMapSource(id)}
        >
          {pinnedHere ? '已置顶' : '置顶'}
        </button>
      </div>
    );
  };

  return (
    <div
      id="outdoor-map-details"
      data-testid="outdoor-map-picker-panel"
      role="dialog"
      aria-label="地图详情"
      className="oc-map-details"
    >
      <div className="oc-map-details__head">
        <span className="oc-map-details__title">地图详情</span>
        <button
          type="button"
          data-testid="map-picker-close"
          aria-label="关闭地图详情"
          className="oc-map-details__close"
          onClick={onClose}
        >
          <X size={18} strokeWidth={1.8} aria-hidden="true" />
        </button>
      </div>
      <div className="oc-map-details__body">
      <div className="oc-map-details__section">
        <div className="oc-map-details__label">地图类型</div>
        <div className="oc-map-details__grid" role="radiogroup" aria-label="地图类型">
          {MAP_SLOT_ROLES.map(slotTile)}
          {/* 第四格「无」= 纸面（虚拟场地）：走 ground-mode store，不铺瓦片。 */}
          {showPaperMode && (
            <button
              type="button"
              role="radio"
              aria-checked={geoHidden}
              aria-label="底图：无（纸面）"
              data-testid="map-picker-toggle-geo"
              onClick={onTogglePaper}
              className="oc-map-details__source"
            >
              <span className="oc-map-details__thumb oc-map-details__thumb--paper" aria-hidden="true" />
              <span className="oc-map-details__name">无</span>
              <span className="oc-map-details__sub">纸面</span>
            </button>
          )}
        </div>
        <div className="oc-map-details__hint">下面任一图源可「置顶」到上面同类型的格子。</div>
        {/* 2026-11-17 用户反馈「海外的地图怎么全改了」：境外换源不再一刀切，按类别映射
            （街道类→OSM、卫星类→全球卫星），并在面板里明说。 */}
        {overseas && (
          <div
            data-testid="map-details-overseas-hint"
            style={{ margin: '6px 4px 0', fontSize: 11, lineHeight: 1.5, color: 'var(--sc-ink-muted, #8a8f98)' }}
          >
            海外场地：高德/天地图在境外无瓦片，街道类已用 OSM、卫星类已用全球卫星替代。
          </div>
        )}
      </div>
      {/* 2026-11-17 用户指令：下排按类型分组（街道 / 卫星 / 视觉），每项可置顶。 */}
      {SOURCE_GROUPS.map(group => (
        <div className="oc-map-details__section" key={group.role}>
          <div className="oc-map-details__label">{group.label}</div>
          <div className="oc-map-details__grid" role="radiogroup" aria-label={group.label}>
            {group.items.map(sourceItem)}
          </div>
        </div>
      ))}
      </div>
    </div>
  );
}

/** 本机落盘失败时给人看的一句话（不出现「已保存」这种模糊说法）。 */
function localSaveFailureMessage(reason: 'unavailable' | 'quota' | 'unknown'): string {
  if (reason === 'quota') return '本机存储已满，这次改动还没存下来。请先导出方案，或清理浏览器本机存储后点「重试保存」。';
  if (reason === 'unavailable') return '本机存储不可用（浏览器禁用了本地存储？），这次改动还没存下来。请导出方案后再关闭页面。';
  return '本机保存失败，这次改动还没存下来。请点「重试保存」，或导出方案后再关闭页面。';
}

/** 记录里的 ISO 时间 → 状态条上的本机时钟；坏数据不编时间。 */
function savedAtLabel(iso: string): string | null {
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? null : at.toLocaleTimeString('zh-CN', { hour12: false });
}

/** 本机掉盘 / 写租约被占：和云端冲突条同一套视觉，但不会自动退场。 */
const SAVE_ALERT_STACK: CSSProperties = {
  position: 'absolute', bottom: 56, left: '50%', transform: 'translateX(-50%)', zIndex: 41,
  display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 520, width: 'max-content',
  // 3D 接管态下覆盖层整体 visibility:hidden；保存失败必须照样看得见（同左下图层 dock 的做法）。
  visibility: 'visible', pointerEvents: 'auto',
};
const SAVE_ALERT_SHELL: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderRadius: 12,
  background: 'rgba(20,20,22,0.92)', color: '#fff', fontSize: 12, lineHeight: 1.5,
  boxShadow: '0 6px 20px rgba(0,0,0,0.22)',
};
const SAVE_ALERT_ACTION: CSSProperties = {
  padding: '4px 10px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.28)',
  background: 'rgba(255,255,255,0.10)', color: '#fff', fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap',
};

const AUTOSAVE_DEBOUNCE_MS = 400;
/** 云端副本推失败后的冷却：这段时间内不再重试，避免每条编辑都撞一次（用户嫌顶部提示烦）。 */
const CLOUD_RETRY_MS = 60_000;
/** 普通提示（如“已换成服务器那版”）自己退场的时间；版本冲突不自动消失。 */
const NOTE_AUTOCLEAR_MS = 6000;
/** 本地活动没有稳定 id 时的兜底草稿槽（单草稿；云项目 id 恒走按项目隔离）。 */
const LOCAL_DRAFT_SLOT = 'local-draft';

/**
 * 户外保存状态上报（任务 B / C05：本机与云端分开说真话）。
 * - saving/saved：本机落盘阶段；saved 只代表本机已存。
 * - syncing → cloud-saved：云端副本推送确认（带服务器版本与确认时间）。
 * - cloud-failed：云端暂未同步（未登录/断网/后端不可用），本机这版还在，定时重试。
 * - conflict：版本冲突，等用户二选一。
 */
export type OutdoorSaveState = {
  state: 'idle' | 'saving' | 'saved' | 'syncing' | 'cloud-saved' | 'cloud-failed' | 'conflict' | 'local-failed' | 'blocked';
  savedAt: string | null;
  /** 上报的保存态 scope（与云面板订阅同口径；无 id 时为 'local'）。 */
  scope: string;
  /** 服务器最近确认的副本版本；未同步过为空。 */
  cloudRevision?: number;
  /** 服务器确认时间（毫秒）。 */
  cloudConfirmedAt?: number;
  /** 失败/冲突时的一句人话原因。 */
  detail?: string;
} | null;

export interface OutdoorPlanOverlayProps {
  /** 草稿归属：layout.id（云项目 id 或本地活动 uuid）；null 落固定兜底槽。 */
  projectId: string | null;
  /**
   * 2026-11-17：旧版把整台设备的户外规划都放在工作台项目 id 下，所有本机活动共用一份。
   * 传入那个旧项目 id 时，本活动首次载入会一次性接管它（见 adoptLegacyOutdoorPlanForActivity），
   * 之后的空活动不再继承——新活动必须是空场地。
   */
  legacyPlanProjectId?: string | null;
  /** 活动点位（sceneAnchor/mapLngLat，GCJ-02）：仅用于底图初始定位，不写进 plan.anchor。 */
  anchor?: { lng: number; lat: number } | null;
  activityName?: string | null;
  /** 保存态上报：room-organizer 据此在左轨 foot（主产品保存态原位）显示户外草稿状态。 */
  onSaveStateChange?: (next: OutdoorSaveState) => void;
  /** P2-g：undo/redo 可用态上报（室内工具排撤销/重做钮启用态）。 */
  onHistoryChange?: (state: { canUndo: boolean; canRedo: boolean }) => void;
  /** 2026-11-12 B1 选择工具：2D 画布绘制/浏览模式上报（右栏工具排「选择」钮按下态）。 */
  onModeChange?: (mode: string) => void;
  /** 2026-11-12 三张卡拆开：测量 / 标注 / 属性 各自展开态上报（右轨三枚圆钮的按下态）。 */
  onInspectorChange?: (state: { openTabs: Record<'measure' | 'annotate' | 'selection', boolean> }) => void;
  /** P2-g：计划变更上报（2D 边界 → 3D 场地壳体联动用；含初次载入的那一帧）。 */
  onPlanChange?: (plan: SitePlanData) => void;
  /** 2026-11-11 图层：活动层切换上报（3D 地面图层据此只镜像当前层；含初次载入的初始层）。 */
  onActiveLevelChange?: (levelId: string) => void;
  /**
   * P2-g 反向播种：3D 已圈好的场地（`layout.backendVenue`）投影成的起步平面。
   * 只在**该槽位还没有户外草稿**时使用；有草稿时草稿优先（用户自己画过的东西不覆盖）。
   */
  seedPlan?: SitePlanData | null;
  /**
   * 2026-11-11 统一视图：室内 3D 场景的落位（物料 + 场地实景扫描）投影到户外 2D 画布。
   * 只读展示层——透传给 OutdoorPlanCanvas，不参与命中测试/交互。
   */
  sceneObjects?: readonly PlanSceneObject[] | undefined;
  /**
   * 2026-11-19 用户：「点了还是没有落在场地上」——实景扫描落位钉（plan ENU）。
   * 只读标记：不写进 plan，不参与统计或命中测试。
   */
  scanPin?: { point: PlanPoint; label: string; assetId?: string } | null;
  renderScanPlan?: ((ctx: CanvasRenderingContext2D, viewport: import('../lib/outdoor-plan-canvas').PlanViewport) => void) | undefined;
  scanError?: string | undefined;
  /**
   * 2026-11-12 接管态保活隐藏：全屏 OutdoorPlan3D 接管画布时，本覆盖层**保持挂载**
   * （2D 画布编辑桥 pointerFromPlan 要用它的句柄与布局），但它自己的 2D 画面/浮层
   * 必须真正不可见、不可点。只在外层包 div 上设 visibility:hidden 不够——内层画布
   * 容器按 `view` 又写了 visibility:visible，会把隐藏顶掉，2D 画面直接盖住 3D。
   */
  dormant?: boolean;
  /**
   * 2026-11-12 用户指令「3D 的时候也要可编辑」：右轨三张工具卡的出镜宿主 id，
   * 接管态由 room-organizer 提供（透传给画布，portal 出隐藏覆盖层）；2D 态不传。
   */
  inspectorHostId?: string;
  /** 清单/读数显示单位；工程底稿仍存米。缺省米。 */
  lengthUnit?: DisplayUnit;
  planEditor?: import('../../../../supabase/functions/_shared/plan-editor').PlanEditorSettings;
  /**
   * V-5b/c（2026-11-13）：属性卡「模型」区的生成/上传入口外发（透传给 OutdoorPlanCanvas）。
   * room-organizer 侧接线：记 facility 链接 + 预填左栏物料生成框（仍须确认额度）；
   * 提交成功后画布轮询回填候选首位。只读分享页等不传，按钮缺省 no-op。
   */
  controller?: BackendSession | undefined;
  onViewChange?:(view:'2d'|'3d')=>void;
}

/** P2-g：覆盖层对外命令句柄（room-organizer 的室内工具排通用钮转发到这里）。 */
export interface OutdoorPlanOverlayHandle {
  /** 缩放一档（与滚轮同源）。 */
  zoomBy(direction: 1 | -1): void;
  /**
   * 2026-11-12 接管态编辑桥：把覆盖层里活着的 2D 画布句柄交给全屏 OutdoorPlan3D
   * （canvasApiRef），左键物件手势走同一条 pointerFromPlan 管线；覆盖层未挂载时 null。
   */
  getCanvasApi(): OutdoorPlanCanvasHandle | null;
  /** 业务层画布截图 dataURL（无画布时 null）。 */
  captureImage(): string | null;
  /** 2026-11-14 舞台合成截图（底图瓦片+业务层，封面口径）；无画布时 null。 */
  captureStageImage(): string | null;
  /** 按当前 plan 导出 PNG（与右侧导出菜单的 PNG 同一口径）；无 plan 时返回 false。 */
  exportPng(): boolean;
  /** 导出物料清单 CSV（单位跟随 lengthUnit）；无 plan 时不动作。 */
  exportCsv(): void;
  /** 导出场地几何 GeoJSON；无 plan 时不动作。 */
  exportGeoJson(): void;
  /** 导出 PDF 演示稿（打印排版）；无 plan 时不动作。 */
  exportPdf(): void;
  undo(): void;
  redo(): void;
  /** 2026-11-12 B1 选择工具：切 2D 画布浏览/选择模式（右栏工具排「选择」钮转发）。 */
  setCanvasMode(mode: 'view' | 'select'): void;
  /** 2026-11-15 测量直进：直接切画布编辑模式（measure / view 等）。 */
  setToolMode(mode: string): void;
  /** 2026-11-15 测量直进：切距离/面积（工具条小标转发）；2026-11-17 路径入口下线。 */
  setMeasureKind(kind: 'distance' | 'area'): void;
  /** 读取当前测量模式（工具条小标回显图标用）。 */
  getMeasureKind(): 'distance' | 'area';
  /** 2026-11-15 户外网格吸附开关：开=对齐网格，关=自由摆放。 */
  setSnapOn(on: boolean): void;
  /** 2026-11-12 测量/标注收进右轨圆钮：开/关「工具与属性」浮窗并切页签（右轨圆钮转发）。 */
  setInspector(open: boolean, tab?: 'measure' | 'annotate' | 'selection'): void;
  /** 指北针 2D 态：复位视图到场地边界外框，缺边界则回锚点居中。 */
  focusVenue(): void;
  /** 2026-11-16：把视野框到设计范围（右下焦点钮在圈了范围时改派这里）。 */
  focusDesignScope(): void;
  /** 2026-11-16 罗盘拖转 2D：转盘增量（弧度，与 3D orbitByDelta 同口径）；无画布时 no-op。 */
  orbitByDelta(deltaRad: number): void;
  /** 罗盘点击回正北（2D bearing 归 0）；无画布时 no-op。 */
  resetNorth(): void;
  /** 当前 2D 地图方位角（弧度，0=正北朝上）；无画布时 0。 */
  getBearing(): number;
}

const OutdoorPlanOverlay = forwardRef<OutdoorPlanOverlayHandle, OutdoorPlanOverlayProps>(function OutdoorPlanOverlay({
  projectId,
  legacyPlanProjectId = null,
  anchor,
  activityName,
  onSaveStateChange,
  onHistoryChange,
  onModeChange,
  onInspectorChange,
  onPlanChange,
  onActiveLevelChange,
  seedPlan,
  sceneObjects,
  scanPin, renderScanPlan, scanError,
  dormant = false,
  inspectorHostId,
  lengthUnit = 'm',
  planEditor,
  controller,
  onViewChange,
}: OutdoorPlanOverlayProps, ref): JSX.Element {
  const agent = useAgentOptional();
  const canvasApiRef = useRef<OutdoorPlanCanvasHandle | null>(null);
  const slotId = projectId || LOCAL_DRAFT_SLOT;
  // 保存态 scope 与云面板（`layout.id ?? 'local'`）同口径；slotId 只是存储槽。
  const saveScope = outdoorSaveScope(projectId);
  const confirmedCaseView = useMemo(() => REPLICA_CASES.find(c => `replica-${c.id}` === slotId)?.confirmedView, [slotId]);
  // 本机活动：规划按活动存（草稿归属就是 layout.id），写入时不动「最近项目」指针。
  const activityScopedPlan = slotId !== LOCAL_DRAFT_SLOT && slotId !== legacyPlanProjectId;
  // 初始读已存的图源偏好；早先这里硬编码 'osm'，mount 后写回偏好时会把用户选过的源冲掉。
  const [source, setSource] = useState<CanvasBasemapSource>(() => readPlanGroundSource());
  const [plan, setPlan] = useState<SitePlanData | null>(null);
  const [loadedSlotId, setLoadedSlotId] = useState<string | null>(null);
  const defaultOverview = plan?.anchor?.source === 'preset'
    && plan.anchor.lng === DEFAULT_OUTDOOR_PLAN_ANCHOR.lng
    && plan.anchor.lat === DEFAULT_OUTDOOR_PLAN_ANCHOR.lat
    && [plan.boundary, plan.zones, plan.facilities, plan.routes, plan.nodes, plan.workers].every(items => items.length === 0)
    ? { lng: plan.anchor.lng, lat: plan.anchor.lat, zoom: DEFAULT_OUTDOOR_OVERVIEW_ZOOM }
    : null;
  const [savedAt, setSavedAt] = useState<string | null>(null);
  // 2026-11-20（B2）：本机写失败要说出来。空串不占位；成功落盘或换活动才清。
  const [localSaveFailure, setLocalSaveFailure] = useState<string | null>(null);
  // 2026-11-20（B6）：另一个窗口持有写租约时的提示；本窗口不写、不推。
  const [writeBlocked, setWriteBlocked] = useState<string | null>(null);
  // C05：本机 saved 与云端确认分开报。saved ≠ 云端已同步；云端状态由推送回执改写。
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'syncing' | 'cloud-saved' | 'cloud-failed' | 'conflict' | 'local-failed' | 'blocked'>('idle');
  const [cloudInfo, setCloudInfo] = useState<{ revision: number | null; confirmedAt: number | null }>({ revision: null, confirmedAt: null });
  // 云端副本重试闸：失败后 60s 内不再尝试（不跟着每条编辑发请求）；到点自动静默重试一次。
  const cloudRetryTimerRef = useRef<number | null>(null);
  // 2026-11-17：云端副本的人话状态（冲突/未上传）；空串不占位。
  const [syncNote, setSyncNote] = useState<string>('');
  // 版本冲突：让用户二选一（不自动合并、不后写胜）。ref 供防抖回调同步读。
  const [syncConflict, setSyncConflict] = useState<OutdoorSyncConflict | null>(null);
  const syncConflictRef = useRef<OutdoorSyncConflict | null>(null);
  const [syncBusy, setSyncBusy] = useState(false);
  // 云端副本重试闸：失败后 60s 内不再尝试（不跟着每条编辑发请求）。
  const cloudRetryAtRef = useRef(0);
  // B6：本会话的云端版本基线（只随本会话回执 / 明确接受远端推进）与本机写租约；换活动时重建。
  const sessionRef = useRef<ReturnType<typeof createOutdoorPlanSession> | null>(null);
  const writeGuardRef = useRef<ReturnType<typeof createOutdoorWriteGuard> | null>(null);
  /** 供「租约恢复」「关页 flush」等回调拿到当帧最新的 flushSave。 */
  const flushRef = useRef<(options?: { localOnly?: boolean }) => void>(() => {});
  /** 打开后补推只做一次（成功与否都交给 60s 重试闸）。 */
  const catchUpPushedRef = useRef<string | null>(null);
  // 2026-11-20：这里的三步气泡由全局引导（onboarding/）接管；本覆盖层不再挂第二套引导状态，
  // 也不再挂 window 捕获阶段的「点外面就永久消失」监听——那会让引导一次跳过就回不来。
  // 底图选择面板：对齐 OnePlan 的 Select a map —— 画布右下角一枚「底图」钮 + 弹出列表，
  // 不再把「OSM」这种图源缩写塞进室内工具排里让人猜。
  const [mapPickerOpen, setMapPickerOpen] = useState(false);
  // 2026-11-16 用户指令（参考高德）：点图层钮开合紧凑弹层（地图/卫星/深色/展开），
  // 单击即切即关；「展开」才进完整「地图详情」面板，X 关掉后回到图层钮。
  // 悬停竖列手感太低效（误触开、移开即关），拆除 hover 计时器；点外部/Esc 收起走下方 effect。
  const [layerStripOpen, setLayerStripOpen] = useState(false);
  const layerDockRef = useRef<HTMLDivElement | null>(null);
  // 2026-11-11 用户拍板：户外默认铺真地图（起步计划自带预置锚点）；纸面格网降级为
  // 用户显式「隐藏底图」的形态。geoHidden = true 时切纸面，业务图层不受影响。
  // 2026-11-17 docs/46 V-P1：纸面升为一等形态——初始值读地面形态偏好（虚拟场地起稿即纸面），
  // 开关写回 store，3D 地面同步落纸面；2D/3D 一个开关管到底。
  const [geoHidden, setGeoHidden] = useState(() => readPlanGroundMode() === 'paper');
  // 2D 画布始终挂载（左栏图层/测量/标注都 portal 到它上面）。
  // 3D 场地由壳体全屏 OutdoorPlan3D 唯一接管；本覆盖层只保留 2D 画布编辑桥，不再自挂 3D 实例。

  // 搜地点（用户 m04938 / m05472）：左上角「和地图 App 一样」的搜索框，组件本体在
  // `plan-place-search.tsx`（2D 工作台与编辑器内嵌覆盖层共用同一份）。
  // 定位钉只是视图辅助（不改 plan / anchor），点「清除」即撤钉。
  const [placePin, setPlacePin] = useState<{ lng: number; lat: number; label: string } | null>(null);
  // 2026-11-12 用户要求「给相关的选区，而不是一个居中的点」：行政区边界（视图辅助，不改 plan）。
  // kind: 'line' = 道路等开放折线选区（2026-11-13「点道路=道路选区」）。
  const [placeArea, setPlaceArea] = useState<{ polygon: [number, number][]; label: string; kind?: 'area' | 'line' } | null>(null);
  // 桥在 effect 里注册一次；核对要读到最新选区，不能闭上注册那一帧的 state。
  const placeAreaRef = useRef(placeArea);
  placeAreaRef.current = placeArea;
  const { loading: shapeLoading, unavailable: shapeUnavailable, cancel: cancelPlaceShape } = usePlaceShapeLookup(slotId, (shape, name) => {
    const [west, south, east, north] = shape.bounds;
    setPlacePin({ lng: (west + east) / 2, lat: (south + north) / 2, label: name });
    setPlaceArea({ polygon: shape.polygon, label: `${shape.name} · ${shape.kind === 'line' ? '线路' : '范围'}`,
      ...(shape.kind === 'line' ? { kind: 'line' as const } : {}) });
    canvasApiRef.current?.focusBounds(shape.bounds);
  }, JSON.stringify(plan?.boundary ?? []));
  // P4-d：把平面选的底图记成「三维地面也用这张」的偏好，切图源时同步。
  useEffect(() => {
    writePlanGroundSource(source);
  }, [source]);

  // docs/46 V-P1：纸面/地图形态写进同一族偏好，3D 地面订阅跟随（真地图瓦片 ↔ 素面）。
  useEffect(() => {
    writePlanGroundMode(geoHidden ? 'paper' : 'map');
  }, [geoHidden]);
  // V-P2：Agent 侧（虚拟场地意图）也会写 ground-mode store——订阅回来，2D 覆盖层跟随切换。
  useEffect(() => subscribePlanGroundMode(() => {
    setGeoHidden(readPlanGroundMode() === 'paper');
  }), []);

  // 载入本机草稿：室内活动第一次开户外面用起步矩形（同户外项目口径）。
  // P2-g：没有草稿但有 3D 场地时，按 3D 壳体的轮廓起稿（同一个场地的两个视图）。
  const seedPlanRef = useRef<SitePlanData | null | undefined>(seedPlan);
  seedPlanRef.current = seedPlan;
  // 2026-11-11 默认锚点：旧草稿没锚点、活动也从未定位过（seedPlan/anchor 都没有）时，
  // 一次性补预置锚点（西湖区概览，source 'preset'）并经 autosave 落盘——真地图开箱即用。
  // 活动本身有位置（seedPlan 已带 anchor / anchor prop 存在）则不动草稿，维持「不虚构」纪律。
  const anchorRef = useRef(anchor);
  anchorRef.current = anchor;
  // 换活动：上一份的云端提示/冲突/保存态与待执行的重试都不带过去。
  // 必须在下面「载入本机草稿」之前跑：那个 effect 会把本机已有的保存态重新上报成 saved。
  useEffect(()=>{
    setSyncNote('');setSyncConflict(null);syncConflictRef.current=null;cloudRetryAtRef.current=0;
    if (cloudRetryTimerRef.current !== null) { window.clearTimeout(cloudRetryTimerRef.current); cloudRetryTimerRef.current = null; }
    setSaveState('idle'); setCloudInfo({ revision: null, confirmedAt: null });
    setSavedAt(null); setLocalSaveFailure(null); setWriteBlocked(null);
    catchUpPushedRef.current = null;
  },[slotId]);
  useEffect(() => {
    cancelPlaceShape(); setPlacePin(null); setPlaceArea(null);
    // 2026-11-17：升级前整台设备只有一份规划，先交给当时打开的活动；之后新建活动不再继承。
    if (legacyPlanProjectId && activityScopedPlan) adoptLegacyOutdoorPlanForActivity(slotId, legacyPlanProjectId);
    const record = readOutdoorProjectRecord(slotId);
    // #51 方案甲：载入即吸附设施权威宽高比（幂等），anchor 缺省分支在规整结果上继续。
    const storedPlan = record?.plan ?? seedPlanRef.current ?? createStarterOutdoorPlan();
    // 经典案例的占地来自参考图（同一模板可代表不同规格），载入时不能再按图标默认比例改尺寸。
    const loaded = slotId.startsWith('replica-')
      ? storedPlan
      : normalizePlanFacilityFootprints(storedPlan);
    setLoadedSlotId(slotId);
    // 2026-11-20（B6/F9）：本会话的云端版本基线只在这里建立一次；之后只随本会话成功回执
    // 或用户明确「用服务器那版」推进，绝不从共享记录里借另一个窗口刚写进去的版本号。
    const session = createOutdoorPlanSession();
    session.hydrate(record);
    // 打开时盘上已经就是这份内容 → 不写盘、不推云端（F9：打开不该把版本 +1）。
    // 只有规整（宽高比 / 锚点回填）真改了内容，或本来就还没有记录，才需要落一次。
    if (record?.plan && samePlanContent(record.plan, loaded)) session.markPersisted(loaded);
    sessionRef.current = session;
    if (record) { setSavedAt(savedAtLabel(record.updatedAt)); setSaveState('saved'); }
    if (!loaded.anchor && !anchorRef.current) {
      // docs/46 V-P2：虚拟场地（纸面形态）不回填预置锚点——无锚点是虚拟场地的合法态；
      // 等用户画完红线再决定要不要定位。切回真地图（store='map'）时下次载入照常回填。
      if (readPlanGroundMode() === 'paper') {
        setPlan(loaded);
        return;
      }
      setPlan({ ...loaded, anchor: DEFAULT_OUTDOOR_PLAN_ANCHOR });
      return;
    }
    setPlan(loaded);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slotId]);

  // 2026-11-20（B6）：同一个浏览器里只允许一个窗口写这份活动。
  // Web Locks 独占租约按活动名隔离；拿不到就整窗不写、不推，只如实提示；
  // 对方关掉后排队请求拿到租约，这里翻回可写并把积压的编辑补存一次。
  // 浏览器没有 Web Locks 时降为 unavailable（仍可写，但只有版本号 CAS 那一层），不假装有互斥。
  useEffect(() => {
    const locks = typeof navigator === 'undefined' ? null : (navigator.locks ?? null);
    const guard = createOutdoorWriteGuard({ projectId: slotId, locks });
    writeGuardRef.current = guard;
    setWriteBlocked(guard.blockedDetail());
    const unsubscribe = guard.onModeChange(() => {
      setWriteBlocked(guard.blockedDetail());
      if (guard.mode() !== 'granted') return;
      // 租约到手：被挡住期间一条都没写，这里把积压的编辑补存（已落过盘的不重写）。
      const current = planRef.current;
      const session = sessionRef.current;
      if (current && session && !session.isPersisted(current)) flushRef.current?.();
    });
    return () => {
      unsubscribe();
      if (writeGuardRef.current === guard) writeGuardRef.current = null;
      void guard.release();
    };
  }, [slotId]);

  // SitePlanData 是户外唯一正源。seedPlan 只在初次载入时播种；
  // 不能把 3D 壳体镜像反过来重播种（会清空刚确认的设施/流线，且把真边界缩成 100m）。

  // 保存管线：同户外项目工作台（400ms 防抖 + 卸载 flush）；状态经 onSaveStateChange
  // 上报给 room-organizer，在左轨 foot（主产品保存态原位）显示。
  const mapContextRef=useRef(createOutdoorMapContext());
  const [evidenceHighlights,setEvidenceHighlights]=useState<OutdoorEvidenceHighlight[]>([]);
  useEffect(()=>{mapContextRef.current.invalidate();setEvidenceHighlights([]);},[slotId]);
  // 卸载：停掉待执行的重试（本机记录已在，重开活动会继续推）。
  useEffect(() => () => {
    if (cloudRetryTimerRef.current !== null) window.clearTimeout(cloudRetryTimerRef.current);
  }, []);
  // 普通提示自己退场（冲突提示不走这条——它要等用户选）。
  useEffect(() => {
    if (!syncNote || syncConflict) return undefined;
    const timer = window.setTimeout(() => setSyncNote(''), NOTE_AUTOCLEAR_MS);
    return () => window.clearTimeout(timer);
  }, [syncNote, syncConflict]);
  const flowRef=useRef(agent?.outdoorWorkflow);flowRef.current=agent?.outdoorWorkflow;
  const viewChangeRef=useRef(onViewChange);viewChangeRef.current=onViewChange;
  const planRef = useRef<SitePlanData | null>(plan);
  planRef.current = plan;
  // V-2d/V-3c：把「应用流线/应用区域」的画布入口与当前 plan 读取口注册给 chat agent——
  // 气泡确认后 provider 调这里；plan 经 ref 每帧取最新，注册一次终身有效。
  useEffect(() => {
    agent?.registerRouteBridge?.({
      projectId:()=>slotId,
      exportPlanDraft:(expected,context)=>{const current=canvasApiRef.current?.getEditVisuals().plan??planRef.current;if(!current||JSON.stringify(current)!==expected)return false;downloadOutdoorPlanDraft(current,slotId,context);return true;},
      // 2026-11-18 用户实测：对话进绘制模式时同步打开左栏目录色板（分区/入口/路线类型都在里面），
      // 不然用户不知道画什么。走 room-organizer 既有的事件通道切 outdoorPanel 到「添加物件」。
      beginDrawing:kind=>{if(!canvasApiRef.current)return false;canvasApiRef.current.setMode(kind);if(kind==='zone'||kind==='route'||kind==='node')window.dispatchEvent(new CustomEvent('scendance:open-outdoor-library'));return true;},
      applyPlan:(next,expected)=>{
        const ok=canvasApiRef.current?.applyWorkflowPlan(next,expected)??false;
        // 摆物件等提案常常不带红线。只有这份方案自己写下了闭合红线，才撤掉搜索选区；
        // 否则地图上的可见范围会被抹掉，已放置面板却仍写「还没画红线」。
        if(ok && next.boundary.length>=3){setPlacePin(null);setPlaceArea(null);}
        return ok;
      },
      selectedIds:()=>canvasApiRef.current?.getSelectedIds()??[],
      visibleActivityRange: () => {
        const current = canvasApiRef.current?.getEditVisuals().plan ?? planRef.current;
        const boundary = planBoundaryFromSearchArea(placeAreaRef.current, current?.anchor);
        if (!boundary || !current?.anchor) return null;
        const name = placeAreaRef.current?.label.split('·')[0]?.trim() || '当前地图范围';
        return { anchor: current.anchor, boundary, name };
      },
      previewBoundary: (anchor, boundary) => {
        // 不在这里清搜索选区：核对预览画的是候选环，选区要留到红线真正写入后再撤。
        // 用户取消确认卡时，地图上的范围还在。
        setPlacePin(null);
        if (!boundary.length) return;
        const points = boundary.map(point => enuToLngLat(point.x, point.y, anchor.lng, anchor.lat));
        const lngs = points.map(point => point.lng);
        const lats = points.map(point => point.lat);
        canvasApiRef.current?.focusBounds([Math.min(...lngs), Math.min(...lats), Math.max(...lngs), Math.max(...lats)]);
      },
      setView:next=>{viewChangeRef.current?.(next);},
      models:async id=>{const f=(canvasApiRef.current?.getEditVisuals().plan??planRef.current)?.facilities.find(f=>f.id===id);if(!f)return[];const result=await loadFacilityModelCandidates([f.templateId]);const own=listGeneratedFacilityModels(id,slotId);const current=f.modelOverride?findGeneratedFacilityModel(f.modelOverride):null;if(current&&current.projectId===slotId&&!own.some(m=>m.slug===current.slug))own.unshift(current);return[...own.map(m=>({slug:m.slug,name:m.name,source:'此设施已有/上传模型',width:m.width,depth:m.depth,height:m.height})),...(result.get(f.templateId)??[]).map(m=>({slug:m.slug,name:m.name,source:'现有公共物料库',width:m.width,depth:m.depth,height:m.height}))].slice(0,5);},
      openGenerate:(id,kind)=>{const f=(canvasApiRef.current?.getEditVisuals().plan??planRef.current)?.facilities.find(f=>f.id===id);if(!f)return false;openGenerationSheet({task:'model',scope:'facility',source:kind,facility:{id,name:f.name}});return true;},
      openUpload:id=>canvasApiRef.current?.openFacilityUpload(id)??false,
      mapContext:async signal=>{const p=canvasApiRef.current?.getEditVisuals().plan??planRef.current;if(!p)throw new Error('当前活动尚未载入');return mapContextRef.current.load(slotId,p,canvasApiRef.current?.getSelectedIds()??[],flowRef.current?.state.confirmedBoundary===boundaryKey(p),signal);},
      proposeZones:(p,brief)=>mapContextRef.current.zones(p,brief),
      roadNetwork:()=>mapContextRef.current.roads(),
      proposeSpatialEdit:(turn,p)=>mapContextRef.current.spatial(turn,p),
      validateCurrentReferences:refs=>mapContextRef.current.validateReferences(refs),
      validateMapPlan:(base,next)=>mapContextRef.current.validate(base,next),
      highlightReferences:refs=>setEvidenceHighlights(mapContextRef.current.highlights(refs)),
      applyVenue: (anchor, boundary) => {
        const applied = canvasApiRef.current?.applyVenue(anchor, boundary) ?? false;
        if (applied) {
          setPlacePin(null); setPlaceArea(null);
          const geos = boundary.map(point => enuToLngLat(point.x, point.y, anchor.lng, anchor.lat));
          canvasApiRef.current?.focusBounds([
            Math.min(...geos.map(p => p.lng)), Math.min(...geos.map(p => p.lat)),
            Math.max(...geos.map(p => p.lng)), Math.max(...geos.map(p => p.lat)),
          ]);
        }
        return applied;
      },
      previewVenuePoint: place => { setPlacePin({ lng: place.lng, lat: place.lat, label: place.name }); setPlaceArea(null); canvasApiRef.current?.focusLngLat(place.lng, place.lat, 17); },
      clearVenuePreview: () => { setPlacePin(null); setPlaceArea(null); },
      cancelVenueBoundary: () => canvasApiRef.current?.setMode('view'),
      inspectFacility: id => canvasApiRef.current?.inspectFacility(id) ?? false,
      // 2026-11-20 P1：结果卡「定位到分区 / 取回这组」整组入镜；只动视图，不改 plan 与选中。
      focusEntities: ids => canvasApiRef.current?.focusFacilities(ids) ?? false,
      // 设施层锁：锁定后本地位移/候选采用一律不写，并由对话说清原因。
      facilityLayerLocked: () => canvasApiRef.current?.isFacilityLayerLocked() ?? false,
      // 「右」的坐标口径：2D 罗盘的旋转角。读不到（例如还没挂载）就如实回 null，让对话只澄清一次。
      viewBearingDeg: () => canvasApiRef.current?.getBearing?.() ?? null,
      beginVenueBoundary: anchor => { cancelPlaceShape(); return canvasApiRef.current?.beginVenueBoundary(anchor) ?? false; },
      applyRoutes: (routes, nodes) => canvasApiRef.current?.applyRoutes(routes, nodes) ?? false,
      applyZoneProposal: (zones, facilities, routes, nodes) => canvasApiRef.current?.applyZoneProposal(zones, facilities, routes, nodes) ?? false,
      applyWorkers: workers => canvasApiRef.current?.applyWorkers(workers) ?? false,
      applyMeasurements: measurements => canvasApiRef.current?.applyMeasurements(measurements) ?? false,
      applyAnnotations: annotations => canvasApiRef.current?.applyAnnotations(annotations) ?? false,
      getLevels: () => canvasApiRef.current?.getLevels() ?? [],
      setActiveLevel: levelId => canvasApiRef.current?.setActiveLevel(levelId) ?? false,
      addFacility: facility => canvasApiRef.current?.addFacility(facility) ?? false,
      removeFacility: id => canvasApiRef.current?.removeFacility(id) ?? false,
      updateFacility: (id, patch) => canvasApiRef.current?.updateFacility(id, patch) ?? false,
      getPlan: () => canvasApiRef.current?.getEditVisuals().plan ?? planRef.current,
    });
    return () => agent?.registerRouteBridge?.(null);
  }, [agent,slotId]);
  const libraryAssetSignature=JSON.stringify(plan?.facilities.filter(f=>f.sourceAssetId).map(f=>[f.id,f.sourceAssetId,f.modelOverride])??[]);
  useEffect(()=>{const p=planRef.current;if(!p)return;const request=new AbortController();void restoreOutdoorLibraryModels(controller??null,slotId,p,request.signal).catch(()=>{/* unavailable models stay visibly unavailable; no generated fallback */});return()=>request.abort();},[slotId,controller,libraryAssetSignature]);
  const pendingSaveRef = useRef<number | null>(null);
  const scheduleCloudRetryRef = useRef<(() => void) | null>(null);
  /** 推送云端副本并如实结算统一状态机；例行失败保持静默，只留状态与定时重试。 */
  const runCloudPush = useCallback((record: OutdoorProjectRecord, current: SitePlanData): void => {
    const seq = startCloudSync(saveScope);
    void pushOutdoorPlan(controller ?? null, record, current).then(outcome => {
      // 让「本机已存」那一帧先渲染出去（macrotask 边界）再结算云端状态——
      // React 批处理会把同 tick 的 setSaveState 合成一帧，吞掉本机保存的如实上报。
      window.setTimeout(() => {
        const session = sessionRef.current;
        if (outcome.status === 'saved') {
          cloudRetryAtRef.current = 0;
          // B6：回执只推进本会话的版本基线，并只改盘上的版本指针——
          // 请求在途期间可能又存过一版新 plan，旧快照不能把它盖回去。
          session?.confirmSaved(outcome);
          patchOutdoorProjectRemote(slotId, {
            remoteActivityId: outcome.remoteActivityId,
            remoteRevision: outcome.remoteRevision,
            // 这次推的就是盘上那一版才清「待同步」；期间又改了就让标记留着，下次打开补推。
            ...(session?.isPersisted(current) ? { unsyncedPlan: false } : {}),
          });
          setSaveState('cloud-saved');
          setCloudInfo({ revision: outcome.remoteRevision, confirmedAt: Date.now() });
          finishCloudSync(saveScope, seq, { revision: outcome.remoteRevision });
          return;
        }
        if (outcome.status === 'conflict') {
          // 版本号只用于提示，不并进本会话基线（基线只能由本会话成功回执或用户明确接受推进）。
          session?.noteConflict(outcome.remoteRevision);
          const conflict: OutdoorSyncConflict = { revision: outcome.remoteRevision, name: outcome.remoteName };
          syncConflictRef.current = conflict;
          setSyncConflict(conflict);
          setSyncNote('');
          setSaveState('conflict');
          reportConflict(saveScope, { remoteRevision: outcome.remoteRevision, remoteName: outcome.remoteName });
          return;
        }
        // 未登录 / 未部署 / 断网：静默降级；状态机如实记「云端未同步」，60s 后自动再试。
        cloudRetryAtRef.current = Date.now() + CLOUD_RETRY_MS;
        setSaveState('cloud-failed');
        failCloudSync(saveScope, seq, '云端副本暂未同步（未登录或网络不可用）；本机这版还在。');
        scheduleCloudRetryRef.current?.();
      }, 0);
    });
  }, [slotId, saveScope, controller]);
  /** 到点静默重试一次：不写本机记录、不动画布，只推当前已有的本机版（旧回执不覆盖新编辑）。 */
  const scheduleCloudRetry = useCallback((): void => {
    if (cloudRetryTimerRef.current !== null) return;
    cloudRetryTimerRef.current = window.setTimeout(() => {
      cloudRetryTimerRef.current = null;
      const current = planRef.current;
      if (current == null || syncConflictRef.current) return;
      if (Date.now() < cloudRetryAtRef.current) { scheduleCloudRetry(); return; }
      const session = sessionRef.current;
      const guard = writeGuardRef.current;
      // 重试也必须用本会话的版本基线；写租约在别的窗口手里时一律不推（那就是一次未经授权的覆盖）。
      if (!session || (guard && !guard.canPush())) return;
      runCloudPush(session.buildRecord({ projectId: slotId, plan: current, name: activityName, unsyncedPlan: true }), current);
    }, CLOUD_RETRY_MS);
  }, [slotId, activityName, runCloudPush]);
  scheduleCloudRetryRef.current = scheduleCloudRetry;
  /**
   * 本机落盘（B2：写失败必须说出来）+ 推送云端副本。
   * `localOnly` = 页面正在销毁（pagehide）：只做同步本机写入，不发网络请求；
   * 记录里留 `unsyncedPlan`，下次打开补推一次（而不是靠「每次打开都推」来兜底）。
   * 云端版本基线取自**本会话**（B6）：不从共享记录里借别的窗口刚写进去的版本号。
   */
  const flushSave = useCallback((options?: { localOnly?: boolean }): OutdoorSaveResult | { ok: false; reason: 'blocked' | 'no-plan' } => {
    const current = planRef.current;
    const session = sessionRef.current;
    if (current == null || !session) return { ok: false, reason: 'no-plan' };
    const guard = writeGuardRef.current;
    if (guard && !guard.canWrite()) {
      // 另一个窗口在写这份活动：这条改动一条都不落盘，也不推云端。
      const message = guard.blockedDetail() ?? '另一个窗口正在编辑这份活动。';
      setWriteBlocked(message);
      setSaveState('blocked');
      failLocalSave(saveScope, message);
      return { ok: false, reason: 'blocked' };
    }
    const record = session.buildRecord({
      projectId: slotId,
      plan: current,
      name: activityName,
      unsyncedPlan: true,
    });
    const result = saveOutdoorProjectRecord(record, undefined, !activityScopedPlan);
    if (!result.ok) {
      const message = localSaveFailureMessage(result.reason);
      setLocalSaveFailure(message);
      setSaveState('local-failed');
      // 统一状态机如实记「本机未保存」：不计作已保存，也不累加待同步数（它没进盘）。
      failLocalSave(saveScope, message);
      return result;
    }
    session.markPersisted(current);
    setLocalSaveFailure(null);
    setSavedAt(new Date().toLocaleTimeString('zh-CN', { hour12: false }));
    setSaveState('saved');
    // C05：本机落盘记入统一状态机（待同步 +1）；「已保存」只代表本机，云端结算在 runCloudPush。
    noteLocalSave(saveScope);
    if (options?.localOnly) return result;
    // 后端副本：本机已落盘；推不上去只是少一份副本，不改本机、不拦编辑。
    // 2026-11-17（用户：顶部这条提示很烦人）：例行失败**不弹任何东西**，只是安静地退回去，
    // 并隔 60s 自动重试（不再只等下一次编辑）；真正需要用户决定的只有版本冲突。
    if (syncConflictRef.current) return result;
    if (Date.now() < cloudRetryAtRef.current) { scheduleCloudRetry(); return result; }
    runCloudPush(record, current);
    return result;
  }, [slotId, saveScope, activityName, activityScopedPlan, runCloudPush, scheduleCloudRetry]);
  flushRef.current = flushSave;

  /** 冲突二选一「用我这版」：明确覆盖服务器（revision 仍 +1）。 */
  const useMyVersion = useCallback(() => {
    const current = planRef.current;
    const session = sessionRef.current;
    if (!current || !session) return;
    setSyncBusy(true);
    const seq = startCloudSync(saveScope);
    const record = session.buildRecord({ projectId: slotId, plan: current, name: activityName, unsyncedPlan: true });
    void forcePushOutdoorPlan(controller ?? null, record, current).then(outcome => {
      setSyncBusy(false);
      if (outcome.status !== 'saved') {
        setSyncNote('这次没传上去，本机这版还在，稍后再试。');
        setSaveState('cloud-failed');
        failCloudSync(saveScope, seq, '覆盖没传上去；本机这版还在，稍后再试。');
        return;
      }
      // force 回执是本会话自己的成功：推进基线；盘上只改版本指针（不拿旧快照盖 plan）。
      session.confirmSaved(outcome);
      const written = session.isPersisted(current)
        ? patchOutdoorProjectRemote(slotId, {
          remoteActivityId: outcome.remoteActivityId,
          remoteRevision: outcome.remoteRevision,
          unsyncedPlan: false,
        })
        : saveOutdoorProjectRecord(
          session.buildRecord({ projectId: slotId, plan: current, name: activityName, unsyncedPlan: false }),
          undefined,
          !activityScopedPlan,
        );
      if (written.ok) session.markPersisted(current);
      else setLocalSaveFailure(localSaveFailureMessage(written.reason));
      syncConflictRef.current = null;
      setSyncConflict(null);
      setSyncNote(`已用本机这版覆盖，现在是版本 ${outcome.remoteRevision}。`);
      setSaveState('cloud-saved');
      setCloudInfo({ revision: outcome.remoteRevision, confirmedAt: Date.now() });
      finishCloudSync(saveScope, seq, { revision: outcome.remoteRevision });
    });
  }, [slotId, saveScope, activityName, activityScopedPlan, controller]);

  /** 冲突二选一「用服务器那版」：读回来盖掉本机这版。 */
  const useServerVersion = useCallback(() => {
    const session = sessionRef.current;
    setSyncBusy(true);
    void pullOutdoorPlan(controller ?? null, session?.remoteActivityId()).then(remote => {
      setSyncBusy(false);
      if (!remote) {
        setSyncNote('没读到服务器那版，本机先不动。');
        return;
      }
      // 画布跟着 `plan` prop 走（outdoor-plan-canvas 里 `planRef.current = plan`），
      // 所以整份换成服务器那版只需换 state，不用逐项合。
      setPlan(remote.plan);
      setPlacePin(null);
      setPlaceArea(null);
      // 用户明确接受了远端版本：这才允许推进本会话的基线（冲突本身不算授权）。
      if (session) {
        session.acceptRemote({ remoteActivityId: session.remoteActivityId(), remoteRevision: remote.revision });
        const written = saveOutdoorProjectRecord(session.buildRecord({
          projectId: slotId,
          plan: remote.plan,
          name: remote.name || undefined,
          unsyncedPlan: false,
        }), undefined, !activityScopedPlan);
        if (written.ok) session.markPersisted(remote.plan);
        else setLocalSaveFailure(localSaveFailureMessage(written.reason));
      }
      syncConflictRef.current = null;
      setSyncConflict(null);
      setSyncNote(`已换成服务器那版（版本 ${remote.revision}）。`);
      setSaveState('cloud-saved');
      setCloudInfo({ revision: remote.revision, confirmedAt: Date.now() });
      finishCloudSync(saveScope, startCloudSync(saveScope), { revision: remote.revision });
    });
  }, [slotId, saveScope, activityScopedPlan, controller]);
  useEffect(() => {
    if (plan == null) return;
    // F9：盘上已经就是这份内容（刚打开 / 刚存完）→ 不写盘、不推云端。
    if (sessionRef.current?.isPersisted(plan)) return;
    setSaveState('saving');
    const timer = window.setTimeout(() => {
      pendingSaveRef.current = null;
      flushSave();
    }, AUTOSAVE_DEBOUNCE_MS);
    pendingSaveRef.current = timer;
    return () => { window.clearTimeout(timer); };
  }, [plan, flushSave]);
  // B1：关页/刷新/切后台时补一次 flush。
  // 原先只在卸载时补一次，而关标签页/刷新不保证有卸载时机（移动端通常直接 pagehide）。
  useEffect(() => {
    const flushPending = (localOnly: boolean) => {
      if (pendingSaveRef.current === null) return; // 没有待存内容：不制造无谓写盘
      window.clearTimeout(pendingSaveRef.current);
      pendingSaveRef.current = null;
      flushSave({ localOnly });
    };
    // pagehide：页面正在销毁，只做同步本机写入（网络请求不保证发得出去）。
    const onPageHide = () => flushPending(true);
    // 切到后台/切标签页：页面还活着，照常结算云端副本。
    const onVisibility = () => { if (document.visibilityState === 'hidden') flushPending(false); };
    window.addEventListener('pagehide', onPageHide);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pagehide', onPageHide);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [flushSave]);
  // 打开后补推：上次关页只落了本机、或上一轮云端没推上去的改动，重开时补一次。
  // 干净打开不会走这里（F9）——盘上内容已被云端确认过。
  useEffect(() => {
    if (loadedSlotId !== slotId) return;
    if (catchUpPushedRef.current === slotId) return;
    const session = sessionRef.current;
    if (!session?.shouldCatchUpPush()) return;
    const timer = window.setTimeout(() => {
      const current = planRef.current;
      const guard = writeGuardRef.current;
      if (!current || syncConflictRef.current || catchUpPushedRef.current === slotId) return;
      // 租约已落定：被别的窗口占着就绝不推（那是未经授权的覆盖）。
      if (guard && guard.mode() === 'blocked') return;
      catchUpPushedRef.current = slotId;
      runCloudPush(session.buildRecord({ projectId: slotId, plan: current, name: activityName, unsyncedPlan: true }), current);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadedSlotId, slotId, activityName, runCloudPush]);
  useEffect(() => () => {
    if (pendingSaveRef.current !== null) flushSave();
  }, [flushSave]);
  // 快捷条只在鼠标悬停/点按时展开；点外面或 Esc 收起。完整面板同样支持 Esc / 点地图关闭。
  useEffect(() => {
    if (!layerStripOpen) return;
    const closeOnOutside = (event: PointerEvent) => {
      if (layerDockRef.current?.contains(event.target as Node)) return;
      setLayerStripOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setLayerStripOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutside, true);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutside, true);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [layerStripOpen]);
  // 完整「地图详情」是模态浮层：Esc 或点画布都能关；标题与 X 固定，不随面板内容滚动。
  useEffect(() => {
    if (!mapPickerOpen) return;
    const closeOnOutside = (event: PointerEvent) => {
      if (layerDockRef.current?.contains(event.target as Node)) return;
      setMapPickerOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.isComposing) return;
      event.preventDefault();
      event.stopPropagation();
      setMapPickerOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutside, true);
    document.addEventListener('keydown', closeOnEscape, true);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutside, true);
      document.removeEventListener('keydown', closeOnEscape, true);
    };
  }, [mapPickerOpen]);
  useEffect(() => {
    onSaveStateChange?.({
      state: saveState,
      savedAt,
      scope: saveScope,
      ...(cloudInfo.revision !== null ? { cloudRevision: cloudInfo.revision } : {}),
      ...(cloudInfo.confirmedAt !== null ? { cloudConfirmedAt: cloudInfo.confirmedAt } : {}),
      ...(saveState === 'cloud-failed' ? { detail: '云端副本暂未同步；本机这版还在，稍后自动重试。' } : {}),
      ...(saveState === 'local-failed' && localSaveFailure ? { detail: localSaveFailure } : {}),
      ...(saveState === 'blocked' && writeBlocked ? { detail: writeBlocked } : {}),
      ...(saveState === 'conflict' && syncConflict ? { detail: `云端已是版本 ${syncConflict.revision}（${syncConflict.name}），需要你选择保留哪一版。` } : {}),
    });
  }, [saveState, savedAt, saveScope, cloudInfo, syncConflict, localSaveFailure, writeBlocked, onSaveStateChange]);

  function exportPlanPng(): boolean {
    const current = planRef.current;
    if (!current) return false;
    const canvases = document.querySelectorAll<HTMLCanvasElement>('canvas');
    const planCanvas = canvases[canvases.length - 1];
    if (!planCanvas) return false;
    downloadPlanPng({ plan: current, planCanvas, revision: 1, dpi: 300 });
    return true;
  }

  // P2-g：对外命令句柄（室内工具排的撤销/重做/缩放/导出转发到这里）。
  // 不写依赖数组：每帧重建，句柄永远拿到当帧闭包（内部读的都是 ref/最新 state）。
  useImperativeHandle(ref, () => ({
    zoomBy: (direction: 1 | -1) => {
      canvasApiRef.current?.zoomBy(direction);
    },
    getCanvasApi: () => canvasApiRef.current,
    captureImage: () => canvasApiRef.current?.captureImage() ?? null,
    captureStageImage: () => canvasApiRef.current?.captureStageImage() ?? null,
    exportPng: () => exportPlanPng(),
    exportCsv: () => { if (plan) downloadPlanCsv(plan, exportStem, lengthUnit); },
    exportGeoJson: () => { if (plan) downloadPlanGeoJson(plan, exportStem); },
    exportPdf: () => printDeck(),
    undo: () => canvasApiRef.current?.undo(),
    redo: () => canvasApiRef.current?.redo(),
    setCanvasMode: (mode: 'view' | 'select') => canvasApiRef.current?.setMode(mode),
    setToolMode: (mode: string) => canvasApiRef.current?.setMode(mode),
    setMeasureKind: (kind: 'distance' | 'area') => canvasApiRef.current?.setMeasureKind(kind),
    getMeasureKind: () => canvasApiRef.current?.getMeasureKind() ?? 'distance',
    setSnapOn: (on: boolean) => canvasApiRef.current?.setSnapOn(on),
  setInspector: (open: boolean, tab?: 'measure' | 'annotate' | 'selection') => canvasApiRef.current?.setInspector(open, tab),
  focusVenue: () => {
    const current = planRef.current;
    if (!current?.anchor) return;
    const { lng, lat } = current.anchor;
    if (current.boundary && current.boundary.length >= 3) {
      const geos = current.boundary.map(point => enuToLngLat(point.x, point.y, lng, lat));
      const lngs = geos.map(g => g.lng);
      const lats = geos.map(g => g.lat);
      canvasApiRef.current?.focusBounds([Math.min(...lngs), Math.min(...lats), Math.max(...lngs), Math.max(...lats)]);
    } else {
      canvasApiRef.current?.focusLngLat(lng, lat);
    }
  },
  focusDesignScope: () => {
    // 2026-11-16 用户指令：左栏「定位到设计范围」那行已经删了，同样的事改由右轨焦点钮发起。
    // 只框视图、不改 plan；没范围时画布内部静默不动，调用方自己回落。
    canvasApiRef.current?.focusDesignScope();
  },
  // 2026-11-16 罗盘拖转 2D：句柄透传（无画布时 no-op）。
  orbitByDelta: (deltaRad: number) => canvasApiRef.current?.orbitByDelta(deltaRad),
  resetNorth: () => canvasApiRef.current?.resetNorth(),
  getBearing: () => canvasApiRef.current?.getBearing() ?? 0,
  }));

  // P2-g：计划变更上报（2D 边界 → 3D 场地壳体联动的入口；初次载入也报一次）。
  useEffect(() => {
    if (plan) onPlanChange?.(plan);
  }, [plan, onPlanChange]);

  const exportStem = activityName?.trim() || 'outdoor-plan';

  function printDeck(): void {
    if (!plan) return;
    const canvases = document.querySelectorAll<HTMLCanvasElement>('canvas');
    const planCanvas = canvases[canvases.length - 1];
    const pngCanvas = planCanvas ? composePlanPng({ plan, planCanvas, revision: 1, dpi: 72 }) : undefined;
    printPlanDeck(
      { planId: typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : '99999999-9999-4999-8999-999999999999',
        projectId: slotId === LOCAL_DRAFT_SLOT ? '88888888-8888-4888-8888-888888888888' : slotId,
        revision: 1, updatedAt: new Date().toISOString(), data: plan },
      pngCanvas?.toDataURL('image/png'),
    );
  }

  const currentSource = SOURCE_CYCLE.find(s => s.id === source) ?? SOURCE_CYCLE[0];
  // 真瓦片缩略图的取图中心：plan.anchor（GCJ-02，铺瓦片同口径）；plan 未载入时回落手绘示意。
  const thumbAnchor = plan?.anchor ?? null;
  // 3D 接管态（dormant）下本覆盖层只是「保活的编辑桥」：2D 画面、浮层、切换钮全部不出镜；
  // 例外是左下「图层」dock（2026-11-16 用户指令 3D 也要可换底图，dock 自行翻回 visible）。
  const canvasHidden = dormant;

  return (
    <div
      data-testid="outdoor-overlay"
      style={{ position: 'absolute', inset: 0, zIndex: 30, background: dormant ? 'transparent' : 'var(--sc-surface, #ffffff)', color: 'var(--sc-ink, #141416)', ...(dormant ? { visibility: 'hidden' as const, pointerEvents: 'none' as const } : {}) }}
    >
      {/* 2026-11-15：属性卡不再自己开一张原位生成表单，统一进「生成」面板（见 GenerationSheetHost）。 */}
      {syncNote || syncConflict ? (
        <OutdoorSyncBanner
          note={syncNote}
          conflict={syncConflict}
          busy={syncBusy}
          onUseMine={useMyVersion}
          onUseRemote={useServerVersion}
        />
      ) : null}
      {/* 2026-11-20（B2/B6）：本机写失败、或写租约在另一个窗口手里——这两种必须一直看得见，
          不能只停在「云端未同步」或一句自动退场的提示上。 */}
      {localSaveFailure || writeBlocked ? (
        <div style={SAVE_ALERT_STACK}>
          {localSaveFailure ? (
            <div role="alert" data-testid="outdoor-local-save-error" style={{ ...SAVE_ALERT_SHELL, border: '1px solid rgba(255,120,90,0.55)' }}>
              <span>{localSaveFailure}</span>
              <button type="button" data-testid="outdoor-local-save-retry" style={SAVE_ALERT_ACTION} onClick={() => { flushRef.current?.(); }}>
                重试保存
              </button>
            </div>
          ) : null}
          {writeBlocked ? (
            <div role="alert" data-testid="outdoor-write-blocked" style={SAVE_ALERT_SHELL}>{writeBlocked}</div>
          ) : null}
        </div>
      ) : null}
      {plan && loadedSlotId === slotId && (
        <div style={{ position: 'absolute', inset: 0, visibility: canvasHidden ? 'hidden' : 'visible', pointerEvents: canvasHidden ? 'none' : 'auto' }}>
          <OutdoorPlanCanvas
            key={slotId}
            generationProjectId={slotId}
            ref={canvasApiRef}
            plan={plan}
            source={source}
            // 2026-11-11 用户拍板：户外默认有地理锚点（起步计划自带预置锚点、旧草稿一次性回填），
            // 默认铺真地图；「隐藏底图」钮把纸面平面底（P4-b）变成用户显式选择的形态，
            // 业务图层在两种形态下照常叠加。
            base={geoHidden ? 'floor' : 'map'}
            onPlanChange={setPlan}
            {...(planEditor ? { planEditor } : {})}
            onVenueBoundaryApplied={agent?.manualOutdoorVenueApplied}
            onVenueBoundaryCanceled={agent?.manualOutdoorVenueCanceled}
            {...(onHistoryChange ? { onHistoryChange } : {})}
            {...(onModeChange ? { onModeChange: mode => onModeChange(mode) } : {})}
            {...(onInspectorChange ? { onInspectorChange } : {})}
            {...(inspectorHostId ? { inspectorHostId } : {})}
            panelsHostId="outdoor-panel-host-layers"
            infoPanelHostId="outdoor-panel-host-inventory"
            libraryPanelHostId="outdoor-panel-host-library"
            levelsHostId="outdoor-panel-host-levels"
            measureHostId="outdoor-panel-host-measure"
            annotateHostId="outdoor-panel-host-annotate"
            onActiveLevelChange={onActiveLevelChange}
            sceneObjects={sceneObjects}
            {...(scanPin ? { scanPin } : {})}
            renderScanPlan={renderScanPlan} scanError={scanError}
            {...(placePin ? { searchPin: placePin } : {})}
            {...(placeArea ? { searchArea: placeArea } : {})}
            {...(agent?.routeProposal ? { routeProposal: agent.routeProposal } : {})}
            workflowPreview={agent?.outdoorWorkflow?.proposal?.next??null}
            workflowScopePreview={agent?.outdoorWorkflow?.proposal?.kind === 'scope'}
            mapEditHighlight={agent?.outdoorWorkflow?.appliedHighlight ?? null}
            evidenceHighlights={evidenceHighlights}
            {...(agent?.zoneProposal ? { zoneProposal: agent.zoneProposal } : {})}
            {...(agent?.flowSimActive ? { flowSimRoutes: plan?.routes ?? null } : null)}
            generationController={controller}
            {...(confirmedCaseView ? { initialView: { lng: confirmedCaseView.lng, lat: confirmedCaseView.lat, zoom: confirmedCaseView.zoom, bearing: -confirmedCaseView.rotationDeg * Math.PI / 180 } } : defaultOverview ? { initialView: defaultOverview } : anchor ? { initialView: { lng: anchor.lng, lat: anchor.lat } } : {})}
          />
        </div>
      )}
      {/* 查询真实轮廓有总预算；未命中如实提示手画，不自动重复请求。
          与画布白底名称胶囊同范式；只压 2D 画面，3D/接管态不出镜。 */}
      {(shapeLoading || shapeUnavailable) && !canvasHidden && (
        <div
          data-testid="outdoor-shape-loading"
          className="sc-shape-loading-pill"
          style={{ position: 'absolute', top: 14, left: '50%', transform: 'translateX(-50%)', zIndex: 4 }}
        >
          {shapeLoading ? '正在圈范围…' : '暂未取得真实范围，可在地图上手画'}
        </div>
      )}
      {/* 2026-11-15 旧独立分享/导出钮退役：分享、导出、发布统一收进右上工具簇的 ShareMenu 面板，
          本覆盖层不再自摆快捷钮。2026-11-18：旧 OutdoorDeliveryPanel 与其导出宿主接线一并删除，
          评审/导出只保留 ShareMenu 一条路径。 */}
      {/* 2026-11-16 用户指令：左下只保留一枚「图层」缩略钮；点开是「地图详情」面板，
          面板盖住地图和入口，关闭只走右上角 X，关掉后回到这一枚图层钮。
          2026-11-16 用户指令「这个在 3D 的时候也补上」：接管态（dormant）下整层 visibility:hidden，
          但图层 dock 单独翻回 visible（CSS visibility 子元素可覆盖；同 inspector 卡出镜手法）——
          换图源写 writePlanGroundSource、纸面写 writePlanGroundMode（docs/46 V-P1），3D 地面经 useSyncExternalStore 自动跟随。 */}
      <div
        ref={layerDockRef}
        className="oc-layer-dock"
        style={{ position: 'absolute', left: 24, bottom: 'var(--oc-layer-bottom, 20px)', zIndex: mapPickerOpen ? 20 : 4, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 8, ...(dormant ? { visibility: 'visible' as const, pointerEvents: 'auto' as const } : {}) }}
      >
        {mapPickerOpen ? (
          <MapDetailsPanel
            source={source}
            geoHidden={geoHidden}
            lngLat={thumbAnchor}
            onPickSource={id => { setSource(id); setGeoHidden(false); }}
            onTogglePaper={() => setGeoHidden(value => !value)}
            onClose={() => setMapPickerOpen(false)}
          />
        ) : (
          <>
            <button
              type="button"
              id="tool-outdoor-source"
              data-testid="outdoor-source-cycle"
              aria-label={`图层，当前底图 ${currentSource.label}${geoHidden ? '（纸面）' : ''}`}
              aria-expanded={layerStripOpen}
              aria-controls="outdoor-layer-strip"
              data-tip="图层 · 点按快速换底图"
              onClick={() => setLayerStripOpen(value => !value)}
              className="oc-layer-entry"
            >
              {/* 2026-11-16 用户指令：缩略图跟当前图源走（原来写死 amap-satellite）；纸面态给纸面格。 */}
              <span className="oc-layer-entry__thumb" aria-hidden="true">
                {geoHidden
                  ? <span className="oc-layer-entry__thumb--paper" />
                  : <RealSourceThumb id={source} lngLat={thumbAnchor} />}
              </span>
              <span className="oc-layer-entry__caption">
                <Layers3 size={16} strokeWidth={1.8} aria-hidden="true" />
                <span>图层</span>
              </span>
            </button>
            {layerStripOpen && (
              <div
                id="outdoor-layer-strip"
                data-testid="outdoor-layer-strip"
                role="group"
                aria-label="快速切换底图"
                className="oc-layer-strip"
              >
                {FEATURED_SOURCES.map(option => {
                  const active = !geoHidden && source === option.id;
                  return (
                    <button
                      key={option.id}
                      type="button"
                      data-testid={option.id === 'amap-streets' ? 'map-strip-current' : `map-strip-${option.id}`}
                      aria-label={`底图：${option.label}`}
                      aria-pressed={active}
                      className="oc-layer-strip__row"
                      onClick={() => { setSource(option.id); setGeoHidden(false); setLayerStripOpen(false); }}
                    >
                      <span className="oc-layer-strip__thumb" aria-hidden="true">
                        <RealSourceThumb id={option.id} lngLat={thumbAnchor} />
                      </span>
                      <span className="oc-layer-strip__label">{option.label}</span>
                    </button>
                  );
                })}
                {/* 2026-11-17 用户指令：纸面进快速弹层（虚拟场地主形态）；docs/46 V-P1 后 3D 也认纸面，接管态照常给。 */}
                <button
                  type="button"
                  data-testid="map-strip-paper"
                  aria-label="底图：纸面"
                  aria-pressed={geoHidden}
                  className="oc-layer-strip__row"
                  onClick={() => { setGeoHidden(true); setLayerStripOpen(false); }}
                >
                  <span className="oc-layer-strip__thumb oc-layer-strip__thumb--paper" aria-hidden="true" />
                  <span className="oc-layer-strip__label">纸面</span>
                </button>
                {/* 2026-11-17 用户指令：展开不再占一格缩略钮——缩成底部一小行文字。 */}
                <button
                  type="button"
                  data-testid="map-strip-expand"
                  aria-label="展开地图详情"
                  aria-haspopup="dialog"
                  aria-controls="outdoor-map-details"
                  className="oc-layer-strip__row oc-layer-strip__row--slim"
                  onClick={() => { setLayerStripOpen(false); setMapPickerOpen(true); }}
                >
                  <span className="oc-layer-strip__label oc-layer-strip__label--with-icon">
                    <LayoutGrid size={12} strokeWidth={1.8} aria-hidden="true" />
                    <span>展开</span>
                  </span>
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
});

export default OutdoorPlanOverlay;

