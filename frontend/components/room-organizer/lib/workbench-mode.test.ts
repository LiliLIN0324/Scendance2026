import { describe, expect, it } from 'vitest';
import {
  WORKBENCH_MODE_DEFAULT,
  WORKBENCH_MODE_ICONS,
  WORKBENCH_MODES,
  demoteLegacyMode,
  type WorkbenchMode,
} from './workbench-mode';

describe('workbench modes', () => {
  it('keeps 布置 as the only resident rail mode', () => {
    expect(WORKBENCH_MODES.map(mode => mode.id)).toEqual(['layout']);
    expect(WORKBENCH_MODES.map(mode => mode.label)).toEqual(['布置']);
    expect(WORKBENCH_MODE_DEFAULT).toBe('layout');
    expect(WORKBENCH_MODE_ICONS.layout).toBe('SquareStack');
  });

  it('sends legacy review and delivery clicks to share or the checklist', () => {
    expect(demoteLegacyMode('layout')).toBe('layout');
    expect(demoteLegacyMode('review')).toBe('open-share');
    expect(demoteLegacyMode('delivery')).toBe('open-checklist');
    for (const mode of ['layout', 'review', 'delivery'] as WorkbenchMode[]) {
      expect(WORKBENCH_MODE_ICONS[mode]).toBeTruthy();
    }
  });
});
