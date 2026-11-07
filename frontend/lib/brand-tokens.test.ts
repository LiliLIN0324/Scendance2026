import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// 品牌 P0（docs/26 §2）：全仓唯一一组绿 + 唯一一种标志画法。
const here = dirname(fileURLToPath(import.meta.url));
const frontend = resolve(here, '..');
const repo = resolve(frontend, '..');

function read(rel: string): string {
  return readFileSync(resolve(frontend, rel), 'utf8');
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (['.css', '.ts', '.tsx'].includes(extname(path))) out.push(path);
  }
  return out;
}

const driftIn = (text: string): boolean => /#(3a6247|e8f0ea|2f5d45|2f5b3e|e7f0ea)\b/i.test(text);

describe('brand tokens (P0-2 / P0-3)', () => {
  it('pins the single deep green and pale green in globals.css', () => {
    const css = read('app/globals.css');
    expect(css).toMatch(/--green-deep:\s*#35624A/);
    expect(css).toMatch(/--green-pale:\s*#EEF3EF/);
    expect(css).not.toMatch(/#3a6247\b/i);
  });

  it('keeps docs/05 in step with the runtime token', () => {
    const spec = readFileSync(resolve(repo, 'docs/05-设计规范.md'), 'utf8');
    expect(spec).toMatch(/\|\s*`--green-deep`\s*\|\s*`#35624A`/);
    expect(spec).toMatch(/\|\s*`--green-pale`\s*\|\s*`#EEF3EF`/);
  });

  it('has no drifted green fallback anywhere in app/components/lib', () => {
    const self = resolve(here, 'brand-tokens.test.ts');
    const offenders: string[] = [];
    for (const file of [...walk(resolve(frontend, 'app')), ...walk(resolve(frontend, 'components')), ...walk(resolve(frontend, 'lib'))]) {
      if (file === self) continue;
      if (driftIn(readFileSync(file, 'utf8'))) offenders.push(file.slice(frontend.length + 1));
    }
    expect(offenders).toEqual([]);
  });
});

describe('brand lockup (P0-4)', () => {
  it('gives the English wordmark a Playfair consumer', () => {
    expect(read('app/globals.css')).toMatch(/\.sc-brand-en\s*\{[^}]*font-family:\s*var\(--font-playfair\)/);
    const consumers = walk(resolve(frontend, 'app'))
      .concat(walk(resolve(frontend, 'components')))
      .filter(file => file.endsWith('.tsx') && readFileSync(file, 'utf8').includes('sc-brand-en'));
    expect(consumers.length).toBeGreaterThanOrEqual(2);
  });
});

describe('brand mark (P0-1)', () => {
  it('draws the door + eyes mark instead of the three-bar mark', () => {
    const source = read('lib/investor-report.ts');
    expect(source).toContain("doorGreen: '#35624A'");
    expect(source).toContain('destination-out');
    expect(source).not.toContain('三柱标');
    expect(source).not.toMatch(/const bars = \[/);
  });
});
