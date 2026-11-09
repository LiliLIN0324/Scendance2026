// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./scendance-workspace', () => ({
  ScendanceLibrary: () => <div>完整库</div>,
}));

vi.mock('../contexts', () => ({
  useRoomEditor: () => ({ layout: { width: 12, height: 8 } }),
}));

import { PlannerMaterials } from './planner-materials';

afterEach(cleanup);

describe('planner materials', () => {
  it('places a table through the existing catalog action', () => {
    const placeCatalogItem = vi.fn((_item: { materialId?: string }) => 'item-1');
    render(<PlannerMaterials placeCatalogItem={placeCatalogItem} />);
    fireEvent.click(screen.getByRole('button', { name: '桌子' }));
    expect(placeCatalogItem).toHaveBeenCalledOnce();
    expect(placeCatalogItem.mock.calls[0]?.[0]?.materialId).toBe('table');
    expect(screen.getByRole('status').textContent).toMatch(/已放到场地上/);
    expect(screen.queryByRole('button', { name: '库' })).toBeNull();
  });

  it('opens the full library only after asking for something else', () => {
    render(<PlannerMaterials placeCatalogItem={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '从库里找别的，或做一件没有的' }));
    expect(screen.getByText('完整库')).toBeTruthy();
  });
});
