import { ChevronDown, MessageSquare } from '@/components/solid-icons';
import type { ReactNode } from 'react';

export function LibraryChat({ title, headerAction, children }: {
  title: string;
  headerAction?: ReactNode;
  /** 2026-11-17 用户：「对话删掉」——不传 children 就只留标题行，不出现对话折叠块。 */
  children?: ReactNode;
}): JSX.Element {
  return <div className="sc-library-chat">
    <div className="sc-library-chat-title"><h3>{title}</h3>{headerAction}</div>
    {children && <details className="sc-library-chat-disclosure">
      <summary><MessageSquare size={15} aria-hidden="true"/>对话<ChevronDown size={14} aria-hidden="true"/></summary>
      <div className="sc-library-chat-content">{children}</div>
    </details>}
  </div>;
}
