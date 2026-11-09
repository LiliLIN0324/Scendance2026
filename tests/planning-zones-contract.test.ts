import {describe,expect,it} from 'vitest';
import {canonical,sceneHash,sceneSchema,sceneV1Schema,sceneV2Schema} from '../supabase/functions/_shared/domain.ts';
import {candidateWithPreservedUserZones,cloudZoneWriteMode,generatorZoneRefusal,modelPreservesPlanningZones,parsePlanningZonesCapability,planningZonesEditSchema,planningZonesWriteEnvelope,restoredPlanningZones,savedPlanningZoneFacts,softPlanningZoneConstraint} from '../supabase/functions/_shared/planning-zones-contract.ts';
import {scene} from './fixtures.ts';

const zone={id:'zone-1',name:'签到区',color:'#4A7C59',x:0,z:0,width:2,depth:1,zoneType:'checkin' as const,source:'unverified' as const};
const zones={version:1 as const,zones:[zone]};
describe('planning zones scene extension',()=>{
 it('does not inject any field or change old V1/V2 canonical bytes or hashes',async()=>{
  const old=scene(),old2=sceneV2Schema.parse({...old,schemaVersion:2,structure:{walls:[],openings:[],columns:[]},sources:[],dimensions:[]});
  for(const value of [old,old2]){
   const parsed=sceneSchema.parse(value);
   const before=canonical(value),after=canonical(parsed);
   expect(parsed).not.toHaveProperty('planningZones');
   expect(after).toBe(before);
   expect(after).not.toContain('planningZones');
   expect(new TextEncoder().encode(after)).toEqual(new TextEncoder().encode(before));
   expect(await sceneHash(parsed)).toBe(await sceneHash(value));
  }
 });
 it('accepts bounded V1/V2 rectangle geometry without inventing zone type or a confirmed source',()=>{
  const old=scene(),v1={...old,planningZones:zones},v2={...old,schemaVersion:2,structure:{walls:[],openings:[],columns:[]},sources:[],dimensions:[],planningZones:{version:1,zones:[{...zone,zoneType:undefined}]}};
  expect(sceneV1Schema.parse(v1).planningZones).toEqual(zones);
  const parsedZone=sceneV2Schema.parse(v2).planningZones?.zones[0];
  expect(parsedZone?.zoneType).toBeUndefined();
  expect(JSON.parse(JSON.stringify(parsedZone))).not.toHaveProperty('zoneType');
  expect(parsedZone?.source).toBe('unverified');
  expect(planningZonesEditSchema.parse({version:1,previous:null})).toEqual({version:1,previous:null});
 });
 it('rejects duplicates, invalid shapes, unsupported polygons and untrusted source',()=>{
  const base=scene(),tryZones=(value:unknown)=>sceneSchema.safeParse({...base,planningZones:value}).success;
  expect(tryZones({version:1,zones:[zone,zone]})).toBe(false);
  expect(tryZones({version:1,zones:[]})).toBe(false);
  expect(tryZones({version:1,zones:[{...zone,x:11,width:2}]})).toBe(false);
  expect(tryZones({version:1,zones:[{...zone,source:'confirmed'}]})).toBe(false);
  expect(tryZones({version:1,zones:[{...zone,extra:'unsupported'}]})).toBe(false);
  expect(tryZones({version:1,zones:Array.from({length:33},(_,i)=>({...zone,id:`z${i}`}))})).toBe(false);
  const polygon={...base,venue:{...base.venue,shape:'polygon',polygon:[{x:0,z:0},{x:12,z:0},{x:12,z:10},{x:0,z:10}]},planningZones:zones};
  expect(sceneSchema.safeParse(polygon).success).toBe(false);
 });
 it('requires 1e-9 metre precision on all four fields without false binary-float edge rejection',()=>{
  const base=scene();
  for(const field of ['x','z','width','depth'] as const){
   expect(sceneSchema.safeParse({...base,planningZones:{version:1,zones:[{...zone,[field]:0.0000000001}]}}).success).toBe(false);
  }
  const small={...base,venue:{...base.venue,width:.3,depth:1},planningZones:{version:1,zones:[{...zone,x:.1,z:0,width:.2,depth:1}]}};
  expect(sceneSchema.safeParse(small).success).toBe(true);
 });
 it('keeps activity zones as activity and leaves route width and fire egress unknown',()=>{
  const facts=savedPlanningZoneFacts({version:1,zones:[zone,{...zone,id:'keep',name:'消防通道示意',zoneType:'reserved'}]});
  expect(facts.scope).toMatchObject({geometry:'axis_aligned_rectangle',polygon:'not_covered',version:1});
  expect(facts.zones.map(item=>item.role)).toEqual(['activity','reserved_unverified']);
  expect(facts.zones.every(item=>item.source==='unverified')).toBe(true);
  expect(facts.routeWidth).toBe('unknown');
  expect(facts.fireEgress).toBe('unknown');
  expect(facts.confirmed).toBe(false);
  expect(modelPreservesPlanningZones(zones,zones)).toBe(true);
  expect(modelPreservesPlanningZones(zones,{...zones,zones:[{...zone,name:'被模型改名'}]})).toBe(false);
  expect(modelPreservesPlanningZones(zones,undefined)).toBe(false);
  const restored=restoredPlanningZones({planningZones:zones});
  expect(restored).toEqual(zones);
  expect(restored?.zones[0]?.source).toBe('unverified');
  expect(savedPlanningZoneFacts(restored).routeWidth).toBe('unknown');
  expect(savedPlanningZoneFacts(restored).fireEgress).toBe('unknown');
  expect(generatorZoneRefusal({planningZones:zones})).toMatchObject({code:'PLANNING_ZONES_GENERATION_UNAVAILABLE'});
  expect(generatorZoneRefusal({planningZones:zones})?.message).toContain('不会交给模型改写');
  expect(generatorZoneRefusal(scene())).toBeNull();
  const mixed={version:1 as const,zones:[zone,{...zone,id:'keep',name:'预留',zoneType:'reserved' as const}]};
  const soft=softPlanningZoneConstraint({planningZones:mixed});
  expect(soft.enforcement).toBe('soft');
  expect(soft.rewriteUserZones).toBe(false);
  expect(soft.polygon).toBe('not_covered');
  expect(soft.zones.map(item=>item.hint)).toEqual(['activity','unverified_reserved']);
  expect(soft.zones.every(item=>item.keepOut===false&&item.source==='unverified')).toBe(true);
  expect(soft.routeWidth).toBe('unknown');
  expect(soft.fireEgress).toBe('unknown');
  const base=scene();
  const user={...base,planningZones:zones};
  const rewritten={...user,lighting:'warm' as const,planningZones:{version:1 as const,zones:[{...zone,name:'模型改名',source:'unverified' as const}]}};
  const kept=candidateWithPreservedUserZones(user,rewritten);
  expect(kept.lighting).toBe('warm');
  expect(kept.planningZones).toEqual(zones);
  const invented=candidateWithPreservedUserZones(base,{...base,planningZones:zones});
  expect(invented).not.toHaveProperty('planningZones');
  expect(candidateWithPreservedUserZones(user,user)).toBe(user);
 });
 it('attaches the server previous value and treats an inexact capability as unsupported',()=>{
  expect(parsePlanningZonesCapability({supported:true,version:1})).toEqual({supported:true,version:1});
  for(const raw of [undefined,{supported:false},{supported:true},{supported:true,version:1,confirmed:true},{supported:true,version:2}]){
   expect(parsePlanningZonesCapability(raw)).toEqual({supported:false});
  }
  expect(cloudZoneWriteMode(false,{supported:false})).toBe('omit');
  expect(cloudZoneWriteMode(true,{supported:false})).toBe('blocked');
  expect(cloudZoneWriteMode(true,{supported:true,version:1})).toBe('rectangle-v1');
  expect(planningZonesWriteEnvelope(scene(),scene(),{supported:false})).toEqual({});
  expect(planningZonesWriteEnvelope({planningZones:zones},{planningZones:zones},{supported:true,version:1}).planningZonesEdit).toEqual({version:1,previous:zones});
  expect(()=>planningZonesWriteEnvelope({planningZones:zones},scene(),{supported:false})).toThrow('PLANNING_ZONES_UNAVAILABLE');
 });
});
