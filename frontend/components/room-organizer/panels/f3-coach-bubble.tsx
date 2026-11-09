export interface F3CoachBubbleProps {
  /** 锚点（相对画布坐标系）；为 null 时不渲染。 */
  anchor: { x: number; y: number } | null;
  visible: boolean;
  onDismiss: () => void;
}

/**
 * F3 首次吸附教练气泡：纯 DOM，绝对定位在锚点附近，不依赖 3D。
 * 拖动物件时提示用户核对实际通行空间。
 */
export function F3CoachBubble({ anchor, visible, onDismiss }: F3CoachBubbleProps) {
  if (!visible || !anchor) return null;
  return (
    <div
      role="status"
      style={{
        position: 'absolute',
        left: anchor.x,
        top: anchor.y,
        transform: 'translate(-50%, -110%)',
        maxWidth: 260,
        padding: '10px 12px',
        background: '#ffffff',
        color: '#1f2328',
        borderRadius: 8,
        border: '1px solid #d0d7de',
        boxShadow: '0 6px 18px rgba(0,0,0,0.12)',
        fontSize: 12,
        lineHeight: 1.5,
        zIndex: 50,
        pointerEvents: 'auto',
      }}
    >
      <div style={{ marginBottom: 8 }}>
        拖动物件可以调整位置；实际通行空间还需核对。
      </div>
      <div style={{ textAlign: 'right' }}>
        <button
          type="button"
          onClick={onDismiss}
          style={{
            padding: '4px 10px',
            borderRadius: 6,
            border: '1px solid #4A7C59',
            background: '#4A7C59',
            color: '#ffffff',
            cursor: 'pointer',
            fontSize: 12,
          }}
        >
          知道了
        </button>
      </div>
    </div>
  );
}
