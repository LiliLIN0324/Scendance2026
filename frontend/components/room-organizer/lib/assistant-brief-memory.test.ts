// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';
import { initialBriefMemory } from './brief-agent';
import { pruneBriefMemories, readBriefMemory, writeBriefMemory } from './assistant-brief-memory';
import { resolveBriefTurn } from '@/lib/agent-resolver';
import {makeFloor,makeItem,makeLayout} from './__testfixtures__/fixtures';
import {captureOriginalPreservation,reviewOriginalPreservation} from './original-preservation';

beforeEach(() => localStorage.clear());

it('restores the original-object constraint only in its own conversation and activity',()=>{
  const layout=makeLayout({id:'activity-a',floors:[makeFloor({items:[makeItem({id:'original'})]})]});
  const requirement=captureOriginalPreservation(layout,'保留原有物件',false)!;
  expect(writeBriefMemory('one',{...initialBriefMemory(),originalPreservation:requirement})).toBe(true);
  expect(writeBriefMemory('two',initialBriefMemory())).toBe(true);
  expect(readBriefMemory('one')?.originalPreservation).toEqual(requirement);
  expect(readBriefMemory('two')?.originalPreservation).toBeUndefined();
  expect(reviewOriginalPreservation(readBriefMemory('one')?.originalPreservation,{...layout,id:'activity-b'}).status).toBe('unknown');
});

it('does not persist a pending generation instruction across reload',()=>{
  const memory={...initialBriefMemory(),pendingGeneration:{command:'first' as const,instruction:'包含私有要求的生成方案'}};
  expect(writeBriefMemory('one',memory)).toBe(true);
  expect(localStorage.getItem('scendance.assistant-brief-memory.v1')).not.toContain('pendingGeneration');
  expect(readBriefMemory('one')?.pendingGeneration).toBeUndefined();
});

it('round-trips user-reported and unresolved seating dimensions separately per conversation',()=>{
  const first={...initialBriefMemory(),localSeatingSpecs:{desk:{width:{status:'reported' as const,valueM:1.8,evidence:'桌宽1.8米'}},chair:{depth:{status:'unknown' as const,valueM:null,evidence:'椅深待定'}}}};
  expect(writeBriefMemory('one',first)).toBe(true);expect(writeBriefMemory('two',initialBriefMemory())).toBe(true);
  expect(readBriefMemory('one')?.localSeatingSpecs).toEqual(first.localSeatingSpecs);
  expect(readBriefMemory('two')?.localSeatingSpecs).toBeUndefined();
});
it('round-trips an explicit shared-desk requirement without carrying it to another conversation',()=>{
  const shared={...initialBriefMemory(),localSeatingAllocation:{status:'shared_desk' as const,peoplePerDesk:2,evidence:'每2人一桌'}};
  expect(writeBriefMemory('one',shared)).toBe(true);expect(writeBriefMemory('two',initialBriefMemory())).toBe(true);
  expect(readBriefMemory('one')?.localSeatingAllocation).toEqual(shared.localSeatingAllocation);
  expect(readBriefMemory('two')?.localSeatingAllocation).toBeUndefined();
});
it('restores an explicit deferral only within the same conversation and keeps the need unknown',()=>{
  const deferred={...initialBriefMemory(),unresolvedActivityNeeds:['checkin' as const],deferredActivityNeeds:['checkin' as const]};
  expect(writeBriefMemory('one',deferred)).toBe(true);expect(writeBriefMemory('two',initialBriefMemory())).toBe(true);
  expect(readBriefMemory('one')?.deferredActivityNeeds).toEqual(['checkin']);
  expect(readBriefMemory('one')?.zoneNeeds.checkin).toBeNull();
  expect(readBriefMemory('two')?.deferredActivityNeeds).toBeUndefined();
});

it('round-trips separate conversations and removes the memory of deleted conversations', () => {
  const first = { ...initialBriefMemory(), headcount: 80, headcountMode: 'must' as const, zoneNeeds: { checkin: false, rest: true, stage: null } };
  const second = { ...initialBriefMemory(), headcount: 30 };
  expect(writeBriefMemory('one', first)).toBe(true);
  expect(writeBriefMemory('two', second)).toBe(true);
  expect(readBriefMemory('one')).toEqual(first);
  expect(readBriefMemory('two')).toEqual(second);
  expect(pruneBriefMemories(new Set(['two']))).toBe(true);
  expect(readBriefMemory('one')).toBeNull();
  expect(readBriefMemory('two')).toEqual(second);
});

it('does not write or prune persisted memories after a supplied guard rejects', () => {
  const first = { ...initialBriefMemory(), headcount: 80 };
  expect(writeBriefMemory('one', first)).toBe(true);
  const key = 'scendance.assistant-brief-memory.v1';
  const before = localStorage.getItem(key);
  const deny = () => { throw new Error('lease lost'); };
  expect(writeBriefMemory('one', { ...first, headcount: 20 }, undefined, deny)).toBe(false);
  expect(pruneBriefMemories(new Set(), undefined, deny)).toBe(false);
  expect(localStorage.getItem(key)).toBe(before);
  expect(readBriefMemory('one')).toEqual(first);
});

it('does not overwrite damaged storage when a new conversation is saved', () => {
  const key = 'scendance.assistant-brief-memory.v1';
  localStorage.setItem(key, '{broken');
  expect(writeBriefMemory('new', initialBriefMemory())).toBe(false);
  expect(pruneBriefMemories(new Set())).toBe(false);
  expect(localStorage.getItem(key)).toBe('{broken');
});

it('conservatively restores legacy candidates without a restatement flag', async () => {
  const legacy = { ...initialBriefMemory(), pendingBasicFacts: [{ key: 'headcount', value: 80 }, { key: 'lengthM', value: 12 }] };
  localStorage.setItem('scendance.assistant-brief-memory.v1', JSON.stringify({ version: 1, byId: { old: legacy } }));
  const restored = readBriefMemory('old');
  expect(restored?.pendingBasicFacts).toEqual([
    { key: 'headcount', value: 80, requiresRestatement: true },
    { key: 'lengthM', value: 12, requiresRestatement: true },
  ]);
  const context = { venueUp: true, scaleTyped: false, hasBase: false, command: null } as const;
  const turn = await resolveBriefTurn('确认', restored!, context);
  expect(turn.kind).toBe('ask');
  expect(turn.memory.headcount).toBeNull();
  expect(turn.memory.lengthM).toBeNull();
});

it('does not treat a legacy default dining value as a user-confirmed layout', async () => {
  const legacy = { ...initialBriefMemory() };
  delete legacy.layoutModeConfirmed;
  localStorage.setItem('scendance.assistant-brief-memory.v1', JSON.stringify({ version: 1, byId: { old: legacy } }));
  const restored = readBriefMemory('old')!;
  expect(restored.layoutModeConfirmed).not.toBe(true);
  const context = { venueUp: true, scaleTyped: true, hasBase: false, command: 'first' } as const;
  const turn = await resolveBriefTurn('出方案', restored, context);
  expect(turn.kind).toBe('ask');
  expect(turn.text).toContain('布置方式');
});

it('restores unresolved needs after saving and still blocks a request to generate', async () => {
  vi.stubEnv('NEXT_PUBLIC_AGENT_ENABLED', '1');
  try {
    const context = { venueUp: true, scaleTyped: true, hasBase: false, command: null } as const;
    const transport = { briefExtract: vi.fn()
      .mockResolvedValueOnce({ enabled: true, extraction: { activityNeeds: [{ kind: 'checkin', decision: 'unknown', evidence: '签到待定' }] } })
      .mockResolvedValueOnce({ enabled: true, extraction: { activityNeeds: [{ kind: 'stage', decision: 'unknown', evidence: '舞台待定' }] } })
      .mockResolvedValue({ enabled: true, extraction: {} }) };
    const first = await resolveBriefTurn('签到待定', initialBriefMemory(), context, transport);
    const second = await resolveBriefTurn('舞台待定', first.memory, context, transport);
    expect(writeBriefMemory('conversation', second.memory)).toBe(true);
    const restored = readBriefMemory('conversation');
    expect(restored?.unresolvedActivityNeeds).toEqual(['checkin', 'stage']);
    const blocked = await resolveBriefTurn('出方案', restored!, { ...context, command: 'first' }, transport);
    expect(blocked.kind).toBe('ask');
  } finally { vi.unstubAllEnvs(); }
});

it.each([
  JSON.stringify({floorPlanImage:'data:image/png;base64,PRIVATE'}),
  JSON.stringify({floorPlanImage:'blob:https://example.test/private'}),
  JSON.stringify({structure:'x'.repeat(17000)}),
])('keeps large or image-bearing venue basis out of persistent memory', basis => {
  const memory={...initialBriefMemory(),lengthM:12,widthM:9,venueScaleBasis:basis,scaleNeedsReconfirmation:false};
  expect(writeBriefMemory('one',memory)).toBe(true);
  const raw=localStorage.getItem('scendance.assistant-brief-memory.v1')!;
  expect(raw).not.toContain('PRIVATE'); expect(raw).not.toContain('blob:https'); expect(raw.length).toBeLessThan(1000);
  expect(readBriefMemory('one')).toMatchObject({lengthM:12,widthM:9,scaleNeedsReconfirmation:true});
  expect(readBriefMemory('one')?.venueScaleBasis).toBeUndefined();
  expect(memory.venueScaleBasis).toBe(basis);
});
it('retains an ordinary small non-image venue basis',()=>{
  const memory={...initialBriefMemory(),lengthM:12,widthM:9,venueScaleBasis:'{\"width\":12}',scaleNeedsReconfirmation:false};
  expect(writeBriefMemory('one',memory)).toBe(true);expect(readBriefMemory('one')).toEqual(memory);
});

it('round-trips a stated mobility need and pending clarification through stored sessions',()=>{
  const needed={...initialBriefMemory(),mobilityRequirement:{decision:'needed' as const,evidence:'需要轮椅通道'},mobilityNeedsClarification:false};
  expect(writeBriefMemory('access',needed)).toBe(true);expect(readBriefMemory('access')?.mobilityRequirement).toEqual(needed.mobilityRequirement);
  const unknown={...needed,mobilityRequirement:{decision:'unknown' as const,evidence:'轮椅通道待定'},mobilityNeedsClarification:true};
  expect(writeBriefMemory('access',unknown)).toBe(true);expect(readBriefMemory('access')).toMatchObject(unknown);
});

it('asks and records an explicit reply after a pending mobility need is reloaded',async()=>{
  const context={venueUp:true,scaleTyped:false,hasBase:false,command:null} as const;
  const {parseBriefTurn}=await import('./brief-agent');
  const pending=parseBriefTurn('轮椅通道是否需要待定',initialBriefMemory(),context).memory;
  expect(writeBriefMemory('mobility-reload',pending)).toBe(true);
  const restored=readBriefMemory('mobility-reload')!;expect(restored.mobilityNeedsClarification).toBe(true);
  const turn=await resolveBriefTurn('需要',restored,context);expect(turn.resolution).toBe('confirmation');
  expect(turn.memory.mobilityRequirement?.decision).toBe('needed');expect(turn.memory.mobilityNeedsClarification).toBe(false);
  expect(writeBriefMemory('mobility-reload',turn.memory)).toBe(true);expect(readBriefMemory('mobility-reload')?.mobilityRequirement?.evidence).toContain('用户答复：需要');
});
