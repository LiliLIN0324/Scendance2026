import {describe,expect,it} from 'vitest';
import {makeFloor,makeItem,makeLayout} from './__testfixtures__/fixtures';
import {generationMaterialDiff} from './generation-material-diff';
import {hasOutcomeChanges,outcomeSummary} from '@/lib/generation-outcome';

describe('generation material outcome',()=>{
 it('separates actual removals and excludes structural door markers in both directions',()=>{
  const old=makeItem({id:'old',type:'chair'}),door=makeItem({id:'door',type:'door',structuralOpeningId:'door-1'}),added=makeItem({id:'new',type:'chair'});
  const before=makeLayout({floors:[makeFloor({items:[old]})]}),after=makeLayout({floors:[makeFloor({items:[added,door]})]});
  const diff=generationMaterialDiff(before,after);expect(diff.added.map(x=>x.id)).toEqual(['new']);expect(diff.removed.map(x=>x.id)).toEqual(['old']);
  const outcome={placed:diff.added,removed:diff.removed,refused:[],skipped:[]};expect(outcomeSummary(outcome)).toBe('放了 1 件、移除 1 件');expect(hasOutcomeChanges(outcome)).toBe(true);
 });
 it('recognizes removal-only as an actual change',()=>{
  expect(hasOutcomeChanges({placed:[],removed:[{id:'x'}],refused:[],skipped:[]})).toBe(true);
 });
});
