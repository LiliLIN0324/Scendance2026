import {describe,expect,it} from 'vitest';
import {createSourceEditorCoordinator,type SourceEditorRole} from './source-editor-coordinator';
const roles:SourceEditorRole[]=['brief','drawing','images'];
function setup(scope:string){const c=createSourceEditorCoordinator(scope),writers=Object.fromEntries(roles.map(role=>[role,c.register(role)])) as Record<SourceEditorRole,ReturnType<typeof c.register>>;return {c,writers};}
function load(writers:Record<SourceEditorRole,ReturnType<ReturnType<typeof createSourceEditorCoordinator>['register']>>){for(const writer of Object.values(writers)){const token=writer.beginRead();expect(writer.readSucceeded(token)).toBe(true);}}
describe('local source editor coordination',()=>{
 it('requires all registered writers and completed reads, never zero pending by itself',()=>{
  const c=createSourceEditorCoordinator('first');expect(c.snapshot()).toMatchObject({status:'unknown',reason:'unregistered:brief'});
  const brief=c.register('brief');expect(c.snapshot()).toMatchObject({status:'unknown',reason:'loading:brief'});
  expect(brief.readSucceeded(brief.beginRead())).toBe(true);expect(c.snapshot().status).toBe('unknown');
  c.destroy();expect(c.snapshot()).toMatchObject({status:'unknown',reason:'destroyed'});
 });
 it('makes edits unknown synchronously and saves only the matching newest revision',()=>{
  const {c,writers}=setup('second');load(writers);expect(c.snapshot().status).toBe('settled');
  writers.brief.markDirty();expect(c.snapshot()).toMatchObject({status:'unknown',reason:'dirty:brief'});
  const first=writers.brief.beginWrite();writers.brief.markDirty();writers.brief.finishWrite(first,true);
  expect(c.snapshot().status).toBe('unknown');const latest=writers.brief.beginWrite();writers.brief.finishWrite(latest,true);
  expect(c.snapshot().status).toBe('settled');c.destroy();
 });
 it('out-of-order completion or write failure stays unknown until a newer successful save',()=>{
  const {c,writers}=setup('third');load(writers);writers.images.markDirty();const first=writers.images.beginWrite();
  writers.images.markDirty();const second=writers.images.beginWrite();writers.images.finishWrite(second,true);writers.images.finishWrite(first,true);
  expect(c.snapshot()).toMatchObject({status:'unknown',reason:'write-failed:images'});
  const retry=writers.images.beginWrite();writers.images.finishWrite(retry,false);expect(c.snapshot().status).toBe('unknown');
  const fixed=writers.images.beginWrite();writers.images.finishWrite(fixed,true);expect(c.snapshot().status).toBe('settled');
  expect(()=>writers.images.finishWrite(fixed,true)).toThrow();c.destroy();
 });
 it('late reads cannot clear newer reads, dirty edits or remote invalidation',()=>{
  const {c,writers}=setup('fourth');load(writers);const old=writers.drawing.beginRead(),newer=writers.drawing.beginRead();
  expect(writers.drawing.readSucceeded(old)).toBe(false);writers.drawing.markDirty();expect(writers.drawing.readSucceeded(newer)).toBe(false);
  expect(c.snapshot()).toMatchObject({status:'unknown',reason:'stale:drawing'});
  expect(()=>writers.drawing.beginRead()).toThrow('未保存');
  c.invalidate();expect(c.snapshot().status).toBe('unknown');c.destroy();
 });
 it('writer loss and duplicates remain unknown even after later registration and old completions',()=>{
  const {c,writers}=setup('fifth');load(writers);writers.brief.markDirty();const pending=writers.brief.beginWrite();writers.brief.destroy();
  expect(c.snapshot()).toMatchObject({status:'unknown',reason:'writer-lost'});expect(()=>writers.brief.finishWrite(pending,true)).toThrow();
  const replacement=c.register('brief');replacement.readSucceeded(replacement.beginRead());expect(c.snapshot().status).toBe('unknown');c.destroy();
  const reopened=setup('fifth');load(reopened.writers);expect(reopened.c.snapshot()).toMatchObject({status:'unknown',reason:'writer-lost'});reopened.c.destroy();
  const other=setup('sixth');load(other.writers);expect(()=>other.c.register('brief')).toThrow();expect(other.c.snapshot().status).toBe('unknown');other.c.destroy();
 });
 it('separates scopes and refuses duplicate coordinators without leaving the first settled',()=>{
  const one=setup('scope-a'),two=setup('scope-b');load(one.writers);load(two.writers);one.writers.images.markDirty();
  expect(one.c.snapshot().status).toBe('unknown');expect(two.c.snapshot().status).toBe('settled');
  expect(()=>createSourceEditorCoordinator('scope-b')).toThrow();expect(two.c.snapshot().status).toBe('unknown');
  one.c.destroy();two.c.destroy();
 });
 it('clean unmount and immediate remount must re-read and cannot use old read tokens',()=>{
  const {c,writers}=setup('strict-clean');load(writers);const old=writers.brief, oldRead=old.beginRead();old.destroy();
  expect(c.snapshot()).toMatchObject({status:'unknown',reason:'unregistered:brief'});
  const next=c.register('brief');expect(c.snapshot()).toMatchObject({status:'unknown',reason:'loading:brief'});
  expect(()=>old.readSucceeded(oldRead)).toThrow();next.readSucceeded(next.beginRead());expect(c.snapshot().status).toBe('settled');c.destroy();
 });
 it('does not clear a remote invalidation or failed read just because a fresh read was started before unmount',()=>{
  for(const [scope,trigger] of [['remote', 'invalidate'],['failed', 'fail']] as const){
    const {c,writers}=setup(`uncertain-${scope}`);load(writers);
    if(trigger==='invalidate')c.invalidate();else {const token=writers.brief.beginRead();writers.brief.readFailed(token);}
    writers.brief.beginRead();writers.brief.destroy();expect(c.snapshot()).toMatchObject({status:'unknown',reason:'writer-lost'});c.destroy();
  }
 });
 it('a clean loading registration can retire, but an in-flight or failed write taints the scope',()=>{
  const {c,writers}=setup('clean-loading');const old=writers.brief.beginRead();writers.brief.destroy();const next=c.register('brief');
  expect(()=>writers.brief.readSucceeded(old)).toThrow();next.readSucceeded(next.beginRead());
  for(const role of ['drawing','images'] as const)writers[role].readSucceeded(writers[role].beginRead());
  expect(c.snapshot().status).toBe('settled');writers.drawing.markDirty();const ticket=writers.drawing.beginWrite();writers.drawing.destroy();
  expect(c.snapshot()).toMatchObject({status:'unknown',reason:'writer-lost'});expect(()=>writers.drawing.finishWrite(ticket,true)).toThrow();c.destroy();
 });
 it('permits a full reread only when all roles are registered, clean, idle and in the same live scope',()=>{
  const {c,writers}=setup('recheck-safe');load(writers);expect(c.canRecheck()).toBe(true);c.invalidate();expect(c.canRecheck()).toBe(true);
  const read=writers.brief.beginRead();expect(c.canRecheck()).toBe(false);
  writers.images.markDirty();expect(writers.brief.readSucceeded(read)).toBe(false);expect(c.canRecheck()).toBe(false);
  expect(c.snapshot().status).toBe('unknown');c.destroy();expect(c.canRecheck()).toBe(false);
 });
 it('refuses reread during pending writes or failures and invalidates other role reads',()=>{
  const {c,writers}=setup('recheck-pending');load(writers);const read=writers.drawing.beginRead();
  writers.images.markDirty();const write=writers.images.beginWrite();expect(c.canRecheck()).toBe(false);
  writers.images.finishWrite(write,false);expect(writers.drawing.readSucceeded(read)).toBe(false);
  expect(c.canRecheck()).toBe(false);expect(()=>writers.images.beginRead()).toThrow('未保存');c.destroy();
 });
 it('allows recheck after a failed read only once all pending readers have ended',()=>{
  const {c,writers}=setup('recheck-read-failed');load(writers);
  const failed=writers.drawing.beginRead();writers.drawing.readFailed(failed);expect(c.canRecheck()).toBe(true);
  const next=writers.drawing.beginRead();expect(c.canRecheck()).toBe(false);
  expect(writers.drawing.readSucceeded(next)).toBe(true);expect(c.canRecheck()).toBe(true);c.destroy();
 });
 it('read errors are unknown and subscribers see the synchronous dirty transition',()=>{
  const {c,writers}=setup('scope-c');load(writers);const states:string[]=[];const stop=c.subscribe(value=>states.push(value.status));
  writers.brief.markDirty();expect(states).toEqual(['settled','unknown']);const token=writers.drawing.beginRead();writers.drawing.readFailed(token);
  expect(c.snapshot().status).toBe('unknown');stop();c.destroy();
 });
});
