'use client';

import { useState } from 'react';

/**
 * 覆盖环：把「已经拍过的方向」画成罗盘。
 * 只回答一件事：还有哪一格没拍到、往哪走。空洞可点，给一句方向提示。
 */

const SEGMENTS = 24;
const SEGMENT_DEG = 360 / SEGMENTS;

const DIRECTION_LABELS = Array.from({ length: SEGMENTS }, (_, index) => `${index * SEGMENT_DEG}°`);

function polar(deg: number, radius: number): [number, number] {
  const rad = ((deg - 90) * Math.PI) / 180;
  return [50 + Math.cos(rad) * radius, 50 + Math.sin(rad) * radius];
}

function sectorPath(startDeg: number, endDeg: number): string {
  const [ox1, oy1] = polar(startDeg, 45);
  const [ox2, oy2] = polar(endDeg, 45);
  const [ix2, iy2] = polar(endDeg, 27);
  const [ix1, iy1] = polar(startDeg, 27);
  const large = endDeg - startDeg > 180 ? 1 : 0;
  return `M ${ox1} ${oy1} A 45 45 0 ${large} 1 ${ox2} ${oy2} L ${ix2} ${iy2} A 27 27 0 ${large} 0 ${ix1} ${iy1} Z`;
}

export interface CoverageDialProps {
  headings: Array<number | null>;
  coverageDeg: number;
  compact?: boolean;
}

export function CoverageDial({ headings, coverageDeg, compact = false }: CoverageDialProps): JSX.Element {
  const [selectedGap, setSelectedGap] = useState<number | null>(null);
  const covered = new Set<number>();
  for (const heading of headings) {
    if (heading === null || !Number.isFinite(heading)) continue;
    covered.add(Math.floor((((heading % 360) + 360) % 360) / SEGMENT_DEG));
  }
  const gapCount = SEGMENTS - covered.size;
  const selectedDirection = selectedGap === null ? null : DIRECTION_LABELS[selectedGap] ?? '这一侧';

  return (
    <section className={`cg-dial${compact ? ' is-compact' : ''}`} data-testid="coverage-dial">
      <svg viewBox="0 0 100 100" role="img" aria-label={`环向覆盖 ${Math.round(coverageDeg)} 度，缺失 ${gapCount} 格`}>
        <circle cx="50" cy="50" r="45" className="cg-dial-track" />
        {Array.from({ length: SEGMENTS }, (_, index) => {
          const start = index * SEGMENT_DEG + 0.9;
          const end = (index + 1) * SEGMENT_DEG - 0.9;
          const isCovered = covered.has(index);
          return (
            <path
              key={index}
              d={sectorPath(start, end)}
              className={isCovered ? 'cg-dial-seg is-covered' : 'cg-dial-seg is-gap'}
              role={isCovered ? undefined : 'button'}
              tabIndex={isCovered ? undefined : 0}
              aria-label={isCovered ? `${DIRECTION_LABELS[index]} 已覆盖` : `${DIRECTION_LABELS[index]} 还空着`}
              onClick={() => {
                if (!isCovered) setSelectedGap(index);
              }}
              onKeyDown={event => {
                if (!isCovered && (event.key === 'Enter' || event.key === ' ')) setSelectedGap(index);
              }}
            />
          );
        })}
        <text x="50" y="48" textAnchor="middle" className="cg-dial-value">
          {Math.round(coverageDeg)}°
        </text>
        <text x="50" y="58" textAnchor="middle" className="cg-dial-label">
          已覆盖 / {gapCount} 格空
        </text>
      </svg>
      <div className="cg-dial-copy">
        {selectedGap === null ? (
          <p>点亮的格子是已经拍过的方向。点空格，告诉你还差哪边。</p>
        ) : (
          <p className="is-warn">
            {selectedDirection} 方向还空着：朝那边走两步，站定后向外拍一张。
          </p>
        )}
      </div>
    </section>
  );
}
