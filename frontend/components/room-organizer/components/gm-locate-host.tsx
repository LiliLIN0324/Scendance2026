import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { LocateOutcome } from '../lib/gm-locate';
import { GmLocateButton } from './gm-locate-button';

/**
 * 把定位钮挂进右下角工具簇里已有的 #tool-focus 前面。
 * 原来的按钮留在 DOM 里，视觉和点击交给这一枚，这样进行中的蓝点和失败说明
 * 不必改工具簇组件。
 */
export function GmLocateHost({
  active,
  label,
  onLocate,
}: {
  active: boolean;
  label: string;
  onLocate: () => LocateOutcome;
}): JSX.Element | null {
  const [slot, setSlot] = useState<HTMLElement | null>(null);

  useEffect(() => {
    let native: HTMLElement | null = null;
    let holder: HTMLDivElement | null = null;
    const release = () => {
      if (native) {
        native.classList.remove('is-gm-locate-native');
        native.removeAttribute('aria-hidden');
        native.removeAttribute('tabindex');
        native.style.pointerEvents = '';
      }
      holder?.remove();
      native = null;
      holder = null;
    };
    if (!active) {
      release();
      setSlot(null);
      return undefined;
    }
    const attach = () => {
      const next = document.getElementById('tool-focus');
      if (next && native === next && holder?.isConnected) return;
      release();
      if (!next?.parentElement) {
        setSlot(null);
        return;
      }
      const created = document.createElement('div');
      created.className = 'gm-locate-slot';
      next.parentElement.insertBefore(created, next);
      next.classList.add('is-gm-locate-native');
      next.setAttribute('aria-hidden', 'true');
      next.tabIndex = -1;
      next.style.pointerEvents = 'none';
      native = next;
      holder = created;
      setSlot(created);
    };
    attach();
    const observer = new MutationObserver(attach);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      release();
      setSlot(null);
    };
  }, [active]);

  if (!active || !slot) return null;
  return createPortal(<GmLocateButton label={label} onLocate={onLocate} />, slot);
}
