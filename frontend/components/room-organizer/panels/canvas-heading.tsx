/** 画布顶左浮标：只标明 2D/3D 视图，不展示场地宽深。 */
export function CanvasHeading({ view2D }: { view2D: boolean }) {
  return (
    <div className="sc-canvas-heading">
      <span className="sc-canvas-kind">{view2D ? '2D 平面' : '3D 场景'}</span>
    </div>
  );
}
