/**
 * 同页换活动（2026-11-17 用户拍板）。
 *
 * 病根：场景面板打开经典案例原来是 `window.location.assign('/editor/?project=…&mode=outdoor')`，
 * 文档整页重载——白屏、重走进场骨架，正在看的场地被重置，很难受。
 *
 * 现在的分工：面板只管「写本机记录 + 说一句要换到哪个活动」，工作台外壳接住后换 project id
 * 重挂画布（与「换设备找回」同一条路径），URL 只做 history.replaceState，文档不重载。
 * 没有监听者时（单独渲染面板、测试、未来别的宿主）退回整页跳，行为不静默丢失。
 */

export const OUTDOOR_PROJECT_SWITCH_EVENT = 'scendance:switch-outdoor-project';

export interface OutdoorProjectSwitchDetail {
  projectId: string;
  /** 有宿主接住并完成切换就置 true；调用方据此决定要不要回退整页跳。 */
  handled: boolean;
}

/** 请求同页切到某个活动；返回是否已被宿主接住。 */
export function requestOutdoorProjectSwitch(projectId: string): boolean {
  const id = projectId.trim();
  if (!id || typeof window === 'undefined') return false;
  const detail: OutdoorProjectSwitchDetail = { projectId: id, handled: false };
  window.dispatchEvent(new CustomEvent<OutdoorProjectSwitchDetail>(OUTDOOR_PROJECT_SWITCH_EVENT, { detail }));
  return detail.handled;
}

/**
 * 宿主订阅（工作台外壳）。handler 返回 false 表示这次没接住（例如工作台还没起来），
 * 事件保持 handled=false，调用方照旧整页跳。
 */
export function onOutdoorProjectSwitch(handler: (projectId: string) => boolean): () => void {
  if (typeof window === 'undefined') return () => {};
  const listener = (event: Event): void => {
    const detail = (event as CustomEvent<Partial<OutdoorProjectSwitchDetail>>).detail;
    const projectId = typeof detail?.projectId === 'string' ? detail.projectId.trim() : '';
    if (!projectId) return;
    let accepted = false;
    try {
      accepted = handler(projectId) !== false;
    } catch {
      accepted = false;
    }
    if (accepted && detail) detail.handled = true;
  };
  window.addEventListener(OUTDOOR_PROJECT_SWITCH_EVENT, listener);
  return () => window.removeEventListener(OUTDOOR_PROJECT_SWITCH_EVENT, listener);
}
