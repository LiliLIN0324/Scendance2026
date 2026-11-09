import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isGenerateCommand } from '@/components/room-organizer/lib/workbench-agent';
import { initialBriefMemory,parseBriefTurn } from '@/components/room-organizer/lib/brief-agent';

const { sampleFor,classifyQuestion } = createRequire(import.meta.url)(resolve('scripts/verify-live-agent-workbench.cjs')) as {
  sampleFor: (used: number, mode?: string) => string;
  classifyQuestion: (text: string) => {kind:string;reply?:string};
};

describe('isolated workbench exercise', () => {
  it('uses distinct fictional prompts that the product recognizes as generation commands', () => {
    const first=sampleFor(0),next=sampleFor(8);
    expect(first).not.toBe(next);
    for(const sample of [first,next,sampleFor(0,'synthetic'),sampleFor(1,'synthetic')]) {
      expect(sample.endsWith('，生成方案')).toBe(true);
      expect(isGenerateCommand(sample)).toBe('first');
    }
  });
  it('postpones the uncertain seating decision without confirming it',()=>{
    const decision=classifyQuestion('关于活动需求，我理解为所有人都需要座位。这样对吗？回复「确认」或「不对」。');
    expect(decision.kind).toBe('reply');
    const memory={...initialBriefMemory(),pendingActivityNeeds:[{kind:'all_seated' as const,value:true,evidence:'所有人都需要座位'}]};
    const turn=parseBriefTurn(decision.reply!,memory,{venueUp:true,scaleTyped:false,hasBase:false,command:null});
    expect(turn.memory.allGuestsSeated).toBeNull();expect(turn.memory.pendingActivityNeeds).toEqual([]);
    expect(turn.memory.unresolvedActivityNeeds).toContain('all_seated');expect(turn.memory.deferredActivityNeeds).toContain('all_seated');
  });
});
