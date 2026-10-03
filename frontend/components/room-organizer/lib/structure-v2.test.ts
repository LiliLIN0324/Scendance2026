import * as THREE from 'three';
import { describe, it, expect } from 'vitest';
import { sceneSchema, type SceneV2 } from '../../../../supabase/functions/_shared/domain';
import { layoutReducer, type LayoutAction } from '../hooks/layout-reducer';
import { createFurnitureModel } from '../three/furniture-builders';
import { createProposalPreview, PROPOSAL_PREVIEW_TAG } from '../three/proposal-preview';
import { buildStructureShell } from '../three/structure-builder';
import { makeFloor, makeItem, makeLayout } from './__testfixtures__/fixtures';
import { backendSceneToLayout, layoutToBackendScene, createMeasuredRoomLayout } from './backend-adapter';
import { hasCollisions } from './geometry';
import { mountBand } from './mount-band';
import { parseStoredLayout } from './schema';
import { layoutGeometryScene, structuralItemCollides, materialCount, venueArea } from './structural-layout';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
function measured(): SceneV2 {
  return sceneSchema.parse({ schemaVersion: 2, venue: { shape: 'polygon', width: 10, depth: 8, height: 4,
    polygon: [{x:0,z:0},{x:10,z:0},{x:10,z:8},{x:3,z:8},{x:0,z:5}], entrances: [] },
    objects: [{id:id(1),materialId:'table',position:{x:2,z:2},rotation:30,size:{width:1.2,depth:0.8,height:0.75},color:'#ac8965',locked:false,notes:'桌子'}],
    camera:'overview',lighting:'warm', structure:{
      walls:[{id:id(2),start:{x:5,z:0},end:{x:5,z:8},thickness:0.26,height:3.7,kind:'interior',status:'confirmed',evidence:[{sourceAssetId:id(6),start:{x:0.5,z:0},end:{x:0.5,z:1}}]}],
      openings:[{id:id(3),wallId:id(2),kind:'door',offset:3,width:1.2,height:2.5,sillHeight:0,status:'confirmed'},
        {id:id(4),wallId:id(2),kind:'window',offset:5,width:1.2,height:1.1,sillHeight:1.2,status:'detected'}],
      columns:[{id:id(5),position:{x:8,z:5},size:{width:0.5,depth:0.6,height:4},rotation:22,status:'confirmed'}]},
    sources:[{assetId:id(6),name:'实测图',kind:'floorplan',width:800,height:600}],
    dimensions:[{id:id(7),kind:'wall',targetId:id(2),label:'中间墙',valueMeters:8,status:'confirmed'}],
    design:{concept:'木质展厅',palette:['#ead8bc'],highlights:[{title:'交流岛',description:'方便交流',objectIds:[id(1)]}],requirements:[]} }) as SceneV2;
}

describe('measured Scene v2 editor', () => {
  it('roundtrips polygon, exact wall/opening dimensions, columns, provenance, design and local save', () => {
    const input = measured();
    const layout = backendSceneToLayout(input);
    const reopened = parseStoredLayout(JSON.parse(JSON.stringify(layout)));
    expect(reopened).not.toBeNull();
    const actual = layoutToBackendScene(reopened!) as SceneV2;
    expect(actual).toEqual({ ...input, objects: input.objects.map(o => ({...o,rotation:expect.closeTo(o.rotation,10)})),
      structure:{...input.structure,columns:input.structure.columns.map(c=>({...c,rotation:expect.closeTo(c.rotation,10)}))} });
  });
  it('preserves measured tall halls and edited finishes through save and normalization', () => {
    const input=measured();input.venue.height=12;
    const layout=backendSceneToLayout(input);layout.floors[0].floorColor='#112233';
    layout.floors[0].floorPattern='wood';layout.floors[0].interiorWalls![0].color='#abc123';
    const normalized=layoutReducer({layout,activeFloorIndex:0},{type:'applyLayout',layout}).layout;
    const stored=parseStoredLayout(JSON.parse(JSON.stringify(normalized)));
    expect(stored?.floors[0].height).toBe(12);
    const scene=layoutToBackendScene(stored!) as SceneV2;
    expect(scene.finishes).toEqual({floorColor:'#112233',floorPattern:'wood',wallColors:{[id(2)]:'#abc123'}});
    const restored=backendSceneToLayout(scene);
    expect(restored.floors[0].floorColor).toBe('#112233');
    expect(restored.floors[0].interiorWalls![0].color).toBe('#abc123');
  });
  it('keeps an exterior mounted decoration valid while detecting invalid rotation and resizing', () => {
    const input=measured();input.structure.walls.push({id:id(9),start:{x:0,z:0},end:{x:10,z:0},thickness:0.3,height:4,kind:'exterior',status:'confirmed'});
    input.design!.highlights[0]!.objectIds=[id(10)];
    input.objects=[{id:id(10),materialId:'backdrop',position:{x:2,z:-0.25},size:{width:1,depth:0.2,height:1},elevation:1,wallId:id(9),rotation:0,color:'#123456',locked:false,notes:''}];
    const layout=backendSceneToLayout(input),item=layout.floors[0].items[0]!,state={layout,activeFloorIndex:0};
    expect(structuralItemCollides(item,layout)).toBe(false);
    expect(hasCollisions(item,layout.floors[0].items,layout.width,layout.height,{structureValidated:true})).toBe(false);
    expect(layoutReducer(state,{type:'setRotation',id:item.id,rotation:Math.PI/2})).toBe(state);
    expect(layoutReducer(state,{type:'resizeItem',id:item.id,dimension:'depth',value:1})).toBe(state);
    expect(layoutToBackendScene(layout)).toEqual(input);
  });
  it('seats new doors on a real wall with a structural identity and saves without inventing bounding walls', () => {
    const input=measured();input.structure.openings=[];
    const layout=backendSceneToLayout(input),state={layout,activeFloorIndex:0};
    const next=layoutReducer(state,{type:'addCatalogItem',id:id(12),catalogItem:{name:'新门',type:'door',category:'structure',price:0,icon:'',width:1,depth:0.1,height:2,color:'#123456'},position:{x:4.5,z:0}});
    const door=next.layout.floors[0].items.find(i=>i.id===id(12))!;
    expect(door.position).toEqual({x:0,z:0});
    expect(door.rotation).toBe(-Math.PI/2);
    expect(door.structuralOpeningId).toBe(id(12));
    expect((layoutToBackendScene(next.layout) as SceneV2).structure.openings).toMatchObject([{id:id(12),wallId:id(2),offset:3.5,width:1}]);
    expect(materialCount(next.layout.floors[0].items)).toBe(1);
    expect(venueArea(next.layout)).toBe(75.5);
  });
  it('previews changed openings and finishes, then restores original mesh visibility on cancel', () => {
    const before=backendSceneToLayout(measured()),after=structuredClone(before),scene=new THREE.Scene();
    buildStructureShell(THREE,scene,before);
    const original=scene.children.find(c=>c.userData.type==='floor')!;
    after.floors[0].floorColor='#123456';
    after.floors[0].items.find(i=>i.structuralOpeningId===id(3))!.width=2;
    const preview=createProposalPreview(THREE,scene,before,after);
    const root=scene.getObjectByName(PROPOSAL_PREVIEW_TAG)!;
    const floor=root.children.find(c=>c.userData.type==='floor') as THREE.Mesh<THREE.BufferGeometry,THREE.MeshStandardMaterial>;
    expect(floor.material.color.getHexString()).toBe('123456');
    expect(original.visible).toBe(false);
    expect(root.children.some(c=>c.userData.wallId===id(2))).toBe(true);
    preview.dispose();expect(original.visible).toBe(true);
  });
  it('preserves raised door thresholds through save/reopen and renders the frame inside the raised wall cut', () => {
    const input=measured();input.structure.openings[0]!.sillHeight=0.2;
    const layout=backendSceneToLayout(input),stored=parseStoredLayout(JSON.parse(JSON.stringify(layout)))!;
    expect(layoutToBackendScene(stored)).toEqual(input);
    const door=stored.floors[0].items.find(item=>item.structuralOpeningId===id(3))!;
    const frame=createFurnitureModel(THREE,door,false);
    const box=new THREE.Box3().setFromObject(frame);
    expect(box.min.y).toBeCloseTo(0.2,6);expect(box.max.y).toBeCloseTo(2.7,6);
    expect(mountBand(door)).toEqual({bottom:0.2,top:2.7});
    const scene=new THREE.Scene();buildStructureShell(THREE,scene,stored);scene.updateMatrixWorld(true);
    const wall=scene.children.find(node=>node.userData.wallId===id(2))!;
    const ray=new THREE.Raycaster(new THREE.Vector3(-1,0.1,-0.4),new THREE.Vector3(1,0,0));
    expect(ray.intersectObject(wall).length).toBeGreaterThan(0);
    ray.set(new THREE.Vector3(-1,0.5,-0.4),new THREE.Vector3(1,0,0));
    expect(ray.intersectObject(wall)).toHaveLength(0);
    const undone=layoutReducer({layout:stored,activeFloorIndex:0},{type:'applyLayout',layout:backendSceneToLayout(measured())});
    const redone=layoutReducer(undone,{type:'applyLayout',layout:stored});
    expect((layoutToBackendScene(redone.layout) as SceneV2).structure.openings[0]!.sillHeight).toBe(0.2);
  });
  it('refuses deleting the owning wall while retaining its door', () => {
    const layout=backendSceneToLayout(measured()),state={layout,activeFloorIndex:0};
    expect(layoutReducer(state,{type:'removeInteriorWall',id:id(2)})).toBe(state);
  });
  it('blocks edits that contradict confirmed opening sizes and column distance constraints', () => {
    const input=measured();input.dimensions.push({id:id(8),kind:'distance',targetId:id(3),measure:'width',label:'门宽',valueMeters:1.2,status:'confirmed'});
    const layout=backendSceneToLayout(input),state={layout,activeFloorIndex:0};
    expect(layoutReducer(state,{type:'updateItem',id:id(3),patch:{width:2}})).toBe(state);
    const changed=structuredClone(layout);changed.floors[0].items.find(i=>i.id===id(3))!.width=2;
    expect(()=>layoutToBackendScene(changed)).toThrow('门宽');
  });
  it('persists editable column dimensions and door width using owned wall offset', () => {
    const layout = backendSceneToLayout(measured());
    layout.floors[0].items.find(i=>i.structuralColumnId)!.width = 0.8;
    layout.floors[0].items.find(i=>i.structuralOpeningId===id(3))!.width = 1;
    const output = layoutToBackendScene(layout) as SceneV2;
    expect(output.structure.columns[0].size.width).toBe(0.8);
    expect(output.structure.openings[0].offset).toBeCloseTo(3.1, 10);
  });
  it('upgrades legacy entrances into actual wall openings and refuses dimensions that cannot contain them', () => {
    const base=backendSceneToLayout({schemaVersion:1,venue:{shape:'rectangle',width:10,depth:8,height:3,
      entrances:[{id:id(13),position:{x:5,z:0},width:1.6},{id:id(14),position:{x:10,z:3},width:1}]},objects:[],camera:'overview',lighting:'neutral'});
    const next=createMeasuredRoomLayout(base,{width:12,depth:9,height:4});
    const scene=layoutToBackendScene(next) as SceneV2;
    expect(scene.venue.entrances).toEqual([]);
    expect(scene.structure.openings).toMatchObject([{id:id(13),offset:4.2,width:1.6,status:'inferred'},{id:id(14),offset:2.5,width:1,status:'inferred'}]);
    expect(next.floors[0].items.filter(i=>i.structuralOpeningId)).toHaveLength(2);
    expect(()=>createMeasuredRoomLayout(base,{width:4,depth:9,height:4})).toThrow('入口位置');
  });
  it('creates real wall openings and polygon geometry at exact metric dimensions', () => {
    const input = measured(), layout = backendSceneToLayout(input), scene = new THREE.Scene();
    buildStructureShell(THREE,scene,layout);
    const floor = scene.children.find(n=>n.userData.type==='floor') as THREE.Mesh;
    expect(floor.geometry.type).toBe('ShapeGeometry');
    const wall = scene.children.find(n=>n.userData.wallId===id(2)) as THREE.Mesh;
    wall.geometry.computeBoundingBox();
    const size = wall.geometry.boundingBox!.getSize(new THREE.Vector3());
    expect(size.x).toBeCloseTo(8, 6); expect(size.y).toBeCloseTo(3.7, 6); expect(size.z).toBeCloseTo(0.26, 6);
    const ray = new THREE.Raycaster(new THREE.Vector3(-1,1, -0.4), new THREE.Vector3(1,0,0));
    scene.updateMatrixWorld(true);
    expect(ray.intersectObject(wall)).toHaveLength(0); // true door hole
    ray.set(new THREE.Vector3(-1,1,-3),new THREE.Vector3(1,0,0));
    expect(ray.intersectObject(wall).length).toBeGreaterThan(0);
  });
  it('uses window sill clearance, rotated columns and polygon bounds for collisions', () => {
    const layout=backendSceneToLayout(measured()), item=layout.floors[0].items[0];
    item.position={x:0,z:2}; item.width=0.8; item.depth=0.4; item.rotation=0;
    expect(structuralItemCollides(item,layout)).toBe(true); // below window, not gap
    item.elevation=1.3; item.height=0.5;
    expect(structuralItemCollides(item,layout)).toBe(false);
    item.elevation=0;item.position={x:3,z:1};
    expect(structuralItemCollides(item,layout)).toBe(true);
    item.position={x:-4,z:3};
    expect(structuralItemCollides(item,layout)).toBe(true);
    expect(layoutGeometryScene(layout).structure.openings).toHaveLength(2);
  });
  it('prevents a legacy rectangle resize from desynchronizing measured structure', () => {
    const state={layout:backendSceneToLayout(measured()),activeFloorIndex:0};
    expect(layoutReducer(state,{type:'setWidth',width:12})).toBe(state);
  });
  it('explicitly upgrades a measured empty rectangle to v2 without inventing model assets', () => {
    const base=backendSceneToLayout({schemaVersion:1,venue:{shape:'rectangle',width:10,depth:8,height:3,entrances:[]},objects:[],camera:'top',lighting:'neutral'});
    const upgraded=createMeasuredRoomLayout(base,{width:12,depth:9,height:4});
    expect(layoutToBackendScene(upgraded).schemaVersion).toBe(2);
    expect(upgraded.backendSceneV2?.structure.walls).toHaveLength(4);
    expect(upgraded.backendSceneV2?.dimensions.every(d=>d.status==='confirmed')).toBe(true);
  });
});

describe('atomic structural placement guard', () => {
  const item=makeItem({id:'chair',width:1,depth:1,height:1,position:{x:-2,z:0},locked:false});
  function state(){return {layout:makeLayout({width:10,height:8,floors:[makeFloor({items:[item],interiorWalls:[{id:'wall',x1:0,z1:-4,x2:0,z2:4}]})]}),activeFloorIndex:0};}
  it.each([
    {type:'moveItem',id:'chair',x:0,z:0},
    {type:'updateItem',id:'chair',patch:{position:{x:0,z:0}}},
    {type:'resizeItem',id:'chair',dimension:'width',value:5},
    {type:'bulkSetPositions',positions:new Map([['chair',{x:0,z:0}]])},
    {type:'replaceItems',items:[{...item,position:{x:0,z:0}}]},
    {type:'addItems',items:[{...item,id:'new',position:{x:0,z:0}}]},
  ] as LayoutAction[])('rejects $type without an undo state', action => { const before=state();expect(layoutReducer(before,action)).toBe(before); });
  it('allows relocation to another room and gradual repair but forbids worsening old overlap', () => {
    let before=state();
    const next=layoutReducer(before,{type:'moveItem',id:'chair',x:2,z:0});
    expect(next.layout.floors[0].items[0].position!.x).toBe(2);
    before=state(); before.layout.floors[0].items=[{...item,position:{x:0.2,z:0}}];
    expect(layoutReducer(before,{type:'moveItem',id:'chair',x:0,z:0})).toBe(before);
    expect(layoutReducer(before,{type:'moveItem',id:'chair',x:0.4,z:0})).not.toBe(before);
  });
  it('rejects the entire group when one member enters a wall',()=>{
    const before=state();before.layout.floors[0].items.push({...item,id:'other',position:{x:2,z:0}});
    expect(layoutReducer(before,{type:'bulkSetPositions',positions:new Map([['chair',{x:-1,z:0}],['other',{x:0,z:0}]])})).toBe(before);
  });
});
