import {describe,expect,it} from 'vitest';
import {makeFloor,makeItem,makeLayout} from './__testfixtures__/fixtures';
import {validateBoundedEdit} from './bounded-edit-validation';

const setup=()=>makeLayout({id:'event',floors:[makeFloor({items:[makeItem({id:'target',position:{x:1,z:1},color:'#ffffff'}),makeItem({id:'other',position:{x:3,z:3}})]})]});
describe('有界局部修改',()=>{
 it('permits only explicitly allowed fields of explicit unlocked objects',()=>{
  const before=setup(),after=structuredClone(before);after.floors[0]!.items[0]!.position={x:2,z:1};
  expect(validateBoundedEdit(before,after,[{id:'target',fields:['position']}])).toEqual({ok:true});
  expect(validateBoundedEdit(before,after,[{id:'target',fields:['color']}]).ok).toBe(false);
 });
 it('rejects non-target, lock, structure, missing objects and changed identities',()=>{
  const before=setup(),target=[{id:'target',fields:['color'] as const}];
  const other=structuredClone(before);other.floors[0]!.items[1]!.color='#000000';expect(validateBoundedEdit(before,other,target).ok).toBe(false);
  const structural=structuredClone(before);structural.width+=1;expect(validateBoundedEdit(before,structural,target).ok).toBe(false);
  const missing=structuredClone(before);missing.floors[0]!.items.splice(0,1);expect(validateBoundedEdit(before,missing,target).ok).toBe(false);
  const switched=structuredClone(before);switched.id='other';expect(validateBoundedEdit(before,switched,target).ok).toBe(false);
  const locked=structuredClone(before);locked.floors[0]!.items[0]!.locked=true;const changed=structuredClone(locked);changed.floors[0]!.items[0]!.color='#000000';expect(validateBoundedEdit(locked,changed,target).ok).toBe(false);
  const opening=structuredClone(before);opening.floors[0]!.items[0]!.structuralOpeningId='opening';const moved=structuredClone(opening);moved.floors[0]!.items[0]!.position={x:2,z:1};expect(validateBoundedEdit(opening,moved,[{id:'target',fields:['position']}]).ok).toBe(false);
 });
 it('rejects unknown fields, duplicate IDs, invalid values and unrequested extra fields',()=>{
  const before=setup(),after=structuredClone(before);after.floors[0]!.items[0]!.color='#000000';
  expect(validateBoundedEdit(before,after,[{id:'target',fields:['color','bogus' as never]}]).ok).toBe(false);
  const dup=structuredClone(after);dup.floors[0]!.items[1]!.id='target';expect(validateBoundedEdit(before,dup,[{id:'target',fields:['color']}]).ok).toBe(false);
  const invalid=structuredClone(after);invalid.floors[0]!.items[0]!.width=NaN;expect(validateBoundedEdit(before,invalid,[{id:'target',fields:['color','width']}]).ok).toBe(false);
  const extra=structuredClone(after);Object.assign(extra.floors[0]!.items[0]!,{unknown:'不应丢失'});expect(validateBoundedEdit(before,extra,[{id:'target',fields:['color']}]).ok).toBe(false);
 });
});
