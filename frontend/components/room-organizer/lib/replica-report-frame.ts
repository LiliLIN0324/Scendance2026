/**
 * 对比报告的取景口径（纯函数，不碰 canvas）。
 *
 * 左右两幅必须同口径才可比：都以官网轮廓的包围盒为中心，留 18% 边。
 * 左幅（官网数据复现）直接用这个口径画；右幅（我们的 2D/3D）也用它取景，
 * 轮廓外的派生内容会出框——这正说明它超出了官网画的那块地。
 */

export type ReportFrame = { cx: number; cy: number; spanM: number };

/** 官网轮廓 → 取景框（边长 = 轮廓最长边 × (1 + 边距)）。 */
export function reportFrameOf(ring: [number, number][], pad = 0.18): ReportFrame | null {
  if (!ring.length) return null;
  const xs = ring.map(p => p[0]);
  const ys = ring.map(p => p[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const spanM = Math.max(maxX - minX, maxY - minY, 1) * (1 + pad);
  return { cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, spanM };
}
