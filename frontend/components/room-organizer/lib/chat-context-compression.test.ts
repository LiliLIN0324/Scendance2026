import { describe, expect, it } from 'vitest';
import { compressChatContext } from './chat-context-compression';

class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

describe('compressChatContext', () => {
  it('compresses older messages and keeps a memo plus the recent four', () => {
    const storage = new MemoryStorage();
    const messages = Array.from({ length: 6 }, (_, index) => ({ role: index % 2 ? 'assistant' as const : 'user' as const, text: index === 0 ? '活动是发布会，30人，场地12×9米。' : `第${index}条对话` }));
    const result = compressChatContext(messages, '继续', { thresholdTokens: 1, recentMessages: 4, storage });
    expect(result.compressed).toBe(true);
    expect(result.memo).toContain('活动环节');
    expect(result.history).toHaveLength(5);
    expect(result.history[0]?.text).toContain('[对话备忘录]');
    expect(result.history.at(-1)?.text).toBe('第5条对话');
  });

  it('merges with the previous memo and keeps tool calls with their results', () => {
    const storage = new MemoryStorage();
    const first = compressChatContext([
      { role: 'user', text: '必须保留主入口。' },
      { role: 'assistant', text: '已记下。' },
      { role: 'user', text: '人数是30人。' },
      { role: 'assistant', text: '收到。' },
      { role: 'user', text: '场地12×9米。' },
    ], '现在确认', { thresholdTokens: 1, recentMessages: 2, storage, storageKey: 'memo' });
    expect(first.memo).toContain('用户限制');
    const second = compressChatContext([
      { role: 'user', text: '待确认通道宽度。' },
      { role: 'tool', text: 'get_scene()', toolCallId: 'a' },
      { role: 'tool', text: '场景结果：12×9米', toolCallId: 'a', toolResult: true },
    ], '继续', { thresholdTokens: 1, recentMessages: 1, storage, storageKey: 'memo' });
    expect(second.memo).toContain('用户限制');
    expect(second.memo).toContain('未完成事项');
    expect(second.history.filter(item => item.text.includes('get_scene'))).toHaveLength(0);
    expect(second.history[0]?.text).toContain('[对话备忘录]');
  });
});
