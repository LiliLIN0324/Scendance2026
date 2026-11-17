import {describe,expect,it} from 'vitest';
import {parseAgentRunEvents} from './agent-run-events';

const started={seq:1,tool:'get_scene',stage:'started',outcome:null,errorCode:null};
const finished={seq:2,tool:'get_scene',stage:'finished',outcome:'success',errorCode:null};
const thought={seq:1,kind:'thought',round:1,thought:'先盘点场地已有物件，再决定挪哪些。',tool:null,stage:null,outcome:null,errorCode:null,argsSummary:null,durationMs:null};
describe('safe agent tool observations',()=>{
 it('accepts ordered pages and an unchanged empty cursor',()=>{
  expect(parseAgentRunEvents({events:[started,finished],nextCursor:2,mayBeIncomplete:true},0).events).toHaveLength(2);
  expect(parseAgentRunEvents({events:[],nextCursor:2,mayBeIncomplete:true},2).nextCursor).toBe(2);
 });
 it('accepts the new server shape (kind/round/thought) and old rows without kind',()=>{
  const withKind={...started,kind:'tool',round:null,thought:null,argsSummary:null,durationMs:null};
  const page=parseAgentRunEvents({events:[withKind],nextCursor:1,mayBeIncomplete:true},0);
  expect(page.events).toHaveLength(1);expect(page.thoughts).toHaveLength(0);
 });
 it('splits thought frames from tool receipts while keeping one seq order',()=>{
  const page=parseAgentRunEvents({events:[thought,{...started,seq:2,kind:'tool'},{...finished,seq:3,kind:'tool'}],nextCursor:3,mayBeIncomplete:true},0);
  expect(page.thoughts).toEqual([thought]);
  expect(page.events.map(event=>event.seq)).toEqual([2,3]);
  expect(page.nextCursor).toBe(3);
 });
 it('rejects thought frames that carry tool fields or break the bounds',()=>{
  for(const frame of [
   {...thought,round:0}, {...thought,round:7}, {...thought,thought:''}, {...thought,thought:'x'.repeat(401)},
   {...thought,tool:'get_scene'}, {...thought,kind:'tool'}, {...thought,private:'PRIVATE'},
  ]) expect(()=>parseAgentRunEvents({events:[frame],nextCursor:1,mayBeIncomplete:true},0)).toThrow();
 });
 it('rejects duplicate/out-of-order sequences and misleading cursors',()=>{
  expect(()=>parseAgentRunEvents({events:[finished,started],nextCursor:1,mayBeIncomplete:true},0)).toThrow();
  expect(()=>parseAgentRunEvents({events:[finished,finished],nextCursor:2,mayBeIncomplete:true},0)).toThrow();
  expect(()=>parseAgentRunEvents({events:[started],nextCursor:2,mayBeIncomplete:true},0)).toThrow();
  expect(()=>parseAgentRunEvents({events:[started],nextCursor:1,mayBeIncomplete:true},1)).toThrow();
 });
 it('rejects unknown tools, unapproved errors, raw arguments and started-as-success',()=>{
  for(const event of [
   {...started,tool:'private_content'}, {...started,arguments:'SECRET'}, {...started,outcome:'success'},
   {...finished,outcome:'failed',errorCode:'SECRET'}, {...finished,errorCode:'INVALID_TOOL_INPUT'},
  ]) expect(()=>parseAgentRunEvents({events:[event],nextCursor:event.seq,mayBeIncomplete:true},0)).toThrow();
 });
});
