import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));

function block(css: string, selector: string): string {
  const start = css.indexOf(selector);
  expect(start).toBeGreaterThan(-1);
  const end = css.indexOf('}', start);
  return css.slice(start, end);
}

describe('左栏与右下角中文 tooltip', () => {
  it('uses the shared ink capsule tokens on the left rail and the map controls', () => {
    const css = readFileSync(join(here, '../../../app/globals.css'), 'utf8');
    const rail = block(css, '.sc-workbench .is-docked-layout.is-mode-rail .sc-mode-rail [data-tip]::after');
    const corner = block(css, '.sc-workbench .sc-tool-column .oc-cluster.oc-br [data-tip]::after');
    for (const rule of [rail, corner]) {
      expect(rule).toContain('border-radius: var(--r-sm)');
      expect(rule).toContain('background: var(--wk-ink)');
      expect(rule).toContain('color: var(--paper)');
      expect(rule).toContain('box-shadow: var(--e1)');
      expect(rule).toContain('font-size: var(--fs-cap)');
      expect(rule).toContain('var(--dur-1)');
      expect(rule).toContain('var(--ease-spec)');
      expect(rule).not.toContain('999px');
      expect(rule).not.toContain('#fff');
    }
    expect(rail).toContain('left: calc(100% + var(--sp-2))');
    expect(css).toContain('flex-direction: column; border-radius: var(--oc-gm-radius); overflow: visible;');
  });

  it('gives the account button a Chinese data-tip instead of a native title', () => {
    const source = readFileSync(join(here, '../panels/cloud-panel.tsx'), 'utf8');
    expect(source).toContain('data-tip="账户中心 · 身份、团队与项目"');
    expect(source).not.toContain('title="账户中心 · 身份、团队与项目"');
  });
});
