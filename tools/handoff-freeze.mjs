#!/usr/bin/env node
// handoff-freeze.mjs — 把 HANDOFF.md 冻结成可重算哈希的只读档案
// 来源：学自 mimi-agent v0.13.0 freeze-audit 的零写入哲学 + pstack show-me-your-work 的审计账本思路
// 用法：node tools/handoff-freeze.mjs [仓库根，默认 cwd]
// 原则：不写任何文件、不联网、不读密钥；输出只到 stdout；输入不真实就拒绝。
// 审计：对同一 HEAD 重跑本脚本，比对 handoff.sha256 与 head——不一致 = 冻结后交接文档被改动。
import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';

const rootArg = process.argv.slice(2).find((a) => !a.startsWith('--'));
const root = rootArg ? path.resolve(rootArg) : process.cwd();
const rel = 'HANDOFF.md';
const handoffPath = path.join(root, rel);
if (!existsSync(handoffPath)) {
  console.error('[handoff-freeze] 未找到 ' + handoffPath + ' —— 冻结拒绝进行（不猜测、不编造）。');
  process.exit(1);
}
const bytes = readFileSync(handoffPath);
const sha256 = createHash('sha256').update(bytes).digest('hex');
let head = null;
try {
  head = execSync('git rev-parse HEAD', { cwd: root, encoding: 'utf8' }).trim();
} catch {
  // 非 git 环境允许；head 为 null 并在输出中如实标注
}
const sections = [...bytes.toString('utf8').matchAll(/^##\s+(.+)$/gm)].map((m) => m[1].trim());
const archive = {
  schema: 'scendance-handoff-freeze/1',
  frozenAt: new Date().toISOString(),
  head,
  headKnown: head !== null,
  handoff: { path: rel, bytes: bytes.length, sha256, sections },
  note: '审计方式：对同一 HEAD 重跑本脚本比对 sha256 与 head；不一致 = 冻结后交接文档被改动。',
};
console.log(JSON.stringify(archive, null, 2));