/**
 * 一轮对话是否真的打到后端。
 *
 * 场地没匹配上、尺寸缺失、前置条件未满足这类回复由前端规则直接答完，
 * 不发请求，服务端就没有机会落库。对话面板据此判断要不要在本地补记这一轮，
 * 保证「有没有调用 AI」不影响留痕。
 */
let lastServerCallAt = 0;

/** 任何一次会写服务端的请求发出前调用。 */
export function noteServerCall(): void {
  lastServerCallAt = Date.now();
}

/** 这一轮开始之后是否发生过服务端调用。 */
export function turnHadServerCall(startedAt: number): boolean {
  return lastServerCallAt >= startedAt;
}
