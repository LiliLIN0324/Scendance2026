// @vitest-environment jsdom
import {act,renderHook} from '@testing-library/react';
import {describe,expect,it} from 'vitest';
import {usePlanAnnotations} from './use-plan-annotations';

describe('session-only annotation floor evidence',()=>{
  it('records only bound user drawings and invalidates on activity or floor transition',()=>{
    const {result}=renderHook(()=>usePlanAnnotations());let epoch=1,floor='floor-a';
    const binding={floorId:'floor-a',isCurrent:()=>epoch===1&&floor==='floor-a'};
    act(()=>{
      expect(result.current.addUserAnnotationFromPoints([{x:0,z:0},{x:2,z:2}],'zone','区',binding,'checkin')).toBe(true);
      expect(result.current.addUserAnnotationFromPoints([{x:0,z:0},{x:1,z:1}],'measure','测距',binding)).toBe(true);
      expect(result.current.addUserDoorAnnotation({wall:'north',position:0},binding)).toBe(true);
      expect(result.current.addUserRouteFromPoints([{x:0,z:0},{x:1,z:1}],'路线',binding)).toBe(true);
      result.current.addAnnotationFromPoints([{x:0,z:0},{x:1,z:1}],'measure','旧入口');
    });
    expect(['ann-1','ann-2','ann-3','ann-4'].map(id=>result.current.getUserAnnotationFloor(id))).toEqual(['floor-a','floor-a','floor-a','floor-a']);
    expect(result.current.getUserAnnotationFloor('ann-5')).toBeNull();
    floor='floor-b';epoch=2;expect(result.current.getUserAnnotationFloor('ann-1')).toBeNull();
    floor='floor-a';epoch=3;expect(result.current.getUserAnnotationFloor('ann-1')).toBeNull();
  });
  it('does not transfer evidence to imported, changed, cleared or replaced drafts',()=>{
    const {result}=renderHook(()=>usePlanAnnotations());const binding={floorId:'a',isCurrent:()=>true};
    act(()=>{result.current.addUserDoorAnnotation({wall:'north',position:0},binding);});
    const prior=result.current.getSnapshot().draft!;expect(result.current.getUserAnnotationFloor('ann-1')).toBe('a');
    act(()=>result.current.replaceDraft(prior));expect(result.current.getUserAnnotationFloor('ann-1')).toBeNull();
    act(()=>result.current.startDraft());expect(result.current.getUserAnnotationFloor('ann-1')).toBeNull();
  });
  it('does not record a drawing when its fence fails and never assumes batch zones are user drawn',()=>{
    const {result}=renderHook(()=>usePlanAnnotations());
    act(()=>{
      expect(result.current.addUserAnnotationFromPoints([{x:0,z:0},{x:1,z:1}],'zone','区',{floorId:'a',isCurrent:()=>true,isDrawingCurrent:()=>false})).toBe(false);
      result.current.addZoneRects([{zoneType:'rest',label:'休息',rect:{x:0,z:0,width:2,depth:2}}]);
    });
    expect(result.current.getUserAnnotationFloor('ann-1')).toBeNull();
  });
});
