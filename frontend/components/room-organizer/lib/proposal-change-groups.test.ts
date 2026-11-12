import {describe,expect,it} from 'vitest';
import type {ProposalDifference} from '../three/proposal-preview';
import type {FurnitureItem, RoomLayout, RoomZone} from './types';
import {
  changeGroupCounts,
  groupChangeItems,
  proposalChangeItems,
  proposalChangeSummary,
  proposalZoneCount,
  UNNAMED_MATERIAL,
} from './proposal-change-groups';

const item=(id:string,name:string,x:number,z:number):FurnitureItem=>({
  id,name,type:'chair',width:.5,depth:.5,height:.8,color:'#fff',icon:'',position:{x,z},
});

const zone=(id:string,x:number,z:number,w:number,d:number):RoomZone=>({
  id,name:id,color:'#3b82f6',x,z,w,d,
});

const layout=(items:FurnitureItem[],zones:RoomZone[]=[]):RoomLayout=>({
  floors:[{id:'f',name:'一层',items,zones,floorColor:'#fff'}],
}) as unknown as RoomLayout;

const diff=(change:ProposalDifference):ProposalDifference=>change;

describe('proposal change groups',()=>{
 it('maps added / changed / removed into the three groups with counts and total',()=>{
  const a=item('a','椅子',-1,2), b=item('b','桌子',3,4), bNext={...b,position:{x:4,z:4}}, c=item('c','灯',0,0);
  const differences:ProposalDifference[]=[
   diff({id:'a',kind:'removed',before:{item:a,floorIndex:0}}),
   diff({id:'b',kind:'changed',before:{item:b,floorIndex:0},after:{item:bNext,floorIndex:0}}),
   diff({id:'c',kind:'added',after:{item:c,floorIndex:0}}),
  ];
  const items=proposalChangeItems(differences);
  expect(changeGroupCounts(items)).toEqual({added:1,moved:1,removed:1});
  const groups=groupChangeItems(items);
  expect(groups.added.map(v=>v.id)).toEqual(['c']);
  expect(groups.moved.map(v=>v.id)).toEqual(['b']);
  expect(groups.removed.map(v=>v.id)).toEqual(['a']);
  expect(proposalChangeSummary(items,null).total).toBe(3);
 });

 it('returns empty groups for an unchanged proposal; the card renders nothing',()=>{
  const items=proposalChangeItems([]);
  expect(changeGroupCounts(items)).toEqual({added:0,moved:0,removed:0});
  expect(groupChangeItems(items)).toEqual({added:[],moved:[],removed:[]});
  const summary=proposalChangeSummary(items,proposalZoneCount([],layout([]),layout([])));
  expect(summary).toEqual({total:0,zoneCount:null,elapsedMs:null});
 });

 it('omits the zone count when either layout has no zone annotations',()=>{
  const a=item('a','椅子',1,1);
  const before=layout([a]); const after=layout([]);
  const differences:ProposalDifference[]=[diff({id:'a',kind:'removed',before:{item:a,floorIndex:0}})];
  expect(proposalZoneCount(differences,before,after)).toBeNull();
 });

 it('omits the zone count when existing zones match no changed item',()=>{
  const a=item('a','椅子',10,10);
  const before=layout([a],[zone('z1',0,0,4,4)]);
  const after=layout([],[zone('z1',0,0,4,4)]);
  const differences:ProposalDifference[]=[diff({id:'a',kind:'removed',before:{item:a,floorIndex:0}})];
  expect(proposalZoneCount(differences,before,after)).toBeNull();
 });

 it('counts distinct zones touched by removed (base) and added (candidate) items',()=>{
  const old=item('old','椅子',1,1);
  const fresh=item('fresh','沙发',6,1);
  const before=layout([old],[zone('z1',0,0,4,4)]);
  const after=layout([fresh],[zone('z1',0,0,4,4),zone('z2',4,0,4,4)]);
  const differences:ProposalDifference[]=[
   diff({id:'old',kind:'removed',before:{item:old,floorIndex:0}}),
   diff({id:'fresh',kind:'added',after:{item:fresh,floorIndex:0}}),
  ];
  expect(proposalZoneCount(differences,before,after)).toBe(2);
 });

 it('labels items by name and falls back to the unnamed material label',()=>{
  const named=item('x','圆桌',1,1);
  const unnamed={...item('y','',2,2)};
  const differences:ProposalDifference[]=[
   diff({id:'x',kind:'added',after:{item:named,floorIndex:0}}),
   diff({id:'y',kind:'removed',before:{item:unnamed,floorIndex:0}}),
  ];
  const [added,removed]=proposalChangeItems(differences);
  expect(added?.label).toBe('圆桌');
  expect(removed?.label).toBe(UNNAMED_MATERIAL);
 });

 it('prefers the candidate name for a changed item and keeps its id',()=>{
  const old=item('m','旧名',1,1);
  const next={...old,name:'新名',position:{x:2,z:2}};
  const [change]=proposalChangeItems([diff({id:'m',kind:'changed',before:{item:old,floorIndex:0},after:{item:next,floorIndex:0}})]);
  expect(change).toEqual({id:'m',kind:'moved',label:'新名'});
 });

 it('normalizes elapsedMs to a rounded positive number and drops missing/invalid values',()=>{
  const items=proposalChangeItems([]);
  expect(proposalChangeSummary(items,null,1523.4).elapsedMs).toBe(1523);
  expect(proposalChangeSummary(items,null,0).elapsedMs).toBeNull();
  expect(proposalChangeSummary(items,null,Number.NaN).elapsedMs).toBeNull();
  expect(proposalChangeSummary(items,null,undefined).elapsedMs).toBeNull();
  expect(proposalChangeSummary(items,null,null).elapsedMs).toBeNull();
 });
});
