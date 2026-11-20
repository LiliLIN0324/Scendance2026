import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {createApi} from '../supabase/functions/_shared/api.ts';
import {database,outsider,owner,scene,studio} from './fixtures.ts';

describe('conversation turns',()=>{
 let f:Awaited<ReturnType<typeof database>>;
 beforeAll(async()=>{f=await database();},30000);afterAll(async()=>{await f.db.close();});

 const post=(actor:string,turns:unknown[],env=(_key:string)=>undefined as string|undefined)=>
  createApi(f.backend,env)(new Request('https://local.test/conversation/turns',{method:'POST',
   headers:{authorization:`Bearer ${actor}`,'content-type':'application/json'},body:JSON.stringify({turns})}));

 it('records a local-only turn and upserts the visible reply by turnKey',async()=>{
  const project=await f.rpc(owner,'projects.create',{studioId:studio,name:'留痕',scene:scene()});
  const turnKey=crypto.randomUUID();
  const base={turnKey,sessionId:'ses-test',turnIndex:0,surface:'local_command',userText:'帮我加两把椅子',projectId:project.id};
  const first=await post(owner,[{...base,outcome:'queued'}]);
  expect(first.status).toBe(200);expect(await first.json()).toEqual({stored:1,skipped:0});
  const second=await post(owner,[{...base,assistantText:'已加 2 把椅子',outcome:'local_only'}]);
  expect(await second.json()).toEqual({stored:1,skipped:0});
  const rows=await f.db.query<{user_text:string;assistant_text:string|null;outcome:string;surface:string}>('select user_text,assistant_text,outcome,surface from scene_private.conversation_turns where turn_key=$1',[turnKey]);
  expect(rows.rows).toEqual([{user_text:'帮我加两把椅子',assistant_text:'已加 2 把椅子',outcome:'local_only',surface:'local_command'}]);
 });

 it('drops credential-shaped text instead of storing it',async()=>{
  const res=await post(owner,[{turnKey:crypto.randomUUID(),sessionId:'ses-test',turnIndex:1,surface:'brief',userText:'我的 api key: sk-abcdefgh12345678',outcome:'answered'}]);
  expect(await res.json()).toEqual({stored:0,skipped:1});
 });

 it('rejects a non-member instead of writing the turn',async()=>{
  const project=await f.rpc(owner,'projects.create',{studioId:studio,name:'留痕权限',scene:scene()});
  const res=await post(outsider,[{turnKey:crypto.randomUUID(),sessionId:'ses-outsider',turnIndex:0,surface:'brief',userText:'非成员不该留下这一轮',outcome:'answered',projectId:project.id}]);
  expect(await res.json()).toEqual({stored:0,skipped:0});
 });

 it('stops writing when CONVERSATION_TRACE=0',async()=>{
  const res=await post(owner,[{turnKey:crypto.randomUUID(),sessionId:'ses-off',turnIndex:0,surface:'brief',userText:'关闭开关后不写入',outcome:'answered'}],key=>key==='CONVERSATION_TRACE'?'0':undefined);
  expect(await res.json()).toEqual({stored:0,skipped:0});
 });
});
