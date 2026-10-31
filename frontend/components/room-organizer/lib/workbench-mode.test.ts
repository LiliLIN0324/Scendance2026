import { describe, expect, it } from 'vitest';
import {
  WORKBENCH_MODE_DEFAULT,
  WORKBENCH_MODES,
  demoteLegacyMode,
  type WorkbenchMode,
} from './workbench-mode';

describe('workbench modes', () => {
  it('keeps 布置 as a capability and does not publish rail icons', async () => {
    expect(WORKBENCH_MODES.map(mode => mode.id)).toEqual(['layout']);
    expect(WORKBENCH_MODES.map(mode => mode.label)).toEqual(['布置']);
    expect(WORKBENCH_MODE_DEFAULT).toBe('layout');
    const workbenchMode = await import('./workbench-mode');
    expect(workbenchMode).not.toHaveProperty('WORKBENCH_MODE_ICONS');
  });

  it('sends legacy review and delivery clicks to share or the checklist', () => {
    expect(demoteLegacyMode('layout')).toBe('layout');
    expect(demoteLegacyMode('review')).toBe('open-share');
    expect(demoteLegacyMode('delivery')).toBe('open-checklist');
    for (const mode of ['layout', 'review', 'delivery'] as WorkbenchMode[]) {
      expect(demoteLegacyMode(mode)).toBeTruthy();
    }
  });
});
