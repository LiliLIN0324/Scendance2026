import {describe,expect,it} from 'vitest';
import {parseAgentRunEvents} from './agent-run-events';

const started={seq:1,tool:'get_scene',stage:'started',outcome:null,errorCode:null};
const finished={seq:2,tool:'get_scene',stage:'finished',outcome:'success',errorCode:null};
describe('safe agent tool observations',()=>{
 it('accepts ordered pages and an unchanged empty cursor',()=>{
  expect(parseAgentRunEvents({events:[started,finished],nextCursor:2,mayBeIncomplete:true},0).events).toHaveLength(2);
  expect(parseAgentRunEvents({events:[],nextCursor:2,mayBeIncomplete:true},2).nextCursor).toBe(2);
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
