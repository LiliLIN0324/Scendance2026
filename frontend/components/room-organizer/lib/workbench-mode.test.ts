import { describe, expect, it } from 'vitest';
import {
  WORKBENCH_MODE_DEFAULT,
  WORKBENCH_MODE_ICONS,
  WORKBENCH_MODES,
  type WorkbenchMode,
} from './workbench-mode';

describe('workbench modes (Phase 1 IA)', () => {
  it('exposes 空间布置 | 项目评审 | 方案执行 with default layout', () => {
    expect(WORKBENCH_MODES.map(mode => mode.id)).toEqual(['layout', 'review', 'delivery']);
    expect(WORKBENCH_MODES.map(mode => mode.label)).toEqual(['空间布置', '项目评审', '方案执行']);
    expect(WORKBENCH_MODE_DEFAULT).toBe('layout');
  });

  it('maps distinct collapsed-rail icons (not materials/nav duplicates)', () => {
    const icons = WORKBENCH_MODES.map(mode => WORKBENCH_MODE_ICONS[mode.id]);
    expect(icons).toEqual(['SquareStack', 'Send', 'ListChecks']);
    expect(new Set(icons).size).toBe(3);
    for (const reserved of ['Boxes', 'Layers', 'Eye', 'Grid', 'ClipboardList', 'LayoutGrid', 'Truck'] as const) {
      expect(icons).not.toContain(reserved);
    }
    for (const mode of ['layout', 'review', 'delivery'] as WorkbenchMode[]) {
      expect(WORKBENCH_MODE_ICONS[mode]).toBeTruthy();
    }
  });
});
