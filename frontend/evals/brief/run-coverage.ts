import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { evaluateRequirementCoverage, type CoverageCase } from './coverage-evaluator';

const readJson = async (path: string): Promise<unknown> => JSON.parse((await readFile(resolve(path), 'utf8')).replace(/^\uFEFF/, ''));
async function main() {
  const cases = await readJson('frontend/evals/brief/coverage-cases.json') as CoverageCase[];
  const suppliedPath = process.env.BRIEF_COVERAGE_RESPONSES?.trim();
  const input = await readJson(suppliedPath || 'frontend/evals/brief/coverage-synthetic-responses.json');
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('输出文件须是以案例编号为键的 JSON 对象。');
  const responses = input as Record<string, unknown>;
  const results = cases.map(item => evaluateRequirementCoverage(item, responses[item.id]));
  process.stdout.write(JSON.stringify({ mode: suppliedPath ? 'provided-responses' : 'synthetic-fixture',
    scope: '人工标注的虚构案例；不包含场景应用或现场验收', results }, null, 2) + '\n');
  if (results.some(item => item.extraction === 'invalid' || item.unlabeled.length > 0 || item.coverage.some(entry => entry.state === 'missing' || entry.state === 'contradicted'))) process.exitCode = 1;
}
main().catch(() => { process.stderr.write('覆盖评测未完成，请检查本机输入文件。\n'); process.exitCode = 2; });
