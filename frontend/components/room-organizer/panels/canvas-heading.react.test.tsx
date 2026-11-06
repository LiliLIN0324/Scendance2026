/** @vitest-environment jsdom */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CanvasHeading } from './canvas-heading';

describe('CanvasHeading', () => {
  it('does not show a heading in 3D', () => {
    const { container } = render(<CanvasHeading view2D={false} />);
    expect(container.querySelector('.sc-canvas-heading')).toBeNull();
    expect(screen.queryByText('3D 场景')).toBeNull();
  });

  it('shows 2D 平面 when the flat plan view is active', () => {
    render(<CanvasHeading view2D />);
    expect(screen.getByText('2D 平面').textContent).toBe('2D 平面');
  });
});
