/**
 * 理解失败时的“编号 + 提示”一句话（M1a 的可取证那半）。
 *
 * 失败卡原来只有一句“没懂这句”，用户没法对账；这里给每次失败配一个可抄的编号，
 * 并且把提示写成能做的事。编号来自 `turn-trace`，不含原话、不含身份。
 *
 * 说明：`model_notice` 是本地标签，不是服务端分类码——本轮只在前端记账，
 * 等 M1b 服务端日志接线后，同一编号才会在服务端事件里出现。
 */

import { finishTurn, safeErrorCode, startTurn, summarizeTurn } from './turn-trace';

export interface ModelFailureView {
  /** 卡片主文：说清发生了什么。 */
  text: string;
  /** 可复制的编号行。 */
  diag: string;
  /** 用户能做的下一步。 */
  hint: string;
}

const LOCAL_CODE = 'model_notice';

export function describeModelFailure(notice: string, now: number = Date.now()): ModelFailureView {
  let trace = startTurn({ route: 'conversation', now });
  trace = finishTurn(trace, 'failed', { errorCode: LOCAL_CODE, now });
  const code = safeErrorCode(LOCAL_CODE);
  return {
    text: notice.trim() || '这次没听懂这句。',
    diag: summarizeTurn(trace),
    hint: code
      ? `点「重试云端理解」会用同一个编号重发（${code}）；换个说法也可以。`
      : '点「重试云端理解」会用同一个编号重发；换个说法也可以。',
  };
}
