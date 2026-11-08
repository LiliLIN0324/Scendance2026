/** 画布顶左浮标：只在 2D 平面时提示视图，3D 不显示。 */
export function CanvasHeading({ view2D }: { view2D: boolean }) {
  if (!view2D) return null;
  return (
    <div className="sc-canvas-heading">
      <span className="sc-canvas-kind">2D 平面</span>
    </div>
  );
}
