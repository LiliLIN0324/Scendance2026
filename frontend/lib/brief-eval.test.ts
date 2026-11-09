import {describe,expect,it} from 'vitest';
import {evaluateBriefCase,evaluateBriefDataset,type BriefEvalCase} from '../evals/brief/evaluator';
const test:BriefEvalCase={id:'case',message:'签到要不要还没定。',needs:{checkin:'unknown'},evidenceContains:{checkin:'还没定'},ask:true,review:'人工检查问题是否针对签到。'};
describe('brief evaluation contract',()=>{
 it('checks source text and uncertainty, and retains the question for human review',async()=>{
  const out=await evaluateBriefCase(test,{activityNeeds:[{kind:'checkin',decision:'unknown',evidence:'签到要不要还没定'}]});
  expect(out.status).toBe('pass');expect(out.questionForHumanReview).toBeTruthy();expect(out.manualReview).toContain('签到');
 });
 it('rejects fabricated evidence, cropped negation and conflicting decisions',async()=>{
  expect((await evaluateBriefCase(test,{activityNeeds:[{kind:'checkin',decision:'unknown',evidence:'不存在'}]})).status).toBe('fail');
  expect((await evaluateBriefCase(test,{activityNeeds:[{kind:'checkin',decision:'unknown',evidence:'签到'}]})).failures).toContain('需求 checkin 的证据缺少关键语境');
  expect((await evaluateBriefCase(test,{activityNeeds:[{kind:'checkin',decision:'needed',evidence:'签到要不要还没定'}]})).status).toBe('fail');
 });
 it('does not credit missing output as a pass and rejects invented count',async()=>{
  const noFact:BriefEvalCase={id:'missing',message:'活动待定。',omit:['headcount'],memoryAbsent:['headcount'],review:'人工核对。'};
  const empty=await evaluateBriefDataset([noFact],{});expect(empty.missing).toBe(1);expect(empty.passed).toBe(0);
  const fake=await evaluateBriefCase(noFact,{headcount:200});expect(fake.status).toBe('fail');
 });
 it('rejects duplicate needs rather than rewarding partial matches',async()=>{
  const item={kind:'checkin',decision:'unknown',evidence:'签到要不要还没定'};
  expect((await evaluateBriefCase(test,{activityNeeds:[item,item]})).failures).toContain('同一功能需求重复');
 });
});
