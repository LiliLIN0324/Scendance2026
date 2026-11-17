import { memo, useCallback, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { COMPASS_STEP, roseRotationDeg } from '../lib/gm-compass-bearing';

/** 圆盘、箭头和按钮的绘制次数。方位只改外层 transform，这里不该跟着涨。 */
export const gmRoseArtRenders = { count: 0 };

type OrbitHandler = (deltaTheta: number, coalesce?: boolean) => void;

/**
 * 右下角圆形罗盘：深色圆盘、红白指北针、左右各一枚沿圆边的弯箭头。
 * 针和弯箭头在同一个旋转层里，随方位一起转。
 * 左箭头 `orbit(+π/2)`，右箭头 `orbit(-π/2)`，点针回正北；拖动按手指转角增量转。
 */
export const GmCompass = memo(function GmCompass({
  bearing,
  onOrbit,
  onReset,
}: {
  bearing: number;
  onOrbit: OrbitHandler;
  onReset: () => void;
}): JSX.Element {
  const dragRef = useRef<{ pointerId: number; cx: number; cy: number; last: number; travel: number; dragging: boolean } | null>(null);
  const suppressClick = useRef(false);
  const [dragging, setDragging] = useState(false);
  const [tip, setTip] = useState('');
  const showTip = useCallback((label: string) => setTip(label), []);

  const onFaceDown = useCallback((event: ReactPointerEvent<HTMLButtonElement>): void => {
    if (event.button !== 0) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    dragRef.current = {
      pointerId: event.pointerId,
      cx,
      cy,
      last: Math.atan2(event.clientY - cy, event.clientX - cx),
      travel: 0,
      dragging: false,
    };
    if (typeof event.currentTarget.setPointerCapture === 'function') event.currentTarget.setPointerCapture(event.pointerId);
  }, []);
  const onFaceMove = useCallback((event: ReactPointerEvent<HTMLButtonElement>): void => {
    const state = dragRef.current;
    if (!state || state.pointerId !== event.pointerId) return;
    const angle = Math.atan2(event.clientY - state.cy, event.clientX - state.cx);
    let delta = angle - state.last;
    if (delta > Math.PI) delta -= Math.PI * 2;
    if (delta < -Math.PI) delta += Math.PI * 2;
    state.last = angle;
    state.travel += Math.abs(delta);
    if (!state.dragging && state.travel > 0.12) {
      state.dragging = true;
      setDragging(true);
      setTip('');
    }
    if (!state.dragging) return;
    onOrbit(delta, true);
  }, [onOrbit]);
  const onFaceUp = useCallback((event: ReactPointerEvent<HTMLButtonElement>): void => {
    const state = dragRef.current;
    if (!state || state.pointerId !== event.pointerId) return;
    const dragged = state.dragging;
    dragRef.current = null;
    setDragging(false);
    if (dragged) {
      suppressClick.current = true;
      window.setTimeout(() => { suppressClick.current = false; }, 0);
    }
    try { event.currentTarget.releasePointerCapture(event.pointerId); } catch { /* 指针已释放。 */ }
  }, []);
  const turnLeft = useCallback((event: ReactMouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    onOrbit(COMPASS_STEP);
  }, [onOrbit]);
  const turnRight = useCallback((event: ReactMouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    onOrbit(-COMPASS_STEP);
  }, [onOrbit]);
  const resetNorth = useCallback(() => {
    if (suppressClick.current) { suppressClick.current = false; return; }
    onReset();
  }, [onReset]);

  return (
    <div className={`gm-rose${dragging ? ' is-dragging' : ''}`} data-testid="gm-rose" {...(tip ? { 'data-tip': tip } : {})}>
      <div
        className="gm-rose-spin"
        data-testid="gm-rose-spin"
        style={{ transform: `rotate(${roseRotationDeg(bearing)}deg)` }}
      >
        <RoseArt
          onFaceDown={onFaceDown}
          onFaceMove={onFaceMove}
          onFaceUp={onFaceUp}
          onReset={resetNorth}
          onTurnLeft={turnLeft}
          onTurnRight={turnRight}
          onTip={showTip}
        />
      </div>
    </div>
  );
});

const RoseArt = memo(function RoseArt({
  onFaceDown,
  onFaceMove,
  onFaceUp,
  onReset,
  onTurnLeft,
  onTurnRight,
  onTip,
}: {
  onFaceDown: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onFaceMove: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onFaceUp: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onReset: () => void;
  onTurnLeft: (event: ReactMouseEvent<HTMLButtonElement>) => void;
  onTurnRight: (event: ReactMouseEvent<HTMLButtonElement>) => void;
  onTip: (label: string) => void;
}): JSX.Element {
  gmRoseArtRenders.count += 1;
  return (
    <>
      <svg className="gm-rose-art" viewBox="0 0 44 44" aria-hidden="true">
        <circle cx="22" cy="22" r="21" fill="#1C1C1C" />
        <TurnArrow />
        <g transform="translate(44 0) scale(-1 1)">
          <TurnArrow />
        </g>
        <polygon points="22,9.45 26,22 18,22" fill="#DE3B3B" />
        <polygon points="22,34.55 26,22 18,22" fill="#CCCCCC" />
      </svg>
      <button
        type="button"
        className="gm-rose-turn is-left"
        aria-label="向左旋转 90 度"
        onPointerOver={() => onTip('向左旋转 90°')}
        onPointerOut={() => onTip('')}
        onFocus={() => onTip('向左旋转 90°')}
        onBlur={() => onTip('')}
        onClick={onTurnLeft}
      />
      <button
        type="button"
        className="gm-rose-turn is-right"
        aria-label="向右旋转 90 度"
        onPointerOver={() => onTip('向右旋转 90°')}
        onPointerOut={() => onTip('')}
        onFocus={() => onTip('向右旋转 90°')}
        onBlur={() => onTip('')}
        onClick={onTurnRight}
      />
      <button
        type="button"
        className="gm-rose-face"
        aria-label="回正北"
        onPointerOver={() => onTip('拖动旋转 · 点击回正北')}
        onPointerOut={() => onTip('')}
        onFocus={() => onTip('拖动旋转 · 点击回正北')}
        onBlur={() => onTip('')}
        onClick={onReset}
        onPointerDown={onFaceDown}
        onPointerMove={onFaceMove}
        onPointerUp={onFaceUp}
        onPointerCancel={onFaceUp}
      />
    </>
  );
});

function TurnArrow(): JSX.Element {
  // 按图 2 实测：弧线半径约 0.75R，线宽 1.4，距外缘约 4.6；
  // 三角头比线宽更大更长（对抗性对照后加大），右侧整组水平镜像。
  return (
    <g>
      <path
        data-testid="gm-rose-arrow"
        d="M 7.815 13.810 A 16.380 16.380 0 0 0 6.422 27.062 L 4.786 27.593 L 9.896 31.457 L 9.389 26.098 L 7.753 26.629 A 14.980 14.980 0 0 1 9.027 14.510 A 0.700 0.700 0 0 1 7.815 13.810 Z"
        fill="#B8B8B8"
      />
      <polygon data-testid="gm-rose-arrow-head" points="9.896,31.457 4.786,27.593 9.389,26.098" fill="#B8B8B8" />
    </g>
  );
}
