import { describe,it,expect } from 'vitest';
import { sceneSchema,sceneWarnings,sceneHash,canonical } from '../supabase/functions/_shared/domain.ts';
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
