import { beforeEach, describe, expect, it, vi } from 'vitest';
import { noteServerCall, turnHadServerCall } from './conversation-turn-activity';

describe('conversation turn activity',()=>{
  beforeEach(()=>{vi.useRealTimers();});

  it('a turn with no server call stays local',()=>{
    const startedAt=Date.now()+1;
    expect(turnHadServerCall(startedAt)).toBe(false);
  });

  it('a server call inside the turn marks it as served by the backend',()=>{
    const startedAt=Date.now()-1;
    noteServerCall();
    expect(turnHadServerCall(startedAt)).toBe(true);
  });

  it('a server call before the turn starts does not mark it',()=>{
    noteServerCall();
    expect(turnHadServerCall(Date.now()+1)).toBe(false);
  });
});
