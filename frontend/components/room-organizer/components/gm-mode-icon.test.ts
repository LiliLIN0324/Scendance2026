import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../../app/globals.css'), 'utf8');

function svgFromCustomProp(name: string): string {
  const match = css.match(new RegExp(`${name}:\\s*url\\("data:image/svg\\+xml,([^"]+)"\\)`));
  expect(match, name).toBeTruthy();
  return decodeURIComponent(match![1]!);
}

function strokeVerticalSpan(svg: string): number {
  const stroke = svg.match(/stroke='[^']+'[^>]*d='([^']+)'/);
  expect(stroke, svg).toBeTruthy();
  const ys: number[] = [];
  for (const pair of stroke![1]!.matchAll(/(-?\d+(?:\.\d+)?)[ \t]+(-?\d+(?:\.\d+)?)/g)) ys.push(Number(pair[2]));
  return Math.max(...ys) - Math.min(...ys);
}

describe('Google Maps 2D/3D cube icon', () => {
  it('平面是短侧壁薄板，立体是拉开的立方体，并且字被藏掉', () => {
    const flat = svgFromCustomProp('--oc-gm-mode-flat');
    const cube = svgFromCustomProp('--oc-gm-mode-cube');
    expect(flat.match(/<path fill='#/g)).toHaveLength(3);
    expect(cube.match(/<path fill='#/g)).toHaveLength(3);
    expect(flat).toContain("fill='none'");
    expect(cube).toContain("fill='none'");
    const flatSpan = strokeVerticalSpan(flat);
    const cubeSpan = strokeVerticalSpan(cube);
    expect(cubeSpan).toBeGreaterThan(flatSpan + 2);
    expect(css).toContain('button.oc-gm-mode[aria-pressed="true"] .oc-gm-mode-text::before { opacity: 0; }');
    expect(css).toContain('button.oc-gm-mode[aria-pressed="true"] .oc-gm-mode-text::after { opacity: 1; }');
    expect(css).toMatch(/\.oc-gm-mode-text \{[^}]*font-size:\s*0/);
    expect(css).toContain('prefers-reduced-motion: reduce');
    expect(css).toContain('.oc-gm-mode-text::after { transition: none; }');
  });
});
