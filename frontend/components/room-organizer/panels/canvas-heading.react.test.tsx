/** @vitest-environment jsdom */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CanvasHeading } from './canvas-heading';

describe('CanvasHeading', () => {
  it('shows only the view kind in 3D without venue dimensions', () => {
    const { container } = render(<CanvasHeading view2D={false} />);
    const heading = container.querySelector('.sc-canvas-heading');
    expect(heading?.textContent).toBe('3D 场景');
    expect(screen.getByText('3D 场景')).toBeTruthy();
    expect(heading?.textContent).not.toMatch(/×\s*\d|\d\s*×|m²|m\b/);
  });

  it('shows 2D 平面 when the flat plan view is active', () => {
    render(<CanvasHeading view2D />);
    expect(screen.getByText('2D 平面').textContent).toBe('2D 平面');
  });
});
