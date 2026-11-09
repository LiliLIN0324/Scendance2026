import {readFileSync} from 'node:fs';
import {describe, expect, it} from 'vitest';

const root = new URL('..', import.meta.url);

function source(path: string): string {
  return readFileSync(new URL(path, root), 'utf8');
}

describe('recovery log wiring contracts', () => {
  it('keeps the proposal confirm button able to call the journal when an owner is supplied', () => {
    const panel = source('panels/agent-panel.tsx');
    expect(panel).toContain('requirementJournal');
    expect(panel).toContain('confirmPrepared');
    expect(panel).toContain('云端确认还没有写入需求日志');
  });

  it.fails('installs that journal from the live room organizer', () => {
    expect(source('room-organizer.tsx')).toContain('requirementJournal');
  });

  it.fails.each([
    ['rebuild', 'panels/reconstruction-panel.tsx'],
    ['material', 'panels/material-customization.tsx'],
    ['review', 'panels/project-review-panel.tsx'],
    ['restore', 'room-organizer.tsx'],
  ])('%s button path consults the recovery journal', (_entry, path) => {
    expect(source(path)).toContain('requirement-recovery-loop');
  });
});
