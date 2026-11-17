/** 比例尺刻度。与原先两处角标的 nice 序列一致，改这里会改视觉。 */
const NICE_SCALE_METERS = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000] as const;

/** 由米/像素得到比例尺条宽度和标签。相机不动时字符串稳定，调用方即可跳过 DOM 写。 */
export function scaleChromeReadout(metersPerPixel: number): { width: string; text: string } {
  const targetM = metersPerPixel * 80;
  const meters = NICE_SCALE_METERS.find((value) => value >= targetM) ?? Math.round(targetM);
  const widthPx = Math.max(24, Math.min(140, meters / Math.max(metersPerPixel, 0.01)));
  return {
    width: `${widthPx}px`,
    text: meters >= 1000 ? `${meters / 1000} km` : `${meters} m`,
  };
}

/** 值没变就不写 DOM。返回本次值，供调用方记下。 */
export function assignIfChanged(previous: string | null, next: string, assign: (value: string) => void): string {
  if (previous !== next) assign(next);
  return next;
}
