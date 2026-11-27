'use client';

import { useState } from 'react';
import { useRoomEditorOptional } from '../contexts';
import { useSidecarResolution } from '../hooks/use-sidecar-resolution';
import { MAX_DESIGNS, removeDesignVariant, saveDesignSnapshot, switchDesign } from '../lib/scene-layers';
import { prepareVariantSaveAs, type VariantSaveAsDraft } from '../lib/variant-save-as';
import { buildVariantSaveMeta, formatVariantSummaryLine, variantHasReference } from '../lib/variant-summary';
import type { EventOperations } from '../../../../supabase/functions/_shared/event-operations-contract';
import type { ProductionPlan } from '../../../../supabase/functions/_shared/production-plan-contract';
import type { DesignVariant, RoomLayout } from '../lib/types';
import './design-history-panel.css';

export interface DesignHistoryPanelProps {
  layout: RoomLayout;
  onApply: (next: RoomLayout) => void;
  disabled?: boolean;
  /** E3：对单个变体显式另存为新场地。纯函数产出的草稿与待落侧车清单随回调上抛；
   *  建项目 / 落记录 / 挂 ref 的编排由壳层承担。未提供时入口禁用。 */
  onSaveAsVariant?: ((variant: DesignVariant, draft: VariantSaveAsDraft) => void) | undefined;
}

function formatSavedAt(iso?: string): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function variantKind(variant: DesignVariant): string {
  if (variant.id === 'original') return '原始方案';
  if (variant.origin === 'manual') return '过程态';
  return 'AI 提案';
}

interface VariantHistoryRowProps {
  variant: DesignVariant;
  activeId: string | undefined;
  layout: RoomLayout;
  disabled?: boolean;
  onApply: (next: RoomLayout) => void;
  onSaveAsVariant?: ((variant: DesignVariant, draft: VariantSaveAsDraft) => void) | undefined;
}

/**
 * 单个变体行。hook 必须在组件顶层无条件调用：空 ref 的旧变体由 hook 同步回落内嵌副本，
 * 不碰 IDB；带 ref 时按 D6-2 同型三态解析，记录找不到 / 异项目标为 missing，几何照常可载入，
 * 业务事实标待核，不拿当前最新记录顶替、不按名称重挂。
 */
function VariantHistoryRow({ variant, activeId, layout, disabled = false, onApply, onSaveAsVariant }: VariantHistoryRowProps): JSX.Element {
  const { projectId } = useRoomEditorOptional() ?? {};
  const referenced = variantHasReference(variant);
  const operations = useSidecarResolution<EventOperations>({
    projectId: projectId ?? '',
    kind: 'operations',
    refId: variant.operationsRef,
    legacyFallback: variant.layout.eventOperations,
  });
  const plan = useSidecarResolution<ProductionPlan>({
    projectId: projectId ?? '',
    kind: 'plan',
    refId: variant.planRef,
    legacyFallback: variant.layout.productionPlan,
  });
  // 带引用但记录缺失、或登记了引用却缺扫描身份：业务事实待核；旧变体无引用不挡读取。
  const stale = referenced && (
    operations.status === 'missing' || plan.status === 'missing' || !variant.scan?.assetId?.trim()
  );
  const summaryLine = formatVariantSummaryLine(variant.summary);

  const isActive = variant.id === activeId;
  const isOriginal = variant.id === 'original';
  const savedAt = formatSavedAt(variant.savedAt);
  const hasGeometry = (variant.layout.floors ?? []).some(floor => (floor.items ?? []).length > 0);
  const canSaveAs = Boolean(onSaveAsVariant) && !disabled && hasGeometry;

  function handleSaveAs(): void {
    if (!onSaveAsVariant || !canSaveAs) return;
    const draft = prepareVariantSaveAs({ sourceProjectId: projectId ?? '', variant, operations, plan });
    onSaveAsVariant(variant, draft);
  }

  return (
    <li data-variant-id={variant.id} className={`dh-item${isActive ? ' is-active' : ''}`}>
      <div className="dh-item-head">
        <span className="dh-item-name">{variant.name}</span>
        <span className="dh-item-meta">
          {variantKind(variant)}
          {savedAt ? ` · ${savedAt}` : ''}
        </span>
      </div>
      {variant.note && <p className="dh-item-note">{variant.note}</p>}
      {summaryLine ? (
        <p className="dh-item-summary">{summaryLine}</p>
      ) : (
        <p className="dh-item-summary dh-pending">统计待核</p>
      )}
      {stale && <p className="dh-stale" role="alert">原方案未找到 / 已变动，待核</p>}
      <div className="dh-item-actions">
        {!isActive && !isOriginal && (
          <button type="button" className="sc-button" onClick={() => onApply(switchDesign(layout, variant.id))} disabled={disabled}>
            载入这一版
          </button>
        )}
        {isActive && <span className="dh-current">当前方案</span>}
        {!isActive && !isOriginal && (
          <button
            type="button"
            className="sc-button"
            onClick={handleSaveAs}
            disabled={!canSaveAs}
            title={!hasGeometry ? '缺几何物料，无法另存' : undefined}
          >
            另存为新场地
          </button>
        )}
        {!isActive && !isOriginal && (
          <button type="button" className="dh-remove" onClick={() => onApply(removeDesignVariant(layout, variant.id))} disabled={disabled}>
            移除
          </button>
        )}
      </div>
    </li>
  );
}

/** 本机方案过程态存档：把当前整包布局另存、载入或移除。不跨设备、不替业务落盘。 */
export function DesignHistoryPanel({ layout, onApply, disabled = false, onSaveAsVariant }: DesignHistoryPanelProps): JSX.Element {
  const { outdoorPlan } = useRoomEditorOptional() ?? {};
  const book = layout.designBook;
  const variants = book?.variants ?? [];
  const activeId = book?.activeId;
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const atLimit = variants.length >= MAX_DESIGNS;

  function saveCurrent(): void {
    setError('');
    if (disabled) return;
    try {
      const next = saveDesignSnapshot(layout, { name, note }, buildVariantSaveMeta(layout, outdoorPlan));
      onApply(next);
      setName('');
      setNote('');
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存过程态失败，请重试。');
    }
  }

  return (
    <div className="dh-history-panel">
      <div className="dh-save-form">
        <label className="dh-field">
          <span>过程态名称</span>
          <input
            value={name}
            onChange={event => setName(event.target.value)}
            placeholder={`如：迎宾区先落位`}
            disabled={disabled || atLimit}
            maxLength={40}
          />
        </label>
        <label className="dh-field">
          <span>备注（可选）</span>
          <input
            value={note}
            onChange={event => setNote(event.target.value)}
            placeholder="这一版保留了什么、下一步改什么"
            disabled={disabled || atLimit}
            maxLength={120}
          />
        </label>
        <button type="button" className="sc-button" onClick={saveCurrent} disabled={disabled || atLimit}>
          保存当前方案
        </button>
        {atLimit && <p className="dh-note">本机已保留 {MAX_DESIGNS} 个方案，请先移除不再需要的过程态。</p>}
        {error && <p className="dh-error" role="alert">{error}</p>}
      </div>

      {variants.length === 0 ? (
        <p className="dh-empty">还没有存档。到阶段版本时存一次。</p>
      ) : (
        <ul className="dh-list">
          {variants.map(variant => (
            <VariantHistoryRow
              key={variant.id}
              variant={variant}
              activeId={activeId}
              layout={layout}
              disabled={disabled}
              onApply={onApply}
              onSaveAsVariant={onSaveAsVariant}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
