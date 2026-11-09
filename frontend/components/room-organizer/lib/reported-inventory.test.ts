// @vitest-environment jsdom
import {afterEach,describe,expect,it,vi} from 'vitest';
import {parseModelBrief,parseBriefConversation} from '../../../../supabase/functions/_shared/brief-extract-contract';
import {resolveBriefTurn} from '@/lib/agent-resolver';
import {initialBriefMemory,parseBriefTurn} from './brief-agent';
import {readBriefMemory,writeBriefMemory} from './assistant-brief-memory';
import {scopedAssistantStorage} from '../hooks/use-assistant-sessions';
import type {BriefExtraction} from './workbench-agent';

const context={venueUp:false,scaleTyped:false,hasBase:false,command:null} as const;
const empty:BriefExtraction={event:null,headcount:null,venueIO:null,lengthM:null,widthM:null,areaM2:null,timeOfDay:null};
afterEach(()=>{localStorage.clear();vi.unstubAllEnvs();});
describe('物料原话只作用户提及',()=>{
 it('keeps attendance separate and preserves the exact statement through storage and sessions',async()=>{
  vi.stubEnv('NEXT_PUBLIC_AGENT_ENABLED','1');
  const raw='本场30人，现有80把椅子';
  const transport={briefExtract:vi.fn(async()=>({enabled:true,extraction:{headcount:30,inventoryMentions:[{evidence:'80把椅子'}]}}))};
  const turn=await resolveBriefTurn(raw,initialBriefMemory(),context,transport);
  expect(turn.memory.headcount).toBe(30);expect(turn.memory.reportedInventory).toEqual([{evidence:'现有80把椅子',status:'reported'}]);
  expect(turn.modelReply).toContain('暂未计入库存');
  const a=scopedAssistantStorage('activity:a'),b=scopedAssistantStorage('activity:b');
  expect(writeBriefMemory('one',turn.memory,a)).toBe(true);expect(writeBriefMemory('two',initialBriefMemory(),a)).toBe(true);expect(writeBriefMemory('one',initialBriefMemory(),b)).toBe(true);
  expect(readBriefMemory('one',a)?.reportedInventory).toEqual(turn.memory.reportedInventory);expect(readBriefMemory('two',a)?.reportedInventory).toBeUndefined();expect(readBriefMemory('one',b)?.reportedInventory).toBeUndefined();
 });
 it('keeps old records compatible and does not report a failed write as saved',()=>{
  const old=initialBriefMemory();expect(writeBriefMemory('old',old)).toBe(true);expect(readBriefMemory('old')?.reportedInventory).toBeUndefined();
  localStorage.setItem('scendance.assistant-brief-memory.v1','{broken');expect(writeBriefMemory('new',{...old,reportedInventory:[{evidence:'80把椅子',status:'reported'}]})).toBe(false);
 });
 it('rejects fabricated evidence at the shared provider boundary for both protocols',()=>{
  expect(()=>parseModelBrief({inventoryMentions:[{evidence:'80把椅子'}]},'我们有30人')).toThrow('MODEL_EVIDENCE_MISMATCH');
  expect(()=>parseBriefConversation({extraction:{inventoryMentions:[{evidence:'80把椅子'}]},reply:'请继续。',unhandled:[],factEvidence:[]},'我们有30人')).toThrow('MODEL_EVIDENCE_MISMATCH');
 });
 it('accepts self-contained inventory evidence in unified conversation without a duplicate factEvidence key',()=>{
  const result=parseBriefConversation({extraction:{headcount:30,inventoryMentions:[{evidence:'80把椅子'}]},reply:'可以继续补充场地。',unhandled:[],factEvidence:[{key:'headcount',evidence:'30人'}]},'本场30人，现有80把椅子');
  expect(result.extraction.inventoryMentions).toEqual([{evidence:'80把椅子'}]);
 });
 it.each(['上次有80把椅子','本场没有80把椅子','我们大约有80把椅子','可能有80把椅子','我们需要80把椅子','我们有80人'])('does not promote uncertain, past, denied or non-stock wording: %s',raw=>{
  const evidence=raw.includes('80把椅子')?'80把椅子':'80人';
  const turn=parseBriefTurn(raw,initialBriefMemory(),context,{...empty,inventoryMentions:[{evidence}]});
  expect(turn.memory.reportedInventory).toBeUndefined();
 });
 it('retains both statements and marks them for review on correction',()=>{
  const first=parseBriefTurn('我们有80把椅子',initialBriefMemory(),context,{...empty,inventoryMentions:[{evidence:'80把椅子'}]});
  const next=parseBriefTurn('更正，我们有60把椅子',first.memory,context,{...empty,inventoryMentions:[{evidence:'60把椅子'}]});
  expect(next.memory.reportedInventory).toEqual([{evidence:'我们有80把椅子',status:'needs_review'},{evidence:'我们有60把椅子',status:'needs_review'}]);
 });
 it('does not delete earlier remarks when the bounded record is full',()=>{
  const records=Array.from({length:50},(_,i)=>({evidence:`${i+1}把椅子`,status:'reported' as const}));
  const turn=parseBriefTurn('我们有99把椅子',{...initialBriefMemory(),reportedInventory:records},context,{...empty,inventoryMentions:[{evidence:'99把椅子'}]});
  expect(turn.memory.reportedInventory).toEqual(records);
 });
 it('tells the user when the bounded store cannot accept a new mention',async()=>{
  vi.stubEnv('NEXT_PUBLIC_AGENT_ENABLED','1');
  const records=Array.from({length:50},(_,i)=>({evidence:`${i+1}把椅子`,status:'reported' as const}));
  const turn=await resolveBriefTurn('我们有99把椅子',{...initialBriefMemory(),reportedInventory:records},context,{briefExtract:async()=>({enabled:true,extraction:{inventoryMentions:[{evidence:'99把椅子'}]}})});
  expect(turn.memory.reportedInventory).toEqual(records);expect(turn.modelReply).toContain('尚未记入');
 });
});
