const test=require('node:test');
const assert=require('node:assert/strict');
const {classifyQuestion}=require('./verify-30-shared-workbench.cjs');

test('only confirms a card whose every listed fact agrees with the fictional request',()=>{
 assert.deepEqual(classifyQuestion('以下信息还需核对：人数 30、室内外 室内、场地长（米） 10、场地宽（米） 8、布置方式 课桌椅。这样对吗？回复「确认」或「不对」。').kind,'reply');
 assert.equal(classifyQuestion('以下信息还需核对：人数 2。这样对吗？回复「确认」或「不对」。').kind,'fact_mismatch');
 assert.equal(classifyQuestion('以下信息还需核对：人数 30、活动 沙龙。这样对吗？回复「确认」或「不对」。').kind,'fact_mismatch');
 assert.equal(classifyQuestion('以下信息还需核对：人数 30、面积（平方米） 80。这样对吗？回复「确认」或「不对」。').kind,'needs_clarification');
 assert.equal(classifyQuestion('以下信息还需核对：人数 30、人数 30。这样对吗？回复「确认」或「不对」。').kind,'needs_clarification');
});
test('restates only known sample facts and does not invent an answer to other needs',()=>{
 const answer=classifyQuestion('刚才的本场人数、场地长宽（单位：米）无法确定，请重新说明；回复「确认」不能代替具体信息。');
 assert.equal(answer.kind,'reply');assert.match(answer.reply,/30人/);assert.match(answer.reply,/10米宽8米/);
 assert.equal(classifyQuestion('刚才的本场人数、时段（小时）无法确定，请重新说明；回复「确认」不能代替具体信息。').kind,'needs_clarification');
 assert.equal(classifyQuestion('是否需要签到？').kind,'needs_clarification');
 assert.equal(classifyQuestion('请先说明本场预计人数，再生成布置方案。').reply,'本场总人数30人');
 assert.equal(classifyQuestion('每桌安排多少人？').reply,'每2人一桌');
 assert.equal(classifyQuestion('我正在读取当前场地。').kind,'none');
});
