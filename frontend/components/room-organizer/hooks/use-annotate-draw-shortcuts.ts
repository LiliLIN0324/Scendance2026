import { useEffect, useRef } from 'react';
import type { PlanningEditMode } from '@/lib/outdoor-plan-tokens';
import { resolveAnnotateDrawShortcut } from '../lib/annotate-draw-shortcuts';
import type { PlanShapeKind } from '../lib/site-plan-annotate';

export interface AnnotateDrawShortcutHandlers {
  /** 只读画布不响应。 */
  enabled: boolean;
  getMode: () => PlanningEditMode;
  getShape: () => PlanShapeKind;
  /** 切到文本。调用方负责进入 note 模式。 */
  onNote: () => void;
  /** 切到形状。调用方负责写入形状并进入 shape 模式。 */
  onShape: (kind: PlanShapeKind) => void;
  /** 把标注工具条露出来，让按下态可见。 */
  onReveal: () => void;
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  // jsdom 不实现 isContentEditable；也覆盖 contenteditable 容器里的子节点。
  if (target.closest('[contenteditable]:not([contenteditable="false"])')) return true;
  const tag = target.tagName.toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select';
}

/**
 * 窗口级快捷键：工具条收起时按钮不在树上，监听仍要能切工具。
 * 回调走 ref，避免空依赖把第一次渲染的 setMode 冻住。
 */
export function useAnnotateDrawShortcuts(handlers: AnnotateDrawShortcutHandlers): void {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const current = handlersRef.current;
      if (!current.enabled || event.isComposing) return;
      const tool = resolveAnnotateDrawShortcut({
        key: event.key,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        altKey: event.altKey,
        shiftKey: event.shiftKey,
        typing: isTypingTarget(event.target),
        mode: current.getMode(),
        shape: current.getShape(),
      });
      if (tool.action !== 'select') return;
      event.preventDefault();
      current.onReveal();
      if (tool.keepDraft) return;
      if (tool.tool === 'note') current.onNote();
      else current.onShape(tool.tool);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
