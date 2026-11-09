import {describe,expect,it} from 'vitest';
import {createSourceEditorCoordinator} from './source-editor-coordinator';
import {recheckSourceEditors,type SourceRecheckReader} from './source-editor-recheck';

function fixture(scope:string){
 const coordinator=createSourceEditorCoordinator(scope),brief=coordinator.register('brief'),drawing=coordinator.register('drawing'),images=coordinator.register('images');
 for(const writer of [brief,drawing,images])writer.readSucceeded(writer.beginRead());
 const local={brief:'原需求',drawing:'原图纸',images:'原图片'};
 const reader=(writer:typeof brief,key:keyof typeof local):SourceRecheckReader=>({writer,read:async()=>local[key],matchesCurrent:value=>value===local[key]});
 return {coordinator,brief,drawing,images,local,readers:{brief:reader(brief,'brief'),drawing:reader(drawing,'drawing'),images:reader(images,'images')}};
}
describe('显式来源重新核对',()=>{
 it('only settles after all three independent snapshots match the retained editor inputs',async()=>{
  const f=fixture('recheck-success');f.coordinator.invalidate();
  expect(await recheckSourceEditors(f.coordinator,'recheck-success',f.readers,()=>{})).toBe(true);
  expect(f.coordinator.snapshot().status).toBe('settled');f.coordinator.destroy();
 });
 it('does not overwrite drafts or mark settled when a read fails or a value differs',async()=>{
  const f=fixture('recheck-failure');f.coordinator.invalidate();
  const mismatch={...f.readers,drawing:{...f.readers.drawing,read:async()=> '另一份图纸'}};
  expect(await recheckSourceEditors(f.coordinator,'recheck-failure',mismatch,()=>{})).toBe(false);
  expect(f.local.drawing).toBe('原图纸');expect(f.coordinator.snapshot().status).toBe('unknown');
  const failing={...f.readers,images:{...f.readers.images,read:async()=>{throw new Error('读取失败');}}};
  expect(await recheckSourceEditors(f.coordinator,'recheck-failure',failing,()=>{})).toBe(false);expect(f.local.images).toBe('原图片');f.coordinator.destroy();
 });
 it('rejects delayed results after another editor changes or the session is lost',async()=>{
  const f=fixture('recheck-race');f.coordinator.invalidate();let release!:(value:string)=>void;
  const delayed={...f.readers,drawing:{...f.readers.drawing,read:()=>new Promise(resolve=>{release=resolve;})}};
  const pending=recheckSourceEditors(f.coordinator,'recheck-race',delayed,()=>{});f.brief.markDirty();f.local.brief='新的草稿';release('原图纸');
  expect(await pending).toBe(false);expect(f.local.brief).toBe('新的草稿');expect(f.coordinator.snapshot().status).toBe('unknown');f.coordinator.destroy();
  const g=fixture('recheck-lease');g.coordinator.invalidate();let valid=true,finish!:(value:string)=>void;
  const wait={...g.readers,images:{...g.readers.images,read:()=>new Promise(resolve=>{finish=resolve;})}};
  const result=recheckSourceEditors(g.coordinator,'recheck-lease',wait,()=>{if(!valid)throw new Error('失锁');});valid=false;finish('原图片');
  expect(await result).toBe(false);expect(g.coordinator.snapshot().status).toBe('unknown');g.coordinator.destroy();
 });
});
