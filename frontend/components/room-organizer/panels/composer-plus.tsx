'use client';

import { Check, Plus } from '@/components/solid-icons';
import { useEffect, useId, useRef, useState } from 'react';

export type ComposerMenuItem = {
  id: string;
  label: string;
  /** 一行注解，写完没有不占位。 */
  hint?: string;
  icon?: JSX.Element;
  /** 当前已选中的那一项（生成种类），只在菜单里留一个勾。 */
  active?: boolean;
  disabled?: boolean;
  run(): void;
};

/**
 * 输入框左下角的「+」。附件与生成种类都收进这一颗，输入框下面不再常驻一排按钮。
 * 菜单本身只有按键顺序（Home/End 交给浏览器默认），Esc 或点外面就收。
 */
export function ComposerPlus({ items, label = '更多操作', align = 'up', icon }: {
  items: ComposerMenuItem[];
  label?: string;
  /** up = 菜单朝上开（默认，贴输入框）；down = 朝下（测试或窄屏备用）。 */
  align?: 'up' | 'down';
  /** 按钮本身的图标；不给就是「+」。生成模式选过物料/场地后换成对应图标。 */
  icon?: JSX.Element | undefined;
}): JSX.Element | null {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const firstRef = useRef<HTMLButtonElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    firstRef.current?.focus();
    function onPointerDown(event: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  if (items.length === 0) return null;

  return <div className="ap-plus" ref={rootRef}>
    <button
      type="button"
      className="ap-plus-btn"
      aria-label={label}
      aria-haspopup="menu"
      aria-expanded={open}
      aria-controls={open ? id : undefined}
      onClick={() => setOpen(value => !value)}
    >
      {icon ?? <Plus size={18} aria-hidden="true" />}
    </button>
    {open && <div id={id} className={`ap-menu${align === 'down' ? ' is-down' : ''}`} role="menu" aria-label={label}>
      {items.map((item, index) => <button
        key={item.id}
        ref={index === 0 ? firstRef : undefined}
        type="button"
        role="menuitem"
        className="ap-menu-item"
        aria-current={item.active ? 'true' : undefined}
        disabled={item.disabled}
        onClick={() => { setOpen(false); item.run(); }}
      >
        <span className="ap-menu-icon" aria-hidden="true">{item.icon}</span>
        <span className="ap-menu-text">
          <span className="ap-menu-label">{item.label}</span>
          {item.hint && <span className="ap-menu-hint">{item.hint}</span>}
        </span>
        {item.active && <Check className="ap-menu-check" size={14} aria-hidden="true" />}
      </button>)}
    </div>}
  </div>;
}