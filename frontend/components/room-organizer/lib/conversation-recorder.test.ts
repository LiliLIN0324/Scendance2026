// @vitest-environment jsdom
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {conversationTurnKey,recordConversationTurn,type ConversationTraceTransport} from './conversation-recorder';

const turn=(overrides:Partial<Parameters<typeof recordConversationTurn>[1]>={})=>({
  turnKey:conversationTurnKey(),sessionId:'ses-1',turnIndex:0,surface:'local_command' as const,
  userText:'加两把椅子',assistantText:'已加 2 把椅子',outcome:'local_only' as const,...overrides,
});

describe('conversation recorder',()=>{
  beforeEach(()=>{window.localStorage.clear();});
  afterEach(()=>{vi.restoreAllMocks();});

  it('flushes a local-only turn to the transport',async()=>{
    const recordConversationTurns=vi.fn<(turns:unknown[])=>Promise<unknown>>(async()=>null);
    recordConversationTurn({recordConversationTurns} as ConversationTraceTransport,turn());
    await vi.waitFor(()=>expect(recordConversationTurns).toHaveBeenCalledTimes(1));
    expect(recordConversationTurns.mock.calls[0]![0]).toMatchObject([{sessionId:'ses-1',surface:'local_command',outcome:'local_only'}]);
  });

  it('keeps the turn queued when the transport fails, and retries on the next turn',async()=>{
    const recordConversationTurns=vi.fn<(turns:unknown[])=>Promise<unknown>>(async()=>{throw new Error('offline');});
    recordConversationTurn({recordConversationTurns} as ConversationTraceTransport,turn());
    await vi.waitFor(()=>expect(recordConversationTurns).toHaveBeenCalled());
    expect(JSON.parse(window.localStorage.getItem('scendance:conversation-outbox:v1')??'[]')).toHaveLength(1);
    recordConversationTurns.mockImplementation(async()=>null);
    recordConversationTurn({recordConversationTurns} as ConversationTraceTransport,turn({turnKey:conversationTurnKey(),userText:'再换一套'}));
    await vi.waitFor(()=>expect(recordConversationTurns).toHaveBeenCalledTimes(2));
    expect(JSON.parse(window.localStorage.getItem('scendance:conversation-outbox:v1')??'[]')).toHaveLength(0);
  });

  it('never throws when no transport is available',()=>{
    expect(()=>recordConversationTurn(null,turn())).not.toThrow();
  });
});
