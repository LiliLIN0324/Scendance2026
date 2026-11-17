import { useEffect, useRef, useState } from 'react';
import {
  LOCATE_FAILED_LABEL,
  LOCATE_FAILED_MS,
  LOCATE_PENDING_LABEL,
  LOCATE_PENDING_MS,
  type LocateOutcome,
} from '../lib/gm-locate';

type LocatePhase = 'idle' | 'pending' | 'failed';

/** 闲置时是 Google 网页版的准星；定位过程中换成地图上的蓝点。 */
function LocateCrosshair(): JSX.Element {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="6.15" stroke="currentColor" strokeWidth="1.7" />
      <circle cx="12" cy="12" r="2.05" fill="currentColor" />
      <path
        d="M12 2.15v2.55M12 19.3v2.55M2.15 12h2.55M19.3 12h2.55"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * 右下定位钮。进行中显示 Google 定位点（白环蓝心 + 精度圈），
 * 没有可框选场地时在钮旁说明失败，不再静默返回。
 */
export function GmLocateButton({
  label,
  onLocate,
}: {
  label: string;
  onLocate: () => LocateOutcome;
}): JSX.Element {
  const [phase, setPhase] = useState<LocatePhase>('idle');
  const phaseRef = useRef<LocatePhase>('idle');
  const timerRef = useRef(0);

  useEffect(() => () => window.clearTimeout(timerRef.current), []);

  const show = (next: Exclude<LocatePhase, 'idle'>): void => {
    window.clearTimeout(timerRef.current);
    phaseRef.current = next;
    setPhase(next);
    const wait = next === 'pending' ? LOCATE_PENDING_MS : LOCATE_FAILED_MS;
    timerRef.current = window.setTimeout(() => {
      phaseRef.current = 'idle';
      setPhase('idle');
    }, wait);
  };

  const press = (): void => {
    if (phaseRef.current === 'pending') return;
    show(onLocate() === 'moved' ? 'pending' : 'failed');
  };

  const status = phase === 'pending' ? LOCATE_PENDING_LABEL : phase === 'failed' ? LOCATE_FAILED_LABEL : null;

  return (
    <>
      <button
        type="button"
        className={`oc-gm-round gm-locate${phase === 'idle' ? '' : ` is-${phase}`}`}
        data-testid="gm-locate"
        data-tip={label}
        aria-label={label}
        aria-busy={phase === 'pending'}
        onClick={press}
      >
        {phase === 'pending' ? (
          <span className="gm-locate-point" data-testid="gm-locate-point">
            <span className="gm-locate-accuracy" data-testid="gm-locate-accuracy" />
            <span className="gm-locate-core" data-testid="gm-locate-core" />
          </span>
        ) : (
          <LocateCrosshair />
        )}
      </button>
      {status && (
        <span className="gm-locate-status" role="status" data-testid="gm-locate-status">
          {status}
        </span>
      )}
    </>
  );
}
