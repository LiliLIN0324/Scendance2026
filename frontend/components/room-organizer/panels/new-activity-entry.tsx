'use client';

import { Plus, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocalProjectBackup } from './creative-studio';
import { LocalActivitiesPanel } from './local-activities-panel';
import type { RoomLayout } from '../lib/types';
import './new-activity-entry.css';

/** Rail-top entry: creating an activity belongs to the workspace, not to the account's project list. */
export function NewActivityEntry({ layout }: { layout: RoomLayout }): JSX.Element | null {
  const actions = useLocalProjectBackup();
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const root = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null), pop = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return undefined;
    const place = (): void => {
      const box = trigger.current?.getBoundingClientRect();
      if (!box) return;
      const width = Math.min(320, window.innerWidth - 96);
      setPosition({ top: Math.max(8, box.top - 6), left: Math.min(box.right + 12, window.innerWidth - width - 12) });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    const onPointerDown = (event: Event): void => {
      const target = event.target as Node;
      if (root.current?.contains(target) || pop.current?.contains(target)) return;
      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      trigger.current?.focus();
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    const frame = requestAnimationFrame(() => pop.current?.querySelector<HTMLInputElement>('.sc-activity-form input')?.focus());
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
      cancelAnimationFrame(frame);
    };
  }, [open]);
  if (!actions) return null;
  const close = (): void => { setOpen(false); trigger.current?.focus(); };
  return <>
    <div className="sc-rail-new-activity" ref={root}>
      <button ref={trigger} type="button" className="sc-rail-tool sc-rail-disc sc-rail-new-activity-trigger" aria-label="新建活动" aria-haspopup="dialog" aria-expanded={open} data-tip="新建活动" onClick={() => setOpen(value => !value)}><Plus size={22} aria-hidden="true"/></button>
    </div>
    {open && position && typeof document !== 'undefined' ? createPortal(<div ref={pop} className="sc-new-activity-pop" role="dialog" aria-label="新建活动" style={{ top: position.top, left: position.left }}>
      <button type="button" className="sc-new-activity-close" aria-label="关闭新建活动" onClick={close}><X size={16} aria-hidden="true"/></button>
      <LocalActivitiesPanel mode="create" layout={layout} actions={actions} onComplete={close}/>
    </div>, document.body) : null}
  </>;
}
