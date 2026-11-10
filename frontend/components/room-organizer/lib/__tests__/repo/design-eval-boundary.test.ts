/**
 * The banquet eval lives with the tests. A generator that imported it could
 * tune the preview until the ledger went green without matching the drawn floor.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '../../../../../');
const SHIPPED = ['components', 'lib', 'app'];
const GENERATORS = [
  'components/room-organizer/lib/local-plan.ts',
  'components/room-organizer/lib/scene-script.ts',
  'components/room-organizer/lib/scene-script-compiler.ts',
  'components/room-organizer/lib/agent-proposal.ts',
  'components/room-organizer/lib/event-layout-agent.ts',
];

function files(dir: string): string[] {
  const found: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (name === 'node_modules' || name === '__tests__') continue;
      found.push(...files(path));
      continue;
    }
    if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) found.push(path);
  }
  return found;
}

function specifiers(path: string): string[] {
  const source = readFileSync(path, 'utf8');
  return [...source.matchAll(/from\s+['"]([^'"]+)['"]/g)].map(match => match[1]!);
}

describe('banquet design-eval boundary', () => {
  it('no shipped module imports the evaluation', () => {
    const offenders: string[] = [];
    for (const dir of SHIPPED) {
      for (const file of files(join(ROOT, dir))) {
        for (const spec of specifiers(file)) {
          if (spec.includes('design-eval')) offenders.push(`${relative(ROOT, file)} -> ${spec}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the ledger does not call the generator filter', () => {
    const scorecard = readFileSync(join(ROOT, 'components/room-organizer/lib/__tests__/design-eval/scorecard.ts'), 'utf8');
    expect(scorecard).not.toContain('outsideDrawnRoom');
    expect(scorecard).not.toContain('omitUnlandedBanquetItems');
  });

  it('the floor reading imports no generator', () => {
    const reading = join(ROOT, 'components/room-organizer/lib/floor-reading.ts');
    const offenders = specifiers(reading).filter(spec => GENERATORS.some(generator => spec.includes(generator.replace(/^components\/room-organizer\/lib\//, '').replace(/\.ts$/, ''))));
    expect(offenders).toEqual([]);
  });
});
