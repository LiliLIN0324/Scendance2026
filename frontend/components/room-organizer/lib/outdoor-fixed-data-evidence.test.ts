import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  CASE_IDS,
  FIXED_DATA_CASES,
  FIXED_DATA_EVIDENCE,
} from './outdoor-release-status-card';

/**
 * 固定数据证据的“存在性”自检（轮次 103）。
 *
 * 轮次 102 把 `FIXED_DATA_CASES` 从写死两条改成“按实存测试文件算”，
 * 但表里的文件名仍是手写的：文件被改名、删掉、或写成不存在的名字（旧对照表就引过
 * `indoor-zone-door`，仓库里早没这个文件），卡片就会拿着假证据说“这条有固定数据”。
 *
 * 所以这里只干一件事：**表里点到的每个文件，必须真的在磁盘上。**
 * 不判断文件里测得好不好——那是人的事。
 */

const HERE = dirname(fileURLToPath(import.meta.url));

function testFileOf(name: string): string {
  return join(HERE, `${name}.test.ts`);
}

describe('固定数据证据的文件必须真的存在（轮次 103）', () => {
  it('表里每个文件名都对应一个真实测试文件', () => {
    const missing: string[] = [];
    for (const [id, files] of Object.entries(FIXED_DATA_EVIDENCE)) {
      for (const name of files) {
        if (!existsSync(testFileOf(name))) missing.push(`#${id} → ${name}.test.ts`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('用例号都在 11 条之内，且没有空证据', () => {
    for (const id of Object.keys(FIXED_DATA_EVIDENCE).map(Number)) {
      expect(CASE_IDS).toContain(id);
    }
    for (const files of Object.values(FIXED_DATA_EVIDENCE)) {
      expect(files.length).toBeGreaterThan(0);
    }
  });

  it('导出的用例号表与证据表一致（不许两处各写一份）', () => {
    const fromMap = Object.keys(FIXED_DATA_EVIDENCE)
      .map(Number)
      .sort((a, b) => a - b);
    expect(FIXED_DATA_CASES).toEqual(fromMap);
  });
});
