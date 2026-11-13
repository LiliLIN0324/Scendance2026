import { describe, expect, it } from 'vitest';
import { resolveCommonCapability } from './agent-common-capabilities';
import { STYLE_CAPABILITY_PREFILL, listStyleBundles } from './style-bundles';
import { proposeOutdoorStyle } from './outdoor-style-preview';
import { createStarterOutdoorPlan } from './outdoor-project-store';
import { buildOutdoorPlanDraft } from './outdoor-plan-handoff';
import { emptyOutdoorFlow } from './outdoor-agent-contract';
describe('registered common capability boundary',()=>{
 it('handles the exact public prefill through the same registered matcher',()=>{
  expect(resolveCommonCapability(STYLE_CAPABILITY_PREFILL)).toMatchObject({handled:true,id:'style',selection:'open'});
  expect(resolveCommonCapability('导出给搭建方')).toEqual({handled:true,id:'export'});
 });
 it.each(['按风格配一套，舞台不要挡入口','导出给搭建方，门必须保持打开','不要导出','能否导出？','按风格配一套，100人'])('does not swallow mixed/negative/question intent: %s',text=>{
  expect(resolveCommonCapability(text)).toEqual({handled:false});
 });
 it('palette never invents stock or a placement on an empty plan',()=>{
  expect(()=>proposeOutdoorStyle(createStarterOutdoorPlan(),listStyleBundles()[0]!)).toThrow('真实物料');
 });
 it('local handoff is an independent current-plan draft, not a safety claim or a shared scene',()=>{
  const plan=createStarterOutdoorPlan();plan.boundary=[{x:0,y:0},{x:80,y:0},{x:80,y:70},{x:0,y:70}];const context={brief:emptyOutdoorFlow('p').brief,requirements:['门必须现场核对']};
  const draft=buildOutdoorPlanDraft(plan,'p',context);expect(draft.plan).toEqual(plan);expect(draft.projectId).toBe('p');expect(draft.kind).toBe('scendance-outdoor-plan-draft');expect(draft.limitations.join('')).toContain('未提供安全');
  context.requirements.push('新要求');const originalX=plan.boundary[0]!.x;plan.boundary[0]!.x+=10;expect(draft.requirements).toEqual(['门必须现场核对']);expect(draft.plan.boundary[0]!.x).toBe(originalX);
 });
});
