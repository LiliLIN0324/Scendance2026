// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { generateScoredPlans } from '../../../lib/plan-scoring';
import type { LayoutPlanDraft, PlanAnnotation } from '../../../lib/plan-annotation';
import { PlanCard } from './plan-card';
import { buildVenueShell } from '../lib/venue-shell';
import { makeFloor, makeLayout } from '../lib/__testfixtures__/fixtures';
import { extractPlanSizeFacts } from '../../../lib/plan-size-facts';

afterEach(cleanup);

it('uses the supplied door rather than inventing a default door', () => {
  const zone: PlanAnnotation = { id: 'zone', kind: 'zone', label: '座席区', stageNo: 1,
    zoneType: 'desk', geometry: { kind: 'rect', x: -4, z: -3, width: 8, depth: 6 } };
  const door: PlanAnnotation = { id: 'east-door', kind: 'door', label: '东门', stageNo: 1,
    geometry: { kind: 'door', wall: 'east', position: 0, widthM: 1.2 } };
  const plans = generateScoredPlans([zone, door], { roomSize: { width: 12, height: 10 } });
  expect(plans.length).toBeGreaterThan(0);
  for (const plan of plans) {
    expect(plan.violations.some((v) => v.zoneId === 'east-door' && v.status === 'unknown')).toBe(true);
    expect(plan.violations.some((v) => v.code === 'DOOR_UNKNOWN')).toBe(false);
  }
});

it('blocks applying a selected conflicting plan and permits a feasible selection', () => {
  const zone: PlanAnnotation = { id: 'zone', kind: 'zone', label: '座席区', stageNo: 1,
    zoneType: 'desk', geometry: { kind: 'rect', x: -4, z: -3, width: 8, depth: 6 } };
  const draft: LayoutPlanDraft = { id: 'draft', stages: [], annotations: [zone], createdAt: 0 };
  const base = generateScoredPlans([zone], { roomSize: { width: 12, height: 10 } })[0]!;
  const bad = { ...base, variantId: 'dense' as const, feasible: false };
  const good = { ...base, variantId: 'balanced' as const, feasible: true };
  const onApprove = vi.fn();
  const props = { draft, plans: [bad, good], onApprove, onReplace: vi.fn(), onCancel: vi.fn(), onComment: vi.fn() };
  const view = render(<PlanCard {...props} selectedId="dense" />);
  const button = screen.getByRole('button', { name: '应用布置' }) as HTMLButtonElement;
  expect(button.disabled).toBe(true);
  fireEvent.click(button);
  expect(onApprove).not.toHaveBeenCalled();
  view.rerender(<PlanCard {...props} selectedId="balanced" />);
  expect(button.disabled).toBe(false);
  fireEvent.click(button);
  expect(onApprove).toHaveBeenCalledOnce();
  view.rerender(<PlanCard {...props} />);
  expect(button.disabled).toBe(true);
});

it('shows the furniture belonging to the selected candidate, not a separate default layout', () => {
  const zone: PlanAnnotation = { id: 'zone', kind: 'zone', label: '课桌区', stageNo: 1,
    zoneType: 'desk', geometry: { kind: 'rect', x: -4, z: -3, width: 8, depth: 6 } };
  const draft: LayoutPlanDraft = { id: 'draft', stages: [{ stageNo: 1, title: '布置', rationale: '', annotationIds: ['zone'] }], annotations: [zone], createdAt: 0 };
  const base = generateScoredPlans([zone], { roomSize: { width: 12, height: 10 } })[0]!;
  const chair = base.placements.find(p => p.spec.type === 'desk-chair')!;
  expect(chair).toBeDefined();
  const one = { ...base, variantId: 'sparse' as const, placements: [chair], skipped: [] };
  const two = { ...base, variantId: 'balanced' as const, placements: [chair, { ...chair, x: chair.x + 1 }], skipped: [] };
  const props = { draft, plans: [one, two], onApprove: vi.fn(), onReplace: vi.fn(), onCancel: vi.fn(), onComment: vi.fn() };
  const view = render(<PlanCard {...props} selectedId="sparse" />);
  expect(screen.getByText(/课桌区 → 讲座椅×1/)).toBeTruthy();
  view.rerender(<PlanCard {...props} selectedId="balanced" />);
  expect(screen.getByText(/课桌区 → 讲座椅×2/)).toBeTruthy();
});

it('keeps empty or partial candidates diagnostic-only and explains skipped items', () => {
  const zone: PlanAnnotation = { id: 'zone', kind: 'zone', label: '签到区', stageNo: 1,
    zoneType: 'checkin', geometry: { kind: 'rect', x: -2, z: -2, width: 4, depth: 3 } };
  const draft: LayoutPlanDraft = { id:'draft', createdAt:0, stages:[{stageNo:1,title:'布置',rationale:'',annotationIds:['zone']}], annotations:[zone] };
  const base=generateScoredPlans([zone],{roomSize:{width:12,height:10}})[0]!;
  const empty={...base,variantId:'sparse' as const,placements:[],skipped:[],feasible:true};
  const partial={...base,variantId:'balanced' as const,feasible:true,
    skipped:[{zoneId:'zone',label:'签到区',reason:'空间不足'}]};
  const props={draft,plans:[empty,partial],recommendedId:'balanced' as const,onApprove:vi.fn(),onReplace:vi.fn(),onCancel:vi.fn(),onComment:vi.fn()};
  const view=render(<PlanCard {...props} selectedId="balanced"/>);
  expect(screen.queryByText(/✅ 推荐/)).toBeNull();
  expect(screen.getByText(/未能放入「签到区」：空间不足/)).toBeTruthy();
  expect(screen.getByText(/这不代表场地无解/)).toBeTruthy();
  const button=screen.getByRole('button',{name:'应用布置'}) as HTMLButtonElement;
  expect(button.disabled).toBe(true);fireEvent.click(button);expect(props.onApprove).not.toHaveBeenCalled();
  view.rerender(<PlanCard {...props} selectedId="sparse"/>);
  expect(button.disabled).toBe(true);expect(screen.getByText(/这版没有生成物料/)).toBeTruthy();
});


it('shows the candidate-only inventory scope and unknown stock before applying', () => {
  const zone: PlanAnnotation = { id: 'zone', kind: 'zone', label: '课桌区', stageNo: 1,
    zoneType: 'desk', geometry: { kind: 'rect', x: -4, z: -3, width: 8, depth: 6 } };
  const draft: LayoutPlanDraft = { id: 'draft', stages: [], annotations: [zone], createdAt: 0 };
  const plan = generateScoredPlans([zone], { roomSize: { width: 12, height: 10 } })[0]!;
  render(<PlanCard draft={draft} plans={[plan]} selectedId={plan.variantId} onApprove={vi.fn()} onReplace={vi.fn()} onCancel={vi.fn()} onComment={vi.fn()} />);
  expect(screen.getByText(/既有家具及其他楼层未计入/)).toBeTruthy();
  expect(screen.getByText(/讲座椅库存未知/)).toBeTruthy();
});

it('shows unknown activity needs and candidate checklist without claiming venue-wide safety',()=>{
  const zone:PlanAnnotation={id:'z',kind:'zone',label:'座席区',stageNo:1,zoneType:'desk',geometry:{kind:'rect',x:-4,z:-3,width:8,depth:6}};
  const draft:LayoutPlanDraft={id:'d',stages:[],annotations:[zone],createdAt:0};
  const plan=generateScoredPlans([zone],{roomSize:{width:12,height:10}})[0]!;
  const props={draft,plans:[plan],selectedId:plan.variantId,onApprove:vi.fn(),onReplace:vi.fn(),onCancel:vi.fn(),onComment:vi.fn()};
  const view=render(<PlanCard {...props}/>);
  expect(screen.getByText('尚未确认是否需要签到。')).toBeTruthy();
  expect(screen.getByText('尚未确认是否需要舞台。')).toBeTruthy();
  expect(screen.getByText(/不能作为全场安全或规范结论/)).toBeTruthy();
  view.rerender(<PlanCard {...props} functionalNeeds={{checkin:false,stage:null}}/>);
  expect(screen.queryByText('尚未确认是否需要签到。')).toBeNull();
  expect(screen.getByText('尚未确认是否需要舞台。')).toBeTruthy();
});


it('runs the candidate grid only for matching confirmed dimensions with linked sources',()=>{
  const zone:PlanAnnotation={id:'z',kind:'zone',label:'座席区',stageNo:1,zoneType:'desk',geometry:{kind:'rect',x:-4,z:-3,width:8,depth:6}};
  const draft:LayoutPlanDraft={id:'d',stages:[],annotations:[zone],createdAt:0};
  const plan=generateScoredPlans([zone],{roomSize:{width:12,height:9}})[0]!;
  const scene=buildVenueShell({widthM:12,depthM:9,indoorOutdoor:'indoor',scaleOrigin:'stated'});
  const assetId=crypto.randomUUID();scene.sources=[{assetId,kind:'floorplan',name:'场地图纸',width:800,height:600}];
  scene.dimensions=scene.dimensions.map(d=>({...d,status:'confirmed',sourceAssetId:assetId}));
  const layout=makeLayout({width:12,height:9,floors:[makeFloor()],backendSceneV2:scene});
  const props={draft,plans:[plan],selectedId:plan.variantId,onApprove:vi.fn(),onReplace:vi.fn(),onCancel:vi.fn(),onComment:vi.fn()};
  const view=render(<PlanCard {...props} sizeFacts={extractPlanSizeFacts({...layout,backendSceneV2:{...scene,sources:[]}},0)}/>);
  expect(screen.getByText(/缺少有效场地尺寸，边界网格未运行/)).toBeTruthy();
  view.rerender(<PlanCard {...props} sizeFacts={extractPlanSizeFacts(layout,0)}/>);
  expect(screen.getByText(/边界网格采样不能代表真实入口和疏散路线/)).toBeTruthy();
  expect(screen.getByText(/0.3 米网格边界采样，未包含人体轮廓和转弯/)).toBeTruthy();
  view.rerender(<PlanCard {...props} sizeFacts={extractPlanSizeFacts({...layout,width:13},0)}/>);
  expect(screen.getByText(/缺少有效场地尺寸，边界网格未运行/)).toBeTruthy();
});
