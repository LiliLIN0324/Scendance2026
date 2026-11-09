import {describe, expect, it} from 'vitest';
import {affectedVenueChecks, emptyVenueFacts, isVenueFactSet, updateVenueFact} from './venue-facts';

const at = {updatedBy:'策划',updatedAt:'2026-11-07T08:00:00Z',sourceRef:null,uncertainty:null} as const;
describe('venue fact sidecar',()=>{
  it('starts with every required fact unknown, including doors and capacity',()=>{
    const state=emptyVenueFacts('activity:hall');
    expect(Object.keys(state.facts)).toHaveLength(6);
    for(const fact of Object.values(state.facts))expect(fact).toMatchObject({value:null,source:'unavailable',status:'unknown',revision:0});
    expect(affectedVenueChecks(state,0)).toEqual([]);
  });
  it('records measured width with provenance, error and affected checks without mutating the old snapshot',()=>{
    const original=emptyVenueFacts('activity:hall');
    const next=updateVenueFact(original,'door_width',{...at,value:1.2,source:'site_measurement',sourceRef:'measurement-1',uncertainty:0.02,status:'confirmed'},0);
    expect(original.facts.door_width.value).toBeNull();
    expect(next.facts.door_width).toMatchObject({value:1.2,unit:'m',source:'site_measurement',status:'confirmed',uncertainty:0.02,revision:1});
    expect(affectedVenueChecks(next,0)).toEqual(expect.arrayContaining(['door_geometry','egress','fire','accessibility']));
  });
  it('does not permit a model guess to assert confirmation or a guessed value to hide as unknown',()=>{
    const base=emptyVenueFacts('activity:hall');
    expect(()=>updateVenueFact(base,'door_width',{...at,value:1.2,source:'model_inference',status:'confirmed'},0)).toThrow(/模型推测/);
    expect(()=>updateVenueFact(base,'door_width',{...at,value:1.2,source:'model_inference',status:'unknown'},0)).toThrow(/未知事实/);
    const inferred=updateVenueFact(base,'door_position',{...at,value:{x:3,z:-2},source:'model_inference',status:'inferred'},0);
    expect(inferred.facts.door_position).toMatchObject({value:{x:3,z:-2},unit:'m_point',status:'inferred'});
  });
  it('rejects invalid units through the fixed field mapping, bad measurements and missing capacity',()=>{
    const base=emptyVenueFacts('activity:hall');
    expect(()=>updateVenueFact(base,'approved_capacity',{...at,value:1.5,source:'user_statement',status:'pending'},0)).toThrow();
    expect(()=>updateVenueFact(base,'venue_width',{...at,value:NaN,source:'user_statement',status:'pending'},0)).toThrow();
    expect(()=>updateVenueFact(base,'door_opening_direction',{...at,value:'inward',source:'user_statement',status:'pending',uncertainty:1},0)).toThrow();
    expect(()=>updateVenueFact(base,'door_position',{...at,value:{x:0,z:Infinity},source:'venue_plan',status:'pending'},0)).toThrow();
  });
  it('uses monotonic revisions to reject stale edits, even after returning to the previous value',()=>{
    const base=emptyVenueFacts('activity:hall');
    const one=updateVenueFact(base,'venue_width',{...at,value:10,source:'user_statement',status:'confirmed'},0);
    const two=updateVenueFact(one,'venue_width',{...at,value:12,source:'user_statement',status:'confirmed'},1);
    const three=updateVenueFact(two,'venue_width',{...at,value:10,source:'user_statement',status:'confirmed'},2);
    expect(three.revision).toBe(3);expect(affectedVenueChecks(three,1)).toContain('layout');
    expect(()=>updateVenueFact(three,'venue_width',{...at,value:9,source:'user_statement',status:'confirmed'},1)).toThrow(/版本已变化/);
  });
  it('rejects corrupted deserialized facts instead of treating them as absent or allowing overwrite',()=>{
    const base=emptyVenueFacts('activity:hall');
    const malformed=structuredClone(base);
    malformed.facts.door_width.status='confirmed';
    expect(isVenueFactSet(malformed)).toBe(false);
    expect(()=>updateVenueFact(malformed,'venue_width',{...at,value:12,source:'user_statement',status:'pending'},0)).toThrow(/记录损坏/);
    const invalidEffects=structuredClone(base);
    invalidEffects.facts.door_width.affects=[];
    expect(isVenueFactSet(invalidEffects)).toBe(false);
  });
});
