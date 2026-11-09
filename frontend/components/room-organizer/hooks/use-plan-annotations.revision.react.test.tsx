// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { StrictMode } from 'react';
import { describe, expect, it } from 'vitest';
import { usePlanAnnotations } from './use-plan-annotations';

describe('use-plan-annotations — 结论失效计数器 revision', () => {
  it('保留旧标注后继续绘制，同批操作不会复用标注编号', () => {
    const { result } = renderHook(() => usePlanAnnotations());
    act(() => result.current.replaceDraft({ id: 'draft', createdAt: 0,
      stages: [{ stageNo: 1, title: '保留', rationale: '', annotationIds: ['ann-5'] }],
      annotations: [{ id: 'ann-5', kind: 'measure', label: '原测距', stageNo: 1,
        geometry: { kind: 'measure', from: { x: 0, z: 0 }, to: { x: 1, z: 1 } } }] }));
    act(() => {
      result.current.addAnnotationFromPoints([{ x: 0, z: 0 }, { x: 2, z: 2 }], 'measure', '新测距一');
      result.current.addAnnotationFromPoints([{ x: 0, z: 0 }, { x: 3, z: 3 }], 'measure', '新测距二');
    });
    expect(result.current.annotations.map(a => a.id)).toEqual(['ann-5', 'ann-6', 'ann-7']);
  });
  it('初始 revision 为 0，draft 为 null', () => {
    const { result } = renderHook(() => usePlanAnnotations());
    expect(result.current.revision).toBe(0);
    expect(result.current.draft).toBeNull();
  });

  it('startDraft / addZoneRects / addAnnotationFromPoints 都 bump revision', () => {
    const { result } = renderHook(() => usePlanAnnotations());
    const r0 = result.current.revision;

    act(() => result.current.startDraft());
    expect(result.current.revision).toBe(r0 + 1);

    const r1 = result.current.revision;
    act(() =>
      result.current.addZoneRects([
        {
          zoneType: 'checkin',
          label: '签到区',
          rect: { x: 0, z: 3, width: 3, depth: 2 },
        },
        {
          zoneType: 'rest',
          label: '休息区',
          rect: { x: 0, z: -3, width: 4, depth: 3 },
        },
      ]),
    );
    expect(result.current.revision).toBe(r1 + 1);
    expect(result.current.annotations).toHaveLength(2);

    const r2 = result.current.revision;
    act(() =>
      result.current.addAnnotationFromPoints(
        [{ x: -1, z: -1 }, { x: 1, z: 1 }],
        'measure',
        '测距',
      ),
    );
    expect(result.current.revision).toBe(r2 + 1);
    expect(result.current.annotations).toHaveLength(3);
  });

  it('TOGGLE_VISIBLE / SET_DRAW_MODE 是 UI 偏好，不 bump revision', () => {
    const { result } = renderHook(() => usePlanAnnotations());
    act(() => result.current.startDraft());
    const r0 = result.current.revision;

    act(() => result.current.toggleVisible());
    expect(result.current.revision).toBe(r0);

    act(() => result.current.setDrawMode('zone'));
    expect(result.current.revision).toBe(r0);

    act(() => result.current.setDrawMode('off'));
    expect(result.current.revision).toBe(r0);
  });

  it('CLEAR_DRAFT 也 bump revision（旧标注结论一并失效）', () => {
    const { result } = renderHook(() => usePlanAnnotations());
    act(() => result.current.startDraft());
    act(() =>
      result.current.addZoneRects([
        { zoneType: 'checkin', label: '签到区', rect: { x: 0, z: 3, width: 3, depth: 2 } },
      ]),
    );
    const r0 = result.current.revision;

    act(() => result.current.clearDraft());
    expect(result.current.revision).toBe(r0 + 1);
    expect(result.current.draft).toBeNull();
  });
});


describe('同步草案快照与条件消费',()=>{
  it('仅将真实绘制且同步落入当前草案的路线记录为本页用户来源',()=>{
    const {result}=renderHook(()=>usePlanAnnotations(),{wrapper:StrictMode});let live=true;
    const points=[{x:0,z:0},{x:2,z:1}];
    act(()=>expect(result.current.addUserRouteFromPoints(points,'路线',{floorId:'floor-1',isCurrent:()=>live})).toBe(true));
    const snapshot=result.current.getSnapshot(),id=snapshot.draft!.annotations[0]!.id;
    expect(result.current.getUserRouteProvenance(id)).toEqual({source:'user',floorId:'floor-1',sourceBasis:'unknown'});
    points[0]!.x=99;expect(result.current.getSnapshot().draft!.annotations[0]!.geometry).toMatchObject({points:[{x:0,z:0},{x:2,z:1}]});
    live=false;expect(result.current.getUserRouteProvenance(id)).toBeNull();
  });
  it('导入或替换草案即使伪造用户字段也不能恢复来源；普通添加同样无来源',()=>{
    const {result}=renderHook(()=>usePlanAnnotations());
    act(()=>result.current.addUserRouteFromPoints([{x:0,z:0},{x:1,z:1}],'路线',{floorId:'floor',isCurrent:()=>true}));
    const draft=result.current.getSnapshot().draft!,id=draft.annotations[0]!.id;
    act(()=>result.current.replaceDraft(draft));expect(result.current.getUserRouteProvenance(id)).toBeNull();
    act(()=>result.current.addAnnotationFromPoints([{x:0,z:0},{x:1,z:1}],'route','外来路线'));
    expect(result.current.getUserRouteProvenance(result.current.getSnapshot().draft!.annotations.at(-1)!.id)).toBeNull();
  });
  it('无效或已过期的来源不会添加或冒充已确认路线',()=>{
    const {result}=renderHook(()=>usePlanAnnotations());
    act(()=>expect(result.current.addUserRouteFromPoints([{x:0,z:0},{x:1,z:1}],'路线',{floorId:'floor',isCurrent:()=>false})).toBe(false));
    expect(result.current.getSnapshot().draft).toBeNull();
    act(()=>expect(result.current.addUserRouteFromPoints([{x:0,z:0},{x:Number.NaN,z:1}],'路线',{floorId:'floor',isCurrent:()=>true})).toBe(false));
    expect(result.current.getSnapshot().draft).toBeNull();
  });
  it('记录后外部改变 binding 对象不会改写路线所属楼层',()=>{
    const {result}=renderHook(()=>usePlanAnnotations());const binding={floorId:'floor-a',isCurrent:()=>true};
    act(()=>expect(result.current.addUserRouteFromPoints([{x:0,z:0},{x:1,z:1}],'路线',binding)).toBe(true));
    const id=result.current.getSnapshot().draft!.annotations[0]!.id;binding.floorId='floor-b';
    expect(result.current.getUserRouteProvenance(id)?.floorId).toBe('floor-a');
  });
  it('同批次新增后，旧卡不能清除或替换新标注',()=>{
    const {result}=renderHook(()=>usePlanAnnotations());
    act(()=>result.current.addZoneRects([{zoneType:'checkin',label:'旧区',rect:{x:0,z:0,width:2,depth:2}}]));
    const reviewed=result.current.getSnapshot();expect(reviewed.draft?.annotations).toHaveLength(1);
    act(()=>{
      result.current.addAnnotationFromPoints([{x:0,z:0},{x:2,z:2}],'route','刚新增路线');
      const live=result.current.getSnapshot();
      expect(live.revision).toBe(reviewed.revision+1);expect(live.draft?.annotations).toHaveLength(2);
      expect(result.current.clearDraftIfRevision(reviewed.revision)).toBe(false);
      expect(result.current.replaceDraftIfRevision(reviewed.revision,reviewed.draft!)).toBe(false);
    });
    expect(result.current.draft?.annotations.map(item=>item.label)).toEqual(['旧区','刚新增路线']);
  });
  it('读到的快照是隔离副本，正确版本可以安全消费',()=>{
    const {result}=renderHook(()=>usePlanAnnotations());
    act(()=>result.current.addZoneRects([{zoneType:'rest',label:'休息',rect:{x:0,z:0,width:2,depth:2}}]));
    const snapshot=result.current.getSnapshot();snapshot.draft!.annotations[0]!.label='外部篡改';
    expect(result.current.getSnapshot().draft?.annotations[0]?.label).toBe('休息');
    act(()=>expect(result.current.clearDraftIfRevision(snapshot.revision)).toBe(true));
    expect(result.current.getSnapshot().draft).toBeNull();expect(result.current.clearDraftIfRevision(result.current.revision)).toBe(false);
  });
  it('同批多次操作与 StrictMode 下渲染结果遵循同步 reducer 顺序',()=>{
    const {result}=renderHook(()=>usePlanAnnotations(),{wrapper:StrictMode});
    act(()=>{
      result.current.addZoneRects([{zoneType:'checkin',label:'签到',rect:{x:0,z:0,width:2,depth:2}}]);
      result.current.addZoneRects([{zoneType:'rest',label:'休息',rect:{x:4,z:0,width:2,depth:2}}]);
      result.current.addAnnotationFromPoints([{x:0,z:0},{x:1,z:1}],'measure','测距');
      expect(result.current.getSnapshot().revision).toBe(3);
    });
    expect(result.current.revision).toBe(3);expect(result.current.annotations.map(item=>item.id)).toEqual(['ann-1','ann-2','ann-3']);
  });
  it('replaceDraft 保存独立副本，外部更改不会绕过 revision',()=>{
    const {result}=renderHook(()=>usePlanAnnotations());
    act(()=>result.current.addZoneRects([{zoneType:'rest',label:'原区',rect:{x:0,z:0,width:2,depth:2}}]));
    const next=result.current.getSnapshot().draft!;
    act(()=>result.current.replaceDraft(next));const revision=result.current.revision;
    next.annotations[0]!.label='外部更改';expect(result.current.getSnapshot().draft?.annotations[0]?.label).toBe('原区');
    expect(result.current.getSnapshot().revision).toBe(revision);
  });
});

describe('use-plan-annotations — addDoorAnnotation（门位置标注）', () => {
  it('未给出的宽度和开向保持待核验，且 bump revision', () => {
    const { result } = renderHook(() => usePlanAnnotations());
    act(() => result.current.startDraft());
    const r0 = result.current.revision;

    act(() => result.current.addDoorAnnotation({ wall: 'east', position: 1.5 }));
    expect(result.current.revision).toBe(r0 + 1);
    expect(result.current.annotations).toHaveLength(1);
    const door = result.current.annotations[0]!;
    expect(door.kind).toBe('door');
    expect(door.geometry).toEqual({ kind: 'door', wall: 'east', position: 1.5, widthM: null, inferred: true });
  });

  it('没有 draft 时也能直接落（reducer 自动补空草案，同 ADD_ANNOTATION 语义）', () => {
    const { result } = renderHook(() => usePlanAnnotations());
    expect(result.current.draft).toBeNull();
    act(() => result.current.addDoorAnnotation({ wall: 'south', position: -2 }));
    expect(result.current.draft).not.toBeNull();
    expect(result.current.annotations).toHaveLength(1);
    expect(result.current.annotations[0]!.geometry).toMatchObject({ kind: 'door', wall: 'south', position: -2 });
  });

  it('记录用户输入的宽度，但不把门及开向当作现场已确认', () => {
    const { result } = renderHook(() => usePlanAnnotations());
    act(() => result.current.addDoorAnnotation({ wall: 'north', position: 0, widthM: 1.5 }));
    expect(result.current.annotations[0]!.geometry).toMatchObject({ kind: 'door', widthM: 1.5, inferred: true });
  });

  it('同批次绘制两扇门时使用不同 ID，非法宽度不被采纳', () => {
    const { result } = renderHook(() => usePlanAnnotations());
    act(() => {
      result.current.addDoorAnnotation({ wall: 'north', position: 0, widthM: NaN });
      result.current.addDoorAnnotation({ wall: 'south', position: 1 });
    });
    expect(result.current.annotations.map((item) => item.id)).toEqual(['ann-1', 'ann-2']);
    expect(result.current.annotations[0]!.geometry).toMatchObject({ widthM: null, inferred: true });
  });
});
