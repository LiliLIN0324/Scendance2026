import { describe, expect, it } from 'vitest';
import {
  WORKBENCH_MODE_DEFAULT,
  WORKBENCH_MODES,
  type WorkbenchMode,
} from './workbench-mode';

describe('workbench capabilities', () => {
  it('keeps 布置 | 评审 | 执行 as capabilities, with layout as the creation surface', () => {
    expect(WORKBENCH_MODES.map(mode => mode.id)).toEqual(['layout', 'review', 'delivery']);
    expect(WORKBENCH_MODES.map(mode => mode.label)).toEqual(['布置', '评审', '执行']);
    expect(WORKBENCH_MODE_DEFAULT).toBe('layout');
  });

  it('does not publish rail icons for those capabilities', async () => {
    const workbenchMode = await import('./workbench-mode');
    expect(workbenchMode).not.toHaveProperty('WORKBENCH_MODE_ICONS');
    for (const mode of ['layout', 'review', 'delivery'] as WorkbenchMode[]) {
      expect(WORKBENCH_MODES.some(entry => entry.id === mode)).toBe(true);
    }
  });
});