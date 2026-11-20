'use client';

import { useEffect, useRef } from 'react';

export interface AssetDetailRow {
  label: string;
  value: string;
}

export interface AssetDetailModalProps {
  open: boolean;
  title: string;
  image?: string;
  description?: string;
  rows: AssetDetailRow[];
  onClose(): void;
  onPlace?(): void;
  placeLabel?: string;
}

/**
 * 物料详情弹层：给工作台「我的生成」用。
 *
 * 只展示已经拿到的云端字段，不在这里发请求、不改资产。没有预览图时留空，
 * 不画通用椅子；没有描述时直接不渲染那一段，避免把空值说成「无描述」。
 * Esc / 点遮罩关闭；有「放入场地」时把主按钮放在右下角。
 */
export function AssetDetailModal({
  open, title, image, description, rows, onClose, onPlace, placeLabel = '放入场地',
}: AssetDetailModalProps): JSX.Element | null {
  const closeRef = useRef<HTMLButtonElement | null>(null);
  // 父级每次渲染都会给新的回调；只在打开时聚焦一次，避免每次刷新都把焦点抢回关闭键。
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  useEffect(() => {
    if (!open) return undefined;
    const timer = window.setTimeout(() => closeRef.current?.focus(), 0);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onCloseRef.current();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
        padding: 16,
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-label={`${title}详情`}
        onClick={(event) => event.stopPropagation()}
        style={{
          width: 'min(480px, 100%)', maxHeight: 'min(720px, calc(100vh - 32px))',
          overflow: 'auto', background: '#ffffff', borderRadius: 10,
          boxShadow: '0 14px 40px rgba(0,0,0,0.22)', color: '#1f2328',
          fontFamily: 'inherit',
        }}
      >
        <header style={{
          position: 'sticky', top: 0, zIndex: 1, display: 'flex', alignItems: 'center',
          justifyContent: 'space-between', gap: 12, padding: '12px 18px',
          background: '#F4F5F7', borderBottom: '1px solid #e3e6e9',
        }}>
          <h3 style={{ margin: 0, fontSize: 15, lineHeight: 1.4, overflowWrap: 'anywhere' }}>{title}</h3>
          <button
            ref={closeRef}
            type="button"
            aria-label="关闭详情"
            onClick={onClose}
            style={{
              flex: 'none', width: 28, height: 28, padding: 0, borderRadius: 6,
              border: '1px solid #d0d7de', background: '#fff', color: '#57606a',
              cursor: 'pointer', fontSize: 16, lineHeight: 1,
            }}
          >×</button>
        </header>

        <div style={{ padding: 18 }}>
          {image && (
            // 预览地址是短时签名链接，可能是任意存储域名，不走 next/image。
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={image}
              alt=""
              style={{
                display: 'block', width: '100%', maxHeight: 240, objectFit: 'contain',
                margin: '0 0 14px', background: '#F4F5F7', borderRadius: 8,
              }}
            />
          )}

          <dl style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8, margin: 0 }}>
            {rows.map(row => (
              <div key={row.label} style={{ minWidth: 0, padding: '8px 10px', background: '#F8F9FA', borderRadius: 8 }}>
                <dt style={{ color: '#6b7280', fontSize: 11, lineHeight: 1.4 }}>{row.label}</dt>
                <dd style={{ margin: '2px 0 0', fontSize: 12, lineHeight: 1.5, overflowWrap: 'anywhere' }}>{row.value}</dd>
              </div>
            ))}
          </dl>

          {description && (
            <div style={{ marginTop: 12, padding: '10px 12px', background: '#F8F9FA', borderRadius: 8 }}>
              <strong style={{ display: 'block', color: '#6b7280', fontSize: 11, fontWeight: 500 }}>生成描述</strong>
              <p style={{ margin: '4px 0 0', fontSize: 12, lineHeight: 1.7, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                {description}
              </p>
            </div>
          )}
        </div>

        <footer style={{
          position: 'sticky', bottom: 0, display: 'flex', justifyContent: 'flex-end', gap: 8,
          padding: '12px 18px', background: '#fff', borderTop: '1px solid #e3e6e9',
        }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: '6px 14px', borderRadius: 6, border: '1px solid #d0d7de',
              background: '#F4F5F7', color: '#1f2328', cursor: 'pointer', fontSize: 13,
            }}
          >关闭</button>
          {onPlace && (
            <button
              type="button"
              onClick={onPlace}
              style={{
                padding: '6px 14px', borderRadius: 6, border: '1px solid #4A7C59',
                background: '#4A7C59', color: '#fff', cursor: 'pointer', fontSize: 13,
              }}
            >{placeLabel}</button>
          )}
        </footer>
      </section>
    </div>
  );
}
