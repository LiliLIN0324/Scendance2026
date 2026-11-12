import { ChevronDown, MessageSquare } from '@/components/solid-icons';
import type { ReactNode } from 'react';

export function LibraryChat({ title, headerAction, children }: {
  title: string;
  headerAction?: ReactNode;
  children: ReactNode;
}): JSX.Element {
  return <div className="sc-library-chat">
    <div className="sc-library-chat-title"><h3>{title}</h3>{headerAction}</div>
    <details className="sc-library-chat-disclosure">
      <summary><MessageSquare size={15} aria-hidden="true"/>对话<ChevronDown size={14} aria-hidden="true"/></summary>
      <div className="sc-library-chat-content">{children}</div>
    </details>
  </div>;
}
