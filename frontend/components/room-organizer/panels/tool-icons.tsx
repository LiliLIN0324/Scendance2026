import type { ReactNode } from 'react';

function ToolIcon({ size = 20, children }: { size?: number; children: ReactNode }): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor"
      strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

/** 平面：一块俯看的矩形地板，一道内墙。和立体方块成对。 */
export function PlanViewIcon({ size = 20 }: { size?: number }): JSX.Element {
  return <ToolIcon size={size}>
    <rect x="3" y="3.5" width="14" height="13" rx="1.5"/>
    <path d="M3 9.8h7.2v6.7"/>
  </ToolIcon>;
}
