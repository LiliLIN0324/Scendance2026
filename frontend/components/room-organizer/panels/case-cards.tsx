'use client';

import { useMemo } from 'react';
import { REPLICA_CASES, type ReplicaCase } from '../lib/replica-cases';
import { CaseThumb } from './case-thumb';

/**
 * 2026-11-17 用户：「经典案例我要的也是和其他的视觉一样的卡片预览图」。
 *
 * 与示例场景共用一套卡形（.sc-space-samples / .sc-space-sample），左侧预览是该案复刻方案的缩略。
 * 方案在挂载时算一次（buildPlan 会过一遍 schema，44 案不值得每次渲染重算）；
 * 整段由外层 details 懒挂载——收着的时候一张都不建。
 */
export function CaseCards({ onOpen }: { onOpen(replica: ReplicaCase): void }): JSX.Element {
  const cards = useMemo(() => REPLICA_CASES.map(replica => ({ replica, plan: replica.buildPlan() })), []);

  return <ul className="sc-space-samples sc-space-cases">
    {cards.map(({ replica, plan }) => <li key={replica.id}>
      <button type="button" className="sc-space-sample" onClick={() => onOpen(replica)}
        title={replica.locationNote ? `${replica.title} · ${replica.locationNote}` : replica.title}
        aria-label={`打开经典案例 ${replica.title}`}>
        <CaseThumb plan={plan}/>
        <strong>{replica.title}</strong>
        <span>{replica.category} · {replica.region}</span>
      </button>
    </li>)}
  </ul>;
}
