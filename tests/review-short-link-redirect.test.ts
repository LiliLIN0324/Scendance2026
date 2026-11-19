import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Cloudflare Pages 的 `_redirects` 在真实站点上跑，`next dev` 的 rewrites 测不到。
 * 这里守住最关键的一条：短链必须原地返回评审页，地址里留着 /r/<code>。
 */

const rules = readFileSync(fileURLToPath(new URL('../frontend/public/_redirects', import.meta.url)), 'utf8')
  .split(/\r?\n/)
  .map(line => line.trim())
  .filter(line => line.length > 0 && !line.startsWith('#'))
  .map(line => line.split(/\s+/));

function ruleFor(source: string): string[] | undefined {
  return rules.find(([from]) => from === source);
}

describe('客户评审短链的 Pages 重写', () => {
  it('/r/:code 原地返回 200，且不能把 .html 当目标', () => {
    const rule = ruleFor('/r/:code');
    expect(rule).toBeDefined();
    const [, destination, status] = rule!;
    // Pages 会把 .html 目标 308 成无扩展名地址，短码和地址一起丢。
    expect(destination).not.toMatch(/\.html$/);
    expect(destination).toBe('/review');
    expect(status).toBe('200');
  });

  it('不保留指向已删除静态页的旧 /review/:id 重写', () => {
    // app/review/[id] 在 T4 合并时删除，local.html 从未在产物里，重写只会 404。
    expect(ruleFor('/review/:id')).toBeUndefined();
  });

  it('所有 200 重写的目标都不以 .html 结尾', () => {
    for (const [, destination, status] of rules) {
      if (status === '200') expect(destination).not.toMatch(/\.html$/);
    }
  });
});
