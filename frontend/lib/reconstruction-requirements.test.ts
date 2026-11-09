import {describe,expect,it} from 'vitest';
import {markUnverifiedRequirements,verifyInventoryRequirements} from '../../supabase/functions/_shared/reconstruction';
import {backendSceneToLayout,createMeasuredRoomLayout,layoutToBackendScene} from '../components/room-organizer/lib/backend-adapter';
import {scene,chair} from '../../tests/fixtures';

function candidate(){
 const result=layoutToBackendScene(createMeasuredRoomLayout(backendSceneToLayout(scene()),{width:12,depth:10,height:3}));
 if(result.schemaVersion!==2)throw new Error('expected SceneV2');
 result.objects=[chair('座椅')];
 result.design={concept:'活动方案',palette:[],highlights:[],requirements:[
  {text:'消防已经验收',status:'satisfied',reason:'模型认为合格',objectIds:[]},
  {text:'无障碍通行符合要求',status:'satisfied',reason:'模型认为达标',objectIds:[]},
  {text:'其他事项',status:'unmet',reason:'模型认为缺失',objectIds:[]},
 ]};
 return result;
}
describe('重建要求的核验范围',()=>{
 it('recognizes every original status as an unverified opinion, without a keyword whitelist',()=>{
  const value=candidate();markUnverifiedRequirements(value);
  expect(value.design!.requirements.map(r=>r.status)).toEqual(['partial','partial','partial']);
  expect(value.design!.requirements[0]!.reason).toContain('未经独立核验');
  expect(value.design!.requirements[2]!.reason).toContain('不代表现场或规范验收');
 });
 it('only promotes the independently counted candidate inventory, with its scope explicit',()=>{
  const value=candidate();verifyInventoryRequirements(value,'安排1把椅子');
  expect(value.design!.requirements[0]).toMatchObject({status:'satisfied',reason:expect.stringContaining('仅核对场景物件数量')});
  expect(value.design!.requirements.slice(1).every(r=>r.status==='partial')).toBe(true);
  const missing=candidate();verifyInventoryRequirements(missing,'安排2把椅子');
  expect(missing.design!.requirements[0]).toMatchObject({status:'partial',reason:expect.stringContaining('场景内计数 1 个')});
 });
 it.each(['不要12把椅子','至少12把椅子','最多12把椅子','12把椅子或更多','不要安排1把椅子'])('does not turn %s into an exact positive count',instruction=>{
  const value=candidate();verifyInventoryRequirements(value,instruction);
  expect(value.design!.requirements.every(r=>r.status!=='satisfied')).toBe(true);
 });
 it('hides model safety approval assertions in all design narrative fields',()=>{
  const value=candidate();value.design!.concept='本方案已通过消防验收';
  value.design!.highlights=[{title:'无障碍符合规范',description:'疏散已达标',objectIds:[]}];
  markUnverifiedRequirements(value);
  expect(value.design!.concept).toBe('模型设计说明待人工核验。');
  expect(value.design!.highlights[0]).toMatchObject({title:'模型建议（待核验）',description:'模型建议未独立核验，请人工检查。'});
 });
});
