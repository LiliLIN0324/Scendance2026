"use client";

/**
 * 方案结果卡（2026-11-20 场地自主规划交互 P1）。
 *
 * 只做展示与动作派发：
 * - 摘要讲「为什么这样排 / 实际摆下多少 / 哪些是假设」，不重复聊天里的状态卡，也不显示几何日志全文；
 * - 分区与设施条目可点，点位由调用方转给画布（这里不改坐标、不抢镜头）；
 * - 当前选中对象作为可见、可清除的聊天上下文挂在这张卡上；
 * - 本次变化（新增/移动/删除）与撤销、候选 A/B 比较都只在这里出现一次。
 *
 * 设计规范：白纸 + 发丝线，品牌绿只用于选中态与「采用」这类唯一主动作；
 * 数字统一 tabular-nums；同一区域最多三档字号（16 / 14 / 12）。
 */
import type { DesignSummary } from "../lib/outdoor-design-summary";
import "./outdoor-design-result-card.css";

export interface DesignResultCardModel {
  title: string;
  summary: DesignSummary;
  state: "proposal" | "applied";
  change?: { headline: string; details: string[] } | null;
  pending?: { why: string } | null;
  selection?: { count: number; labels: string[]; detached: boolean } | null;
  compare?: {
    activeId: string;
    candidates: Array<{ id: string; label: string; seats: string; tradeoff: string }>;
  } | null;
  compareBusy?: boolean;
  compareNote?: string | null;
  locateNote?: string | null;
}

export interface DesignResultCardActions {
  onLocateZone?: (zoneId: string) => void;
  onLocateSelection?: () => void;
  onClearSelection?: () => void;
  onUndo?: () => void;
  onConfirmPending?: () => void;
  onDismissPending?: () => void;
  onOpenCompare?: () => void;
  onCloseCompare?: () => void;
  onSelectCandidate?: (id: string) => void;
  onAdoptCandidate?: () => void;
}

export function OutdoorDesignResultCard({
  model,
  actions = {},
}: {
  model: DesignResultCardModel;
  actions?: DesignResultCardActions;
}) {
  const { summary } = model;
  const compare = model.compare ?? null;
  const activeCandidate = compare?.candidates.find((candidate) => candidate.id === compare.activeId) ?? null;

  return (
    <section className="ap-card oddrc" aria-label="方案摘要" data-testid="outdoor-design-result-card">
      <header className="ap-card-head oddrc-head">
        <strong>{model.title}</strong>
        <span className="oddrc-state" data-state={model.state}>
          {model.state === "applied" ? "已应用 · 可撤销" : "尚未写入画布"}
        </span>
      </header>

      <ol className="oddrc-reasons">
        {summary.reasons.map((reason) => (
          <li key={reason}>{reason}</li>
        ))}
      </ol>

      <dl className="oddrc-capacity">
        <div>
          <dt>观礼</dt>
          <dd>{summary.capacity.ceremonySeats}<span> 席</span></dd>
        </div>
        <div>
          <dt>宴席</dt>
          <dd>{summary.capacity.banquetSeats}<span> 席</span></dd>
        </div>
        <div>
          <dt>目标</dt>
          <dd>{summary.capacity.target}<span> 人</span></dd>
        </div>
      </dl>

      {summary.issues.length > 0 && (
        <div className="oddrc-issue" role="status">
          <span>需要处理后才算合格</span>
          <ul>
            {summary.issues.map((issue) => <li key={issue}>{issue}</li>)}
          </ul>
        </div>
      )}

      {summary.zones.length > 0 && (
        <div className="oddrc-zones" aria-label="定位到画布分区">
          {summary.zones.map((zone) => (
            <button
              key={zone.id}
              type="button"
              className="chip oddrc-zone"
              onClick={() => actions.onLocateZone?.(zone.id)}
              aria-label={`定位到${zone.name}（${zone.facilityCount} 件）`}
            >
              {zone.name}
              <span className="oddrc-zone-count">{zone.facilityCount}</span>
            </button>
          ))}
        </div>
      )}

      {summary.assumptions.length > 0 && (
        <details className="oddrc-assumptions">
          <summary>关键假设 · {summary.assumptions.length}</summary>
          <ul>
            {summary.assumptions.map((assumption) => <li key={assumption}>{assumption}</li>)}
          </ul>
        </details>
      )}

      {model.selection && model.selection.count > 0 && (
        <div className="oddrc-context" data-detached={model.selection.detached || undefined}>
          <span className="oddrc-context-label">下一句的对象</span>
          <span className="oddrc-context-body">
            {model.selection.detached
              ? "已清除引用，下一句不会改这组"
              : `已选 ${model.selection.count} 件${model.selection.labels.length ? `：${model.selection.labels.join("、")}` : ""}`}
          </span>
          <button
            type="button"
            className="oddrc-context-action"
            onClick={() => (model.selection!.detached ? actions.onLocateSelection?.() : actions.onClearSelection?.())}
          >
            {model.selection.detached ? "重新取回" : "清除引用"}
          </button>
        </div>
      )}

      {model.change && (
        <div className="oddrc-change">
          <p className="oddrc-change-head">{model.change.headline}</p>
          {model.change.details.length > 0 && (
            <ul>
              {model.change.details.map((detail) => <li key={detail}>{detail}</li>)}
            </ul>
          )}
          {model.state === "applied" && actions.onUndo && (
            <button type="button" className="btn-outline oddrc-undo" onClick={actions.onUndo}>
              撤销这次
            </button>
          )}
        </div>
      )}

      {model.pending && (
        <div className="oddrc-pending" role="alert">
          <p>{model.pending.why}</p>
          <div className="ap-card-actions">
            <button type="button" className="btn-primary" onClick={actions.onConfirmPending}>确认应用</button>
            <button type="button" className="btn-outline" onClick={actions.onDismissPending}>先不应用</button>
          </div>
        </div>
      )}

      {compare ? (
        <div className="oddrc-compare" aria-label="候选方案比较">
          <div className="oddrc-compare-tabs" role="tablist" aria-label="候选方案">
            {compare.candidates.map((candidate) => (
              <button
                key={candidate.id}
                type="button"
                role="tab"
                aria-selected={compare.activeId === candidate.id}
                className="chip"
                data-active={compare.activeId === candidate.id || undefined}
                onClick={() => actions.onSelectCandidate?.(candidate.id)}
                disabled={model.compareBusy}
              >
                {candidate.id} · {candidate.label}
              </button>
            ))}
          </div>
          {activeCandidate && (
            <div className="oddrc-compare-body">
              <p className="oddrc-compare-seats">{activeCandidate.seats}</p>
              <p className="oddrc-compare-tradeoff">{activeCandidate.tradeoff}</p>
            </div>
          )}
          {model.compareNote && <p className="oddrc-note">{model.compareNote}</p>}
          <div className="ap-card-actions">
            <button
              type="button"
              className="btn-primary"
              disabled={model.compareBusy}
              onClick={actions.onAdoptCandidate}
            >
              采用这一版
            </button>
            <button type="button" className="btn-outline" onClick={actions.onCloseCompare}>
              结束比较
            </button>
          </div>
        </div>
      ) : (
        actions.onOpenCompare && (
          <div className="ap-card-actions">
            <button type="button" className="btn-outline" disabled={model.compareBusy} onClick={actions.onOpenCompare}>
              {model.compareBusy ? "正在算另一版…" : "比较方案"}
            </button>
          </div>
        )
      )}

      {model.locateNote && <p className="oddrc-note" role="status">{model.locateNote}</p>}
    </section>
  );
}
