import { expect, it } from 'vitest';
import { INITIAL_LAYOUT } from '../components/room-organizer/lib/initial-layout';
import { backendSceneToLayout, layoutToBackendScene } from '../components/room-organizer/lib/backend-adapter';
import { planSharedDesks } from '../../supabase/functions/_shared/agent-shared-seating-layout';
import { collectViolations, itemCorners } from './placement-rules';
import { footprint, footprintsIntersect } from '../../supabase/functions/_shared/structural-geometry';
import { reviewAgentCandidate } from '../../supabase/functions/_shared/agent-candidate-review';
import { applyLayoutCommand, applyLayoutCommandWithRefusals, completeLayoutError } from './build-command';

it('reviews the synthetic shared seating fixture using frontend geometry', () => {
  const base = layoutToBackendScene(INITIAL_LAYOUT);
  const planned = planSharedDesks(base, {layout:'two_people_per_desk',count:30,deskSize:{width:1.2,depth:0.6,height:0.75},chairSize:{width:0.45,depth:0.45,height:0.85},chairGap:0.1,deskChairGap:0.1,columnGap:0.3,rowGap:0.5,edgeClearance:0.3}, i => `b0000000-0000-4000-8000-${String(i).padStart(12,'0')}`);
  const items=backendSceneToLayout(planned.scene).floors[0]!.items;
  const violations=collectViolations(backendSceneToLayout(planned.scene)).filter(v=>v.code==='BBOX_OVERLAP');
  expect(items).toHaveLength(50);
  expect(planned.placedPeople).toBe(30);
  expect(reviewAgentCandidate(base,planned.scene,[],true).status).not.toBe('violated');
  expect(violations).toEqual([]);
  const result=applyLayoutCommandWithRefusals(applyLayoutCommand({layout:backendSceneToLayout(planned.scene)}),{layout:INITIAL_LAYOUT});
  expect(completeLayoutError(result)).toBeNull();
});

it('distinguishes contact, numerical noise, and physical penetration', () => {
  const original=INITIAL_LAYOUT.floors[0]!.items[0]!;
  const check=(delta:number)=>{
    const second={...original,id:'new',position:{x:original.position!.x-1.2+delta,z:original.position!.z-0.1}};
    return collectViolations({...INITIAL_LAYOUT,floors:[{...INITIAL_LAYOUT.floors[0]!,items:[original,second]}]}).some(v=>v.code==='BBOX_OVERLAP');
  };
  expect(check(0)).toBe(false);
  expect(check(1e-10)).toBe(false);
  expect(check(1e-6)).toBe(true);
  expect(check(0.01)).toBe(true);
});

it('matches the backend footprint for a rotated object', () => {
  const base=layoutToBackendScene(INITIAL_LAYOUT);
  base.objects[0]!.rotation=30;
  const object=base.objects[0]!;
  const item=backendSceneToLayout(base).floors[0]!.items.find(i=>i.id===object.id)!;
  const actual=itemCorners(item), expected=footprint(object);
  actual.forEach((p,index)=>{
    expect(p.x+base.venue.width/2).toBeCloseTo(expected[index]!.x,10);
    expect(p.z+base.venue.depth/2).toBeCloseTo(expected[index]!.z,10);
  });
});

it('detects real collision at 45 degrees and does not mirror it to the other side', () => {
  const scene=layoutToBackendScene(INITIAL_LAYOUT);
  const table={...scene.objects[0]!,position:{x:5,z:4},rotation:45,size:{width:2,depth:0.2,height:0.75}};
  const chair={...scene.objects[2]!,position:{x:5.5,z:4.5},rotation:0,size:{width:0.15,depth:0.15,height:0.85}};
  for (const [z,expected] of [[4.5,true],[3.5,false]] as const) {
    const other={...chair,position:{...chair.position,z}};
    expect(footprintsIntersect(footprint(table),footprint(other))).toBe(expected);
    const layout=backendSceneToLayout({...scene,objects:[table,other]});
    expect(collectViolations(layout).some(v=>v.code==='BBOX_OVERLAP')).toBe(expected);
  }
});
