/**
 * 同步在途栅栏。只回答「这一句是否仍是唯一在途回合」。
 * 释放只表示这一句不再在途，不代表已接受，也不擦掉其他句子。
 * 未决原文由 requirement-recovery-loop 按事件编号保存。
 */

export interface DialogueTurnTracker {
  begin(eventId: string): () => void;
  canCapture(eventId: string): boolean;
  readonly size: number;
}

function usableEventId(eventId: unknown): eventId is string {
  return typeof eventId === 'string' && eventId.length > 0 && eventId.trim() === eventId;
}

export function createDialogueTurnTracker(): DialogueTurnTracker {
  const active = new Set<string>();
  const seen = new Set<string>();
  return {
    begin(eventId: string) {
      if (!usableEventId(eventId) || seen.has(eventId)) throw new Error('INVALID_TURN');
      seen.add(eventId);
      active.add(eventId);
      let released = false;
      return () => {
        if (released) return;
        released = true;
        active.delete(eventId);
      };
    },
    canCapture(eventId: string) {
      return active.size === 1 && active.has(eventId);
    },
    get size() {
      return active.size;
    },
  };
}
