// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { sceneSchema, type SceneV2 } from '../../../../supabase/functions/_shared/domain';
import { backendSceneToLayout, layoutToBackendScene } from '../lib/backend-adapter';
import { StructuralPropertiesPanel } from './structural-properties-panel';
import type { RoomLayout } from '../lib/types';
const state = vi.hoisted(()=>({layout:null as unknown,apply:vi.fn(),commit:vi.fn(),select:vi.fn(),setWidth:vi.fn(),setHeight:vi.fn(),setStoreyHeight:vi.fn()}));
vi.mock('../contexts',()=>({useRoomEditor:()=>({layout:state.layout,actions:{applyLayout:state.apply,setWidth:state.setWidth,setHeight:state.setHeight,setStoreyHeight:state.setStoreyHeight},history:{commitNow:state.commit}}),useSelection:()=>({selectOnly:state.select})}));
const id=(n:number)=>`80000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
function fixture():SceneV2{return sceneSchema.parse({schemaVersion:2,venue:{shape:'rectangle',width:8,depth:6,height:3,entrances:[]},objects:[{id:id(1),materialId:'chair',position:{x:0.5,z:2},size:{width:0.5,depth:0.5,height:0.9},rotation:0,color:'#abcdef',locked:false}],camera:'overview',lighting:'neutral',structure:{walls:[{id:id(2),start:{x:0,z:0},end:{x:0,z:6},thickness:0.2,height:3,kind:'exterior',status:'detected'}],openings:[{id:id(3),wallId:id(2),kind:'door',offset:3,width:1,height:2.1,sillHeight:0,status:'detected'}],columns:[]},sources:[],dimensions:[]}) as SceneV2;}
beforeEach(()=>{state.layout=backendSceneToLayout(fixture());vi.clearAllMocks();});
afterEach(cleanup);
it('applies a checked structural dimension as one undoable change and preserves the owned opening',()=>{
  const scene=fixture();
  scene.dimensions=[{id:id(4),targetId:id(3),kind:'distance',measure:'width',valueMeters:1,status:'confirmed',label:'实测门宽'}];
  state.layout=backendSceneToLayout(scene);
  render(<StructuralPropertiesPanel/>);
  fireEvent.click(screen.getByRole('button',{name:'选择门 1'}));
  fireEvent.change(screen.getByLabelText('门窗宽 / m'),{target:{value:'1.234'}});
  fireEvent.click(screen.getByRole('button',{name:'应用'}));
  expect(state.commit).toHaveBeenCalledOnce();expect(state.apply).toHaveBeenCalledOnce();
  const saved=layoutToBackendScene(state.apply.mock.calls[0][0]) as SceneV2;
  expect(saved.structure.openings[0]).toMatchObject({wallId:id(2),width:1.234,status:'confirmed'});
  expect(saved.structure.openings[0].offset).toBeCloseTo(3,10);
  expect(saved.dimensions[0].valueMeters).toBe(1.234);
  expect(saved.objects[0].position).toEqual({x:0.5,z:2});
});
it('rejects a wall thickness edit that would embed existing furniture before creating history',()=>{
  render(<StructuralPropertiesPanel/>);
  fireEvent.change(screen.getByLabelText('墙厚 / m'),{target:{value:'1.2'}});
  fireEvent.click(screen.getByRole('button',{name:'应用'}));
  expect(state.apply).not.toHaveBeenCalled();expect(state.commit).not.toHaveBeenCalled();
  expect(screen.getByText(/这项修改会让物件穿墙/)).toBeTruthy();
});
it('keeps asset authorization, names and groups when only a structural dimension changes',()=>{
  const scene=fixture();
  scene.objects=[{...scene.objects[0]!,materialId:'asset',assetId:id(5)}];
  const layout=backendSceneToLayout(scene,{assetUrls:{[id(5)]:'https://storage.example/private.glb'},assetNames:{[id(5)]:'用户家具'}});
  layout.floors[0]!.items[0]!.groupId='existing-group';
  state.layout=layout;
  render(<StructuralPropertiesPanel/>);
  fireEvent.change(screen.getByLabelText('墙高 / m'),{target:{value:'2.8'}});
  fireEvent.click(screen.getByRole('button',{name:'应用'}));
  expect(state.apply).toHaveBeenCalledOnce();
  expect(state.apply.mock.calls[0]![0].floors[0].items[0]).toMatchObject({glbUrl:'https://storage.example/private.glb',name:'用户家具',groupId:'existing-group',assetId:id(5)});
});
function shell():RoomLayout{return {name:'普通壳体',width:10,height:8,floors:[{id:'ground',name:'活动场地',height:3,floorColor:'#f5f6f7',floorPattern:'solid',items:[]}]};}
it('普通壳体的结构入口默认收起，展开后给场地尺寸并走既有 reducer',()=>{
  state.layout=shell();
  render(<StructuralPropertiesPanel/>);
  const entry=screen.getByText('普通壳体').closest('details')!;
  expect(entry.open).toBe(false);
  fireEvent.change(screen.getByLabelText('总宽 / m'),{target:{value:'12'}});
  fireEvent.change(screen.getByLabelText('总长 / m'),{target:{value:'9'}});
  fireEvent.change(screen.getByLabelText('层高 / m'),{target:{value:'3.2'}});
  fireEvent.click(screen.getByRole('button',{name:'应用'}));
  expect(state.commit).toHaveBeenCalledOnce();
  expect(state.setWidth).toHaveBeenCalledWith(12);
  expect(state.setHeight).toHaveBeenCalledWith(9);
  expect(state.setStoreyHeight).toHaveBeenCalledWith(3.2);
  expect(state.apply).not.toHaveBeenCalled();
});
it('普通壳体有墙时改墙厚直接回写 floor.interiorWalls，不升级成 backendSceneV2',()=>{
  const layout=shell();
  layout.floors[0]!.interiorWalls=[{id:id(11),x1:-4,z1:-3,x2:4,z2:-3,thickness:.16,height:3,kind:'interior',status:'confirmed'}];
  state.layout=layout;
  render(<StructuralPropertiesPanel/>);
  fireEvent.change(screen.getByLabelText('墙厚 / m'),{target:{value:'0.4'}});
  fireEvent.click(screen.getByRole('button',{name:'应用'}));
  expect(state.apply).toHaveBeenCalledOnce();
  const saved=state.apply.mock.calls[0]![0] as RoomLayout;
  expect(saved.backendSceneV2).toBeUndefined();
  expect(saved.floors[0]!.interiorWalls![0]!.thickness).toBe(0.4);
  expect(saved.floors[0]!.interiorWalls![0]!.x1).toBe(-4);
});
