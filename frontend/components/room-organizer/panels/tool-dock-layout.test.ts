import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * 底栏工具岛（2026-11-23 审校）：
 * 1. 1280×800 下岛底 20px 会被 40px 的 MATERIALS 通栏压住一半，只剩箭头露头；抬到 52px。
 * 2. 收起时不再只留一颗箭头，改成「⌃ 工具」小胶囊。
 */
const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../../app/globals.css'), 'utf8')
  .replace(/\r\n/g, '\n');

function rule(selector: string, marker?: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const bodies = [...css.matchAll(new RegExp(`${escaped} \\{([^}]*)\\}`, 'g'))].map(match => match[1] ?? '');
  if (!marker) return bodies[0] ?? '';
  return bodies.find(body => body.includes(marker)) ?? '';
}

describe('底栏工具岛与 1280×800 通栏', () => {
  it('岛底高于 40px 的底栏，不再被 MATERIALS 通栏吃掉一半', () => {
    const dock = rule('.sc-workbench .sc-tool-column .oc-dock');
    const bottom = Number(dock.match(/bottom:\s*(\d+)px/)?.[1] ?? 0);
    expect(bottom).toBeGreaterThan(40);
  });

  it('收起态是带「工具」文字的小胶囊，不是单箭头', () => {
    const island = rule('.sc-workbench .sc-tool-column .oc-dock .oc-cluster.oc-bb.oc-island', 'max-width: 84px');
    expect(island).toContain('max-width: 84px');
    const label = rule('.sc-workbench .sc-tool-column .oc-cluster.oc-bb.oc-island .oc-island-label');
    expect(label).toContain('opacity: 1');
    expect(label).toContain('max-width: 40px');
  });

  it('展开后文字让位给工具行，避免和按钮抢宽度', () => {
    const openLabel = rule('.sc-workbench .sc-tool-column .oc-dock.is-open .oc-cluster.oc-bb.oc-island .oc-island-label');
    expect(openLabel).toContain('max-width: 0');
    expect(openLabel).toContain('opacity: 0');
  });
});
