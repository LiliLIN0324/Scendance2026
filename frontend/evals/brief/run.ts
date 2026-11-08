import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {evaluateBriefDataset,type BriefEvalCase} from './evaluator';

const readJson=async(path:string):Promise<unknown>=>JSON.parse((await readFile(resolve(path),'utf8')).replace(/^\uFEFF/,''));
async function main(){
 const cases=await readJson('frontend/evals/brief/cases.json') as BriefEvalCase[];
 const path=process.env.BRIEF_EVAL_RESPONSES?.trim()||'frontend/evals/brief/synthetic-responses.json';
 const responses=await readJson(path);
 if(!responses||typeof responses!=='object'||Array.isArray(responses))throw new Error('输出文件须是以样本 id 为键的 JSON 对象。');
 const report=await evaluateBriefDataset(cases,responses as Record<string,unknown>);
 process.stdout.write(JSON.stringify({mode:process.env.BRIEF_EVAL_RESPONSES?'provided-responses':'synthetic-fixture',...report},null,2)+'\n');
 if(report.failed||report.missing)process.exitCode=1;
}
main().catch(error=>{process.stderr.write(`评测未完成：${error instanceof Error?error.message:'未知错误'}\n`);process.exitCode=2;});
