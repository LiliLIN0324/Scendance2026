/**
 * 登录卡与输入框的文案（M4 前置切片，2026-11-16）。
 *
 * 实测出来的毛病：地点定了、范围也确认了，再发一句设计需求（例如「帮我分区」），
 * 因为这条路要模型，界面就停成「登录后继续这次选址」，输入框 placeholder 也写「这次选址」。
 * 人看到的是「我刚选完址，怎么又让我选址」——把已经做完的一步重说一遍，
 * 等于让用户以为白做了。这里按「范围是否已确认」分成两句，不再混用。
 *
 * 纯函数，可在 node 里直接测。
 */

export interface LoginCopyInput {
  loginSatisfied: boolean;
  rangeConfirmed: boolean;
}

/** 卡片标题。 */
export function loginResumeHeadline(input: LoginCopyInput): string {
  if (input.loginSatisfied) return '已登录 · 可以继续';
  return input.rangeConfirmed ? '登录后继续这次设计' : '登录后继续这次选址';
}

/** 卡片正文：说明登录影响的是什么，以及已经保住了什么。 */
export function loginResumeCaption(input: LoginCopyInput): string {
  if (input.loginSatisfied) return '继续后这次搜索会写入项目，结果不再只留在本页。';
  return input.rangeConfirmed
    ? '场地草稿与已确认范围都还在；登录只影响写入项目，不改动已经确认的范围。'
    : '场地草稿已保存；登录只影响写入项目，不改动当前范围。';
}

/** 输入框 placeholder：登录卡挡住输入时，说清接下来继续的是哪件事。 */
export function loginBlockedPlaceholder(input: { rangeConfirmed: boolean }): string {
  return input.rangeConfirmed ? '登录后继续这次设计' : '登录后继续这次选址';
}
