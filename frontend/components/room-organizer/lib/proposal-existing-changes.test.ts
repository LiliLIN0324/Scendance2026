import {describe,expect,it} from 'vitest';
import type {ProposalDifference} from '../three/proposal-preview';
import type {FurnitureItem,RoomLayout} from './types';
import {describeExistingChanges} from './proposal-existing-changes';

const item=(id:string,x:number,z:number):FurnitureItem=>({id,name:'椅子',type:'chair',width:.5,depth:.5,height:.8,color:'#fff',icon:'',position:{x,z}});
const layout=(items:FurnitureItem[],name='一层')=>({floors:[{id:'f',name,items}]}) as unknown as RoomLayout;
describe('candidate effects on existing objects',()=>{
 it('shows each removed or adjusted original item with floor and before/after position',()=>{
  const a=item('a',-1,2),b=item('b',3,4),moved={...b,position:{x:4,z:4}},c=item('c',0,0);
  const before=layout([a,b]),after=layout([moved,c]);
  const diff:ProposalDifference[]=[{id:'a',kind:'removed',before:{item:a,floorIndex:0}},{id:'b',kind:'changed',before:{item:b,floorIndex:0},after:{item:moved,floorIndex:0}},{id:'c',kind:'added',after:{item:c,floorIndex:0}}];
  expect(describeExistingChanges(diff,before,after)).toEqual([
    {id:'a',kind:'removed',text:'移除 椅子（原场景第 1 件）：第 1 层（一层），横向 -1 米、纵向 2 米'},
    {id:'b',kind:'changed',text:'调整 椅子（原场景第 2 件）：第 1 层（一层），横向 3 米、纵向 4 米 → 第 1 层（一层），横向 4 米、纵向 4 米'},
  ]);
 });
 it('does not claim a material or colour change was a move',()=>{
  const old=item('a',1,1),updated={...old,color:'#000'};
  const before=layout([old]),after=layout([updated]);
  const lines=describeExistingChanges([{id:'a',kind:'changed',before:{item:old,floorIndex:0},after:{item:updated,floorIndex:0}}],before,after);
  expect(lines[0]?.text).toContain('位置未变，其他属性有调整');expect(lines[0]?.text).not.toContain('移动');
 });
 it('distinguishes co-located objects with the same name and preserves missing positions as unknown',()=>{
  const a=item('a',1,1),b=item('b',1,1),missing=item('c',1,1);delete missing.position;
  const before=layout([a,b,missing]),after=layout([]);
  const lines=describeExistingChanges([a,b,missing].map(original=>({id:original.id,kind:'removed' as const,before:{item:original,floorIndex:0}})),before,after);
  expect(lines[0]?.text).toContain('原场景第 1 件');expect(lines[1]?.text).toContain('原场景第 2 件');
  expect(lines[2]?.text).toContain('原场景第 3 件');expect(lines[2]?.text).toContain('位置未记录');
 });
 it('shows both floors when an existing object moves between floors',()=>{
  const old=item('a',1,1),moved={...old,position:{x:2,z:-1}};
  const before={floors:[{id:'f1',name:'一层',items:[old]},{id:'f2',name:'二层',items:[]}]} as unknown as RoomLayout;
  const after={floors:[{id:'f1',name:'一层',items:[]},{id:'f2',name:'二层',items:[moved]}]} as unknown as RoomLayout;
  const [line]=describeExistingChanges([{id:'a',kind:'changed',before:{item:old,floorIndex:0},after:{item:moved,floorIndex:1}}],before,after);
  expect(line?.text).toContain('第 1 层（一层），横向 1 米、纵向 1 米 → 第 2 层（二层），横向 2 米、纵向 -1 米');
 });
 it('does not claim a move for floating-point noise, and labels tiny real moves',()=>{
  const old=item('a',1,1),noise={...old,color:'#000',position:{x:1+1e-13,z:1}},small={...old,position:{x:1+1e-8,z:1}};
  const describe=(next:FurnitureItem)=>describeExistingChanges([{id:'a',kind:'changed',before:{item:old,floorIndex:0},after:{item:next,floorIndex:0}}],layout([old]),layout([next]))[0]!.text;
  expect(describe(noise)).toContain('位置未变');expect(describe(small)).toContain('位置有微小调整');
 });
});
