import { describe, expect, it } from 'vitest';
import { STORAGE_KEY } from './constants';
import {
  ASSISTANT_SESSION_BODIES_STORAGE_KEY,
  ASSISTANT_SESSION_BODY_BUBBLE_MAX,
  deleteSessionBubbles,
  emptyAssistantSessionBodies,
  parseAssistantSessionBodies,
  pruneSessionBodies,
  readAssistantSessionBodies,
  readSessionBubbles,
  writeAssistantSessionBodies,
  writeSessionBubbles,
} from './assistant-session-bodies';

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() { return data.size; },
    key: index => [...data.keys()][index] ?? null,
    getItem: key => data.get(key) ?? null,
    setItem: (key, value) => { data.set(key, value); },
    removeItem: key => { data.delete(key); },
    clear: () => { data.clear(); },
  };
}

describe('assistant session bodies', () => {
  it('round trips the marker for model replies without promoting ordinary status messages',()=>{
    const raw=JSON.stringify({version:1,byId:{session:[{id:'1',role:'agent',text:'普通状态'},{id:'2',role:'agent',text:'模型回复',modelConversation:true},{id:'3',role:'user',text:'问题',modelConversation:true}]}});
    const rows=readSessionBubbles(parseAssistantSessionBodies(raw)!,'session');
    expect(rows[0]?.modelConversation).toBeUndefined();expect(rows[1]?.modelConversation).toBe(true);expect(rows[2]?.modelConversation).toBeUndefined();
    expect(parseAssistantSessionBodies(JSON.stringify(writeSessionBubbles(emptyAssistantSessionBodies(),'session',rows)))?.byId.session?.[1]?.modelConversation).toBe(true);
  });
  it('keeps its storage key off the layout draft', () => {
    expect(ASSISTANT_SESSION_BODIES_STORAGE_KEY).not.toBe(STORAGE_KEY);
  });

  it('writes, reads, deletes, and prunes by session id', () => {
    let bodies = emptyAssistantSessionBodies();
    bodies = writeSessionBubbles(bodies, 'ses-1', [
      { id: 'b1', role: 'user', text: '80 人发布会' },
      { id: 'b2', role: 'agent', text: '好，先出一版', amber: true },
    ]);
    expect(readSessionBubbles(bodies, 'ses-1')).toHaveLength(2);
    expect(readSessionBubbles(bodies, 'ses-missing')).toEqual([]);

    bodies = writeSessionBubbles(bodies, 'ses-2', [{ id: 'c1', role: 'user', text: '茶歇' }]);
    bodies = pruneSessionBodies(bodies, ['ses-1']);
    expect(readSessionBubbles(bodies, 'ses-1')).toHaveLength(2);
    expect(readSessionBubbles(bodies, 'ses-2')).toEqual([]);

    bodies = deleteSessionBubbles(bodies, 'ses-1');
    expect(bodies.byId).toEqual({});
  });

  it('round trips the alert card stamp and tone, dropping an invalid tone', () => {
    const bodies = writeSessionBubbles(emptyAssistantSessionBodies(), 'ses-alert', [
      { id: 'a1', role: 'agent', text: '该模型额度已用完或欠费', alertStamp: '额度不足', alertTone: 'warn' },
      { id: 'a2', role: 'agent', text: '活动问答暂未启用', alertStamp: '暂未启用', alertTone: 'muted' },
      { id: 'a3', role: 'agent', text: '坏色调', alertStamp: 'x', alertTone: 'bogus' as 'warn' },
    ]);
    const rows = readSessionBubbles(bodies, 'ses-alert');
    expect(rows[0]?.alertStamp).toBe('额度不足');
    expect(rows[0]?.alertTone).toBe('warn');
    expect(rows[1]?.alertStamp).toBe('暂未启用');
    expect(rows[1]?.alertTone).toBe('muted');
    expect(rows[2]?.alertTone).toBeUndefined();
  });

  it('clips long threads and drops corrupt rows on parse', () => {
    const many = Array.from({ length: ASSISTANT_SESSION_BODY_BUBBLE_MAX + 5 }, (_, order) => ({
      id: `b-${order}`,
      role: 'user' as const,
      text: `第 ${order} 句`,
    }));
    const clipped = writeSessionBubbles(emptyAssistantSessionBodies(), 'ses-a', many);
    expect(readSessionBubbles(clipped, 'ses-a')).toHaveLength(ASSISTANT_SESSION_BODY_BUBBLE_MAX);
    expect(readSessionBubbles(clipped, 'ses-a')[0]?.id).toBe('b-5');

    expect(parseAssistantSessionBodies('{')).toBeNull();
    expect(parseAssistantSessionBodies(JSON.stringify({
      version: 1,
      byId: {
        'ses-ok': [
          { id: 'good', role: 'agent', text: '在', to: ['bingo', 'nope'] },
          { id: '', role: 'user', text: '坏 id' },
          { id: 'bad-role', role: 'system', text: 'x' },
          null,
        ],
      },
    }))).toEqual({
      version: 1,
      byId: {
        'ses-ok': [{ id: 'good', role: 'agent', text: '在' }],
      },
    });
  });

  it('round-trips through storage', () => {
    const storage = memoryStorage();
    const bodies = writeSessionBubbles(emptyAssistantSessionBodies(), 'ses-seed', [
      { id: 'b1', role: 'user', text: '你好', long: true, meta: '图' },
    ]);
    expect(writeAssistantSessionBodies(bodies, storage)).toBe(true);
    expect(readAssistantSessionBodies(storage)).toEqual(bodies);
    expect(storage.getItem(STORAGE_KEY)).toBeNull();
    expect(readAssistantSessionBodies(memoryStorage())).toEqual(emptyAssistantSessionBodies());
  });
});
