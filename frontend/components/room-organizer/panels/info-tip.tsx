'use client';

import { Info } from '@/components/solid-icons';
import { useState, type ReactNode } from 'react';

export function InfoTip({ label, children }: { label: string; children: ReactNode }): JSX.Element {
  const [open, setOpen] = useState(false);
  return <span className="sc-info">
    <button className="sc-info-trigger" type="button" aria-label={label} aria-expanded={open} onClick={() => setOpen(value => !value)} onBlur={() => setOpen(false)} onKeyDown={event => { if (event.key === 'Escape') setOpen(false); }}><Info size={15} aria-hidden="true"/></button>
    {open && <span className="sc-info-pop" role="note">{children}</span>}
  </span>;
}
