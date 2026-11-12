'use client';

/**
 * 跨组件预填总线。
 *
 * 选中物件弹层挂在 AgentPanel 的组件树之外，提案卡的 `onPrefill` 闭包通道够不到它。
 * 这里用一个模块级的发布/订阅把「待预填文本」送进既有 composer：
 * - `requestComposerPrefill`：弹层（或其他树外入口）把指令文本推上来；
 * - `subscribeComposerPrefill`：AgentPanel 挂订阅，收到后并入现有草稿（不发送）。
 *
 * 边界：总线只搬运一条待预填文本，不持有会话、不触碰后端、不碰 run 事件协议；
 * 不触发发送，不另写审批/确认档位逻辑。组件卸载必须退订。
 */

type PrefillListener = (text: string) => void;

const listeners = new Set<PrefillListener>();

/** 推送一条待预填文本；空串/纯空白忽略。只分发给当前已订阅的面板，不做回放。 */
export function requestComposerPrefill(text: string): void {
  const trimmed = text.trim();
  if (!trimmed) return;
  for (const listener of Array.from(listeners)) listener(trimmed);
}

/** 订阅待预填文本；返回退订函数。 */
export function subscribeComposerPrefill(listener: PrefillListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** 测试隔离用：清空所有订阅。生产代码不调用。 */
export function resetComposerPrefillBusForTests(): void {
  listeners.clear();
}
