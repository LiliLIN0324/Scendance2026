/** 工具区下一步。只看已经发生的事实，不调用模型，也不替上面的助手做确认。 */

export type TaskToolGroup = 'space' | 'material' | 'handoff';

export type TaskToolFocus = 'venue' | 'people' | 'chat' | 'check';

export interface TaskToolSnapshot {
  venueReady: boolean;
  peopleStated: boolean;
  itemCount: number;
  planShown: boolean;
  generating: boolean;
  unconfirmed: boolean;
}

/** 一次只打开一个工具。没场地看空间；有场地还没摆东西看物料；已经摆了就看检查。 */
export function taskToolOpenGroup(input: Pick<TaskToolSnapshot, 'venueReady' | 'itemCount'>): TaskToolGroup {
  if (!input.venueReady) return 'space';
  if (input.itemCount > 0) return 'handoff';
  return 'material';
}

export function taskToolNextStep(input: Pick<TaskToolSnapshot, 'venueReady' | 'peopleStated' | 'itemCount' | 'planShown'>): {
  focus: TaskToolFocus;
  group: TaskToolGroup;
  text: string;
} {
  const group = taskToolOpenGroup(input);
  if (!input.venueReady) {
    return { focus: 'venue', group, text: '下一步：点「定场地」。' };
  }
  if (input.itemCount > 0) {
    return { focus: 'check', group, text: '下一步：点「检查这一版」。' };
  }
  if (!input.peopleStated) {
    return { focus: 'people', group, text: '下一步：填写这场来多少人。' };
  }
  return { focus: 'chat', group, text: '下一步：在上面的对话里说出这场活动。确认之后才会写进画面。' };
}

/** 检查按钮不能点时，原因直接写出来。 */
export function checkBlockReason(input: Pick<TaskToolSnapshot, 'itemCount' | 'generating' | 'unconfirmed'>): string | null {
  if (input.generating) return '这一版还在整理。等它完成，或在上面说「停一下」，再检查。';
  if (input.unconfirmed) return '上面还有一版没确认。先点「确认布置」或「撤回」，再检查。';
  if (input.itemCount <= 0) return '画面上还没有物件。先打开「物料」，点一件放到画面上。';
  return null;
}

/** 交给执行、给客户看：没有落盘内容时说明原因。 */
export function handoffBlockReason(input: Pick<TaskToolSnapshot, 'itemCount' | 'generating' | 'unconfirmed'>): string | null {
  if (input.generating) return '这一版还在整理，完成后再交给别人。';
  if (input.unconfirmed) return '上面还有一版没确认。先点「确认布置」或「撤回」。';
  if (input.itemCount <= 0) return '画面上还没有物件，还不能交给别人看。';
  return null;
}
