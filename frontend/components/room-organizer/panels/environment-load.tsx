'use client';

import { useEffect, useState } from 'react';
import { BrandMark } from '../../brand-mark';
import './environment-load.css';

const LEAVE_MS = 280;

/** 0..1，长度未知或非数字时不当成进度。 */
export function environmentLoadRatio(progress: number | undefined): number | undefined {
  if (progress === undefined || !Number.isFinite(progress)) return undefined;
  return Math.min(1, Math.max(0, progress));
}

/**
 * 环境预览 / World 高斯还在取回、解码时，画布中央那一块静静的灰没有在动。
 * 这里只铺一个轻标记：门厅短脉冲 + 一条会走的鼠尾草绿，铺开后自己淡掉。
 */
export function EnvironmentLoad({ active, name, progress }: {
  active: boolean;
  name: string;
  progress?: number;
}): JSX.Element | null {
  const [phase, setPhase] = useState<'off' | 'on' | 'leaving'>(active ? 'on' : 'off');
  useEffect(() => {
    setPhase(current => (active ? 'on' : current === 'off' ? 'off' : 'leaving'));
  }, [active]);
  useEffect(() => {
    if (phase !== 'leaving') return undefined;
    const timer = window.setTimeout(() => setPhase('off'), LEAVE_MS);
    return () => window.clearTimeout(timer);
  }, [phase]);

  if (phase === 'off') return null;
  const label = name.trim() || '高斯场景';
  const ratio = environmentLoadRatio(progress);
  // 0% 的实心条看起来仍是一条死线：长度还没动之前用扫动，动了再跟上真实比例。
  const determinate = ratio !== undefined && ratio > 0;
  const percent = determinate ? Math.round(ratio * 100) : undefined;

  return (
    <div
      className={`sc-env-load${phase === 'leaving' ? ' is-leaving' : ''}`}
      role="status"
      aria-live="polite"
      aria-label={`正在铺开环境「${label}」`}
    >
      <div className="sc-env-load-mark" aria-hidden="true">
        <span className="sc-env-load-ring" />
        <BrandMark size={28} />
      </div>
      <p className="sc-env-load-kicker">正在铺开环境</p>
      <p className="sc-env-load-name">{label}</p>
      <div
        className="sc-env-load-track"
        role="progressbar"
        aria-label="环境铺开进度"
        aria-valuemin={0}
        aria-valuemax={100}
        {...(percent === undefined ? {} : { 'aria-valuenow': percent })}
      >
        <span
          className={`sc-env-load-fill${determinate ? '' : ' is-unknown'}`}
          style={determinate ? { width: `${percent}%` } : undefined}
        />
      </div>
      <p className="sc-env-load-meta">{percent === undefined ? '正在取回高斯' : `${percent}%`}</p>
    </div>
  );
}
