// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PLANNING_LAYER_COLORS } from '@/lib/outdoor-plan-tokens';
import { ANNOTATE_COLOR_SWATCHES, AnnotateColorBar } from './annotate-color-bar';

afterEach(() => cleanup());

describe('AnnotateColorBar', () => {
  it('keeps every color dot and both stroke widths on one bar, with no menu', () => {
    render(
      <AnnotateColorBar
        color={PLANNING_LAYER_COLORS.annotate}
        strokeWidth="thin"
        onColor={() => {}}
        onStrokeWidth={() => {}}
      />,
    );
    const bar = screen.getByTestId('annotate-color-bar');
    expect(bar.style.height).toBe('34px');
    expect(bar.getAttribute('aria-haspopup')).toBeNull();
    expect(bar.querySelector('[aria-haspopup]')).toBeNull();
    expect(bar.querySelector('[role="menu"]')).toBeNull();
    expect(bar.querySelector('details')).toBeNull();

    for (const swatch of ANNOTATE_COLOR_SWATCHES) {
      const dot = screen.getByTestId(`annotate-color-${swatch.value.replace('#', '')}`);
      expect(bar.contains(dot)).toBe(true);
      expect(dot.getAttribute('aria-label')).toBe(`标注颜色 ${swatch.label}`);
    }
    expect(screen.getByRole('radio', { name: '标注颜色 紫' }).getAttribute('aria-checked')).toBe('true');

    const thin = screen.getByTestId('annotate-stroke-thin');
    const thick = screen.getByTestId('annotate-stroke-thick');
    expect(bar.contains(thin)).toBe(true);
    expect(bar.contains(thick)).toBe(true);
    expect(thin.getAttribute('aria-checked')).toBe('true');
    expect(thick.getAttribute('aria-checked')).toBe('false');
    expect(getComputedStyle(thin).display).not.toBe('none');
    expect(getComputedStyle(thick).display).not.toBe('none');
  });

  it('keeps colors but hides the unused stroke width in text mode', () => {
    render(
      <AnnotateColorBar
        color={PLANNING_LAYER_COLORS.annotate}
        strokeWidth="thin"
        showStrokeWidth={false}
        onColor={() => {}}
        onStrokeWidth={() => {}}
      />,
    );
    const bar = screen.getByTestId('annotate-color-bar');
    expect(bar.style.height).toBe('34px');
    expect(bar.getAttribute('aria-label')).toBe('标注颜色');
    for (const swatch of ANNOTATE_COLOR_SWATCHES) {
      expect(bar.contains(screen.getByTestId(`annotate-color-${swatch.value.replace('#', '')}`))).toBe(true);
    }
    expect(screen.queryByRole('radio', { name: '细线' })).toBeNull();
    expect(screen.queryByRole('radio', { name: '粗线' })).toBeNull();
    expect(screen.getByText('文字只用颜色')).toBeTruthy();
  });

  it('changes color and stroke width in place', () => {
    const onColor = vi.fn();
    const onStrokeWidth = vi.fn();
    render(
      <AnnotateColorBar
        color={PLANNING_LAYER_COLORS.annotate}
        strokeWidth="thin"
        onColor={onColor}
        onStrokeWidth={onStrokeWidth}
      />,
    );
    fireEvent.click(screen.getByRole('radio', { name: '标注颜色 橙' }));
    fireEvent.click(screen.getByRole('radio', { name: '粗线' }));
    expect(onColor).toHaveBeenCalledWith(PLANNING_LAYER_COLORS.facility);
    expect(onStrokeWidth).toHaveBeenCalledWith('thick');
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('is mounted on the drawing toolbar outside any shape menu', () => {
    const src = readFileSync(join(process.cwd(), 'components/room-organizer/components/outdoor-plan-canvas.tsx'), 'utf8');
    const zoneAt = src.indexOf('data-testid="annotate-zone"');
    const barAt = src.indexOf('<AnnotateColorBar');
    expect(zoneAt).toBeGreaterThan(0);
    expect(barAt).toBeGreaterThan(zoneAt);
    const head = src.slice(zoneAt, barAt);
    const menuAt = head.lastIndexOf('annotate-shape-menu');
    if (menuAt >= 0) {
      expect(head.lastIndexOf('</div>')).toBeGreaterThan(menuAt);
    }
    expect(src.slice(barAt, barAt + 400)).not.toContain("mode === 'shape'");
    expect(src).not.toContain('描边档位仅形状显示');
  });
});
