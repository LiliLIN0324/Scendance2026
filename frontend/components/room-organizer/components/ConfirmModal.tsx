import { useEffect, useRef } from 'react';

export interface ConfirmModalProps {
  open: boolean;
  title: string;
  description: string;
  confirmText?: string;
  cancelText?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * 站内确认弹层：替代 window.confirm 的受控组件。
 * - 居中浮层，rgba(0,0,0,0.35) 遮罩
 * - 卡片白底 8px 圆角，标题栏冷石 #F4F5F7
 * - 品牌绿 #4A7C59 确认按钮，冷石取消按钮
 * - Esc 关闭、点击遮罩取消、自动聚焦确认按钮
 * 纯 React + inline style，不引依赖。
 */
export function ConfirmModal({
  open,
  title,
  description,
  confirmText = '确认',
  cancelText = '取消',
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  const confirmRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return undefined;
    // 自动聚焦确认按钮（延迟到下一拍，避免被打开时的 pointerdown 抢掉焦点）。
    const timer = window.setTimeout(() => confirmRef.current?.focus(), 0);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onCancel();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.35)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={{
          width: 360,
          background: '#ffffff',
          borderRadius: 8,
          overflow: 'hidden',
          boxShadow: '0 10px 30px rgba(0,0,0,0.18)',
          fontFamily: 'inherit',
          color: '#1f2328',
        }}
      >
        <div
          style={{
            padding: '12px 20px',
            background: '#F4F5F7',
            fontWeight: 600,
            fontSize: 14,
          }}
        >
          {title}
        </div>
        <div style={{ padding: '16px 20px', fontSize: 13, lineHeight: 1.6 }}>
          {description}
        </div>
        <div
          style={{
            padding: '12px 20px 20px',
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 8,
          }}
        >
          <button
            type="button"
            onClick={onCancel}
            style={{
              padding: '6px 14px',
              borderRadius: 6,
              border: '1px solid #d0d7de',
              background: '#F4F5F7',
              color: '#1f2328',
              cursor: 'pointer',
              fontSize: 13,
            }}
          >
            {cancelText}
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={onConfirm}
            style={{
              padding: '6px 14px',
              borderRadius: 6,
              border: '1px solid #4A7C59',
              background: '#4A7C59',
              color: '#ffffff',
              cursor: 'pointer',
              fontSize: 13,
            }}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
