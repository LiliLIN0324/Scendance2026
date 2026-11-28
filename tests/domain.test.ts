import { describe,it,expect } from 'vitest';
import { sceneSchema,sceneWarnings,sceneHash,canonical,sceneZoneSchema } from '../supabase/functions/_shared/domain.ts';
import { buildProposal } from '../supabase/functions/_shared/ai.ts';
import { scene,chair } from './fixtures.ts';

describe('scene and controlled AI operations',()=>{
  it('rejects duplicate IDs, unknown fields, non-finite sizes and over 50 objects',()=>{
    const s=scene(),o=chair();
    for(const invalid of [{...s,objects:[o,o]},{...s,secret:'bad'},{...s,objects:[{...o,size:{...o.size,width:NaN}}]},{...s,objects:Array.from({length:51},()=>chair())}]) expect(sceneSchema.safeParse(invalid).success).toBe(false);
  });
  it('rejects self-crossing polygons and entrances not on boundaries',()=>{
    const s=scene();s.venue={...s.venue,shape:'polygon',polygon:[{x:0,z:0},{x:10,z:10},{x:0,z:10},{x:10,z:0}]};expect(sceneSchema.safeParse(s).success).toBe(false);
    const r=scene();r.venue.entrances=[{id:crypto.randomUUID(),position:{x:5,z:5},width:1}];expect(sceneSchema.safeParse(r).success).toBe(false);
  });
  it('checks rotated footprints and concave boundary crossings',()=>{
    const s=scene();s.objects=[{...chair(),position:{x:0.1,z:1},rotation:45}];expect(sceneWarnings(s)[0].code).toBe('OUT_OF_BOUNDS');
    s.venue={...s.venue,shape:'polygon',polygon:[{x:0,z:0},{x:10,z:0},{x:10,z:10},{x:6,z:10},{x:6,z:4},{x:4,z:4},{x:4,z:10},{x:0,z:10}]};
    s.objects=[{...chair(),position:{x:5,z:5},size:{width:6,depth:4,height:1}}];expect(sceneWarnings(s).some(w=>w.code==='OUT_OF_BOUNDS')).toBe(true);
  });
  it('reports actual footprint overlap but allows carpets under furniture',()=>{
    const s=scene();s.objects=[chair(),chair()];expect(sceneWarnings(s).some(w=>w.code==='OVERLAP')).toBe(true);
    s.objects[0].materialId='carpet';expect(sceneWarnings(s).some(w=>w.code==='OVERLAP')).toBe(false);
  });
  it.each(['remove','move','rotate','recolor','replace'] as const)('rejects %s of locked object',op=>{
    const s=scene(),o={...chair(),locked:true};s.objects=[o];
    const args={remove:{},move:{position:{x:1,z:1}},rotate:{rotation:30},recolor:{color:'#ff0000'},replace:{materialId:'table'}}[op];
    expect(()=>buildProposal(s,'modify',{explanation:'change',commands:[{op,id:o.id,...args}]})).toThrow('OBJECT_LOCKED');
  });
  it('uses builtin layouts and rejects crowding without overwriting source',()=>{
    const s=scene();const result=buildProposal(s,'layout',{explanation:'Salon',template:'salon',attendees:20,palette:['#ABCDEF']});
    expect(result.scene.objects).toHaveLength(22);expect(s.objects).toHaveLength(0);expect(result.warnings.filter(w=>w.code==='OUT_OF_BOUNDS')).toHaveLength(0);
    s.venue.width=2;s.venue.depth=2;expect(()=>buildProposal(s,'layout',{explanation:'Crowd',template:'salon',attendees:40,palette:['#ffffff']})).toThrow('LAYOUT_DOES_NOT_FIT');
  });
  it('rejects unsupported commands and AI generated arbitrary assets',()=>{
    for(const command of [{op:'unlock',id:crypto.randomUUID()},{op:'add',materialId:'invented',position:{x:1,z:1},rotation:0,color:'#ffffff'}]) expect(()=>buildProposal(scene(),'modify',{explanation:'bad',commands:[command]})).toThrow();
  });
  it('hashes scene structure canonically so local changes can invalidate proposals',async()=>{
    const a=scene(),b=JSON.parse(JSON.stringify(a));expect(await sceneHash(a)).toBe(await sceneHash(b));
    b.lighting='warm';expect(await sceneHash(a)).not.toBe(await sceneHash(b));expect(canonical({b:1,a:2})).toBe(canonical({a:2,b:1}));
  });
});

describe('T-01 venue site contract',()=>{
  function v2(site?:object,heightSource?:string){
    const wall={id:crypto.randomUUID(),start:{x:0,z:0},end:{x:12,z:0},thickness:0.16,height:4,kind:'exterior' as const,status:'confirmed' as const};
    const opening={id:crypto.randomUUID(),wallId:wall.id,kind:'door' as const,offset:5,width:2,height:2.4,sillHeight:0,status:'inferred' as const};
    return sceneSchema.safeParse({schemaVersion:2,venue:{shape:'rectangle',width:12,depth:10,height:4,entrances:[],
      ...(heightSource?{heightSource}:{}),...(site?{site}:{})},
      structure:{walls:[wall],openings:[opening],columns:[]},sources:[],dimensions:[],objects:[],camera:'overview',lighting:'neutral'});
  }
  it('accepts heightSource and a site block whose mainEntrance points at a real opening',()=>{
    const openingId=v2().data&&(null);
    const wall={id:crypto.randomUUID(),start:{x:0,z:0},end:{x:12,z:0},thickness:0.16,height:4,kind:'exterior' as const,status:'confirmed' as const};
    const opening={id:crypto.randomUUID(),wallId:wall.id,kind:'door' as const,offset:5,width:2,height:2.4,sillHeight:0,status:'inferred' as const};
    const ok=sceneSchema.safeParse({schemaVersion:2,venue:{shape:'rectangle',width:12,depth:10,height:4,entrances:[],heightSource:'confirmed',
      site:{mainEntrance:{openingId:opening.id},scale:{confidence:'high'},indoorOutdoor:'indoor'}},
      structure:{walls:[wall],openings:[opening],columns:[]},sources:[],dimensions:[],objects:[],camera:'overview',lighting:'neutral'});
    expect(ok.success).toBe(true);
  });
  it('rejects a dangling mainEntrance openingId',()=>{
    const wall={id:crypto.randomUUID(),start:{x:0,z:0},end:{x:12,z:0},thickness:0.16,height:4,kind:'exterior' as const,status:'confirmed' as const};
    const opening={id:crypto.randomUUID(),wallId:wall.id,kind:'door' as const,offset:5,width:2,height:2.4,sillHeight:0,status:'inferred' as const};
    const bad=sceneSchema.safeParse({schemaVersion:2,venue:{shape:'rectangle',width:12,depth:10,height:4,entrances:[],
      site:{mainEntrance:{openingId:crypto.randomUUID()}}},
      structure:{walls:[wall],openings:[opening],columns:[]},sources:[],dimensions:[],objects:[],camera:'overview',lighting:'neutral'});
    expect(bad.success).toBe(false);
  });
  it('rejects site on V1 scenes and unknown heightSource values',()=>{
    const v1=sceneSchema.safeParse({...scene(),venue:{...scene().venue,site:{indoorOutdoor:'indoor'}}});
    expect(v1.success).toBe(false);
    expect(v2(undefined,'guessed').success).toBe(false);
  });
  it('keeps parsing legacy scenes that carry neither site nor heightSource',()=>{
    expect(sceneSchema.safeParse(scene()).success).toBe(true);
    expect(v2().success).toBe(true);
  });
});

describe('scene zone contract（矩形→多边形，旧矩形只读兼容）',()=>{
  const base={id:'zone-1',name:'休息区',color:'#4a7c59',zoneType:'rest' as const};
  it('旧矩形 x/z/w/d 照常解析（历史云端场景兼容，不回写）',()=>{
    const legacy=sceneZoneSchema.parse({...base,x:2,z:1,w:2.2,d:1.6});
    expect(legacy.polygon).toBeUndefined();
    expect(legacy.x).toBe(2);expect(legacy.w).toBe(2.2);
  });
  it('新多边形环往返逐点保留',()=>{
    const polygon=[{x:0,z:0},{x:4,z:0},{x:4,z:3},{x:0,z:3}];
    const parsed=sceneZoneSchema.parse({...base,polygon});
    expect(parsed.polygon).toEqual(polygon);
    expect(parsed.x).toBeUndefined();
  });
  it('拒收混装多边形与矩形',()=>{
    expect(sceneZoneSchema.safeParse({...base,polygon:[{x:0,z:0},{x:4,z:0},{x:0,z:4}],x:2,z:1,w:2,d:1}).success).toBe(false);
  });
  it('拒收两种几何都缺的分区',()=>{
    expect(sceneZoneSchema.safeParse({...base}).success).toBe(false);
  });
  it('拒收矩形缺字段、多边形不足三点、越界坐标',()=>{
    expect(sceneZoneSchema.safeParse({...base,x:2,z:1,w:2.2}).success).toBe(false);
    expect(sceneZoneSchema.safeParse({...base,polygon:[{x:0,z:0},{x:4,z:0}]}).success).toBe(false);
    expect(sceneZoneSchema.safeParse({...base,polygon:[{x:-300,z:0},{x:4,z:0},{x:0,z:4}]}).success).toBe(false);
  });
});
