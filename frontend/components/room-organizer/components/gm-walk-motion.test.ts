import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../../app/globals.css'), 'utf8')
  .replace(/\r\n/g, '\n');

function svgFromVar(name: string): string {
  const match = css.match(new RegExp(`${name}:\\s*url\\("data:image/svg\\+xml,([^"]+)"\\)`));
  expect(match, name).toBeTruthy();
  return decodeURIComponent(match![1]!);
}

describe('walk pegman hover and selected motion', () => {
  it('picks the figure up on hover and holds a raised pose when selected', () => {
    const rest = svgFromVar('--pegman-rest');
    const up = svgFromVar('--pegman-up');
    for (const svg of [rest, up]) {
      expect(svg).toContain('fill="#FBBC04"');
      expect(svg).toContain('fill="#E37400"');
      expect(svg).toContain('stroke="#F9AB00"');
      expect(svg).not.toContain('<ellipse');
    }
    expect(rest).toContain('M15.2 22.8c-3.4 1.2-6 3.8-6.4 7');
    expect(up).toContain('M16.2 22.2c-3.6-2.2-8.2-.6-8.6 2.4');
    expect(up).not.toContain('M15.2 22.8c-3.4 1.2-6 3.8-6.4 7');

    expect(css).toContain('@keyframes sc-pegman-pickup');
    expect(css).toContain('animation: sc-pegman-pickup .42s cubic-bezier(.22, .85, .3, 1);');
    expect(css).toContain('translate(-50%, calc(-50% - 3px)) rotate(-10deg) scale(1.04, 1.04)');
    expect(css).toContain('translate(-50%, calc(-50% - 2px)) rotate(-7deg) scale(1.02, 1.02)');
    expect(css).toContain('translate(-50%, calc(-50% - 3.5px)) rotate(-12deg) scale(1.05, 1.05)');
    expect(css).toContain('transition: transform .34s cubic-bezier(.34, 1.45, .5, 1);');
    expect(css).toContain('background-image: var(--pegman-up);');
    expect(css).toContain('radial-gradient(ellipse at center, rgba(60, 64, 67, .34) 0, rgba(60, 64, 67, 0) 72%)');
    expect(css).toContain('background: #e8f0fe;');
    expect(css).toContain('--oc-gm-shadow-active: 0 0 0 2px #1a73e8');

    const reducedAt = css.indexOf('.sc-workbench .sc-tool-column button.is-walk::before,\n  .sc-workbench .sc-tool-column button.is-walk:hover::before');
    expect(reducedAt).toBeGreaterThan(css.indexOf('@keyframes sc-pegman-pickup'));
    const reduced = css.slice(reducedAt, reducedAt + 1800);
    expect(reduced).toContain('animation: none;');
    expect(reduced).toContain('transform: translate(-50%, -50%) rotate(0deg) scale(1, 1);');
    expect(reduced).toContain('background-image: var(--pegman-rest);');
    expect(reduced).toContain('transition: none;');
  });
});
