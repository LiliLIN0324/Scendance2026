const {test}=require('node:test');
const assert=require('node:assert/strict');
const {safeDiagnostic}=require('./local-trial-diagnostic.cjs');

test('passes only allowed evidence category, field and count',()=>{
 const secret='FAKE_PRIVATE_INPUT_AND_MODEL_TEXT_571';
 const result=safeDiagnostic({code:'model_evidence_mismatch',evidence:{reason:'missing_evidence',field:'headcount',count:1,evidence:secret},message:secret});
 assert.deepEqual(result,{code:'model_evidence_mismatch',evidence:{reason:'missing_evidence',field:'headcount',count:1}});
 assert.ok(!JSON.stringify(result).includes(secret));
 for(const evidence of [{reason:secret,field:'headcount',count:1},{reason:'missing_evidence',field:secret,count:1},{reason:'missing_evidence',field:'headcount',count:13}]){
  assert.deepEqual(safeDiagnostic({code:'model_evidence_mismatch',evidence}),{code:'model_evidence_mismatch'});
 }
 assert.deepEqual(safeDiagnostic({code:'cancelled_or_upstream_timeout',abortSource:'caller_timeout',evidence:{reason:'missing_evidence',field:'headcount',count:1}}),{code:'cancelled_or_upstream_timeout',abortSource:'caller_timeout'});
});
test('filters schema issues to fixed codes and field paths',()=>{
 const secret='FAKE_PRIVATE_SCHEMA_VALUE_482';
 const schema={total:1,issues:[{code:'invalid_type',path:'extraction.headcount',message:secret,input:secret}]};
 assert.deepEqual(safeDiagnostic({code:'model_schema_invalid',schema,raw:secret}),{code:'model_schema_invalid',schema:{total:1,issues:[{code:'invalid_type',path:'extraction.headcount'}]}});
 for(const item of [{code:secret,path:'extraction.headcount'},{code:'invalid_type',path:secret}]){
  assert.deepEqual(safeDiagnostic({code:'model_schema_invalid',schema:{total:1,issues:[item]}}),{code:'model_schema_invalid'});
 }
 assert.deepEqual(safeDiagnostic({code:'model_schema_invalid',schema:{total:1,issues:Array(6).fill({code:'invalid_type',path:'$'})}}),{code:'model_schema_invalid'});
});
