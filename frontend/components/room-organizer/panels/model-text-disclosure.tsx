import type { ReactNode } from 'react';

/** Model-authored text is never shown as a safety finding or an execution result. */
export function ModelTextDisclosure({children}: {children:ReactNode}): JSX.Element {
  return <details className="sc-model-text"><summary>查看模型原文（未经核验）</summary>
    <p>以下为模型生成内容，不代表消防、疏散、无障碍、容量或其他规范验收；请独立核验。</p>
    {children}
  </details>;
}
