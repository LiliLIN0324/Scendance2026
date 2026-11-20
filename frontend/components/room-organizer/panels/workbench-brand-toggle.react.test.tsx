// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorkbenchBrandToggle } from './workbench-brand-toggle';

afterEach(cleanup);

describe('workbench brand toggle', () => {
  it('keeps only the lock mark and never shows the 幕景 wordmark', () => {
    const onToggle = vi.fn();
    const { rerender } = render(<WorkbenchBrandToggle onToggle={onToggle} />);
    const closed = screen.getByRole('button', { name: '打开 活动' });
    expect(closed.getAttribute('aria-pressed')).toBe('false');
    expect(closed.getAttribute('aria-expanded')).toBe('false');
    expect(closed.getAttribute('data-tip')).toBe('打开 活动');
    expect(closed.getAttribute('title')).toBeNull();
    expect(closed.className).toContain('is-mark');
    expect(closed.textContent).not.toContain('幕景');
    expect(closed.querySelector('.sc-brand-dot')).toBeNull();
    fireEvent.click(closed);
    expect(onToggle).toHaveBeenCalledOnce();

    rerender(<WorkbenchBrandToggle open onToggle={onToggle} />);
    const open = screen.getByRole('button', { name: '收起 活动' });
    expect(open.getAttribute('aria-pressed')).toBe('true');
    expect(open.getAttribute('aria-expanded')).toBe('true');
    expect(open.getAttribute('data-tip')).toBe('收起 活动');
    expect(open.getAttribute('title')).toBeNull();
    expect(open.className).toContain('is-mark');
    expect(open.className).toContain('is-active');
    expect(open.textContent).not.toContain('幕景');
    expect(open.querySelector('.sc-brand-dot')).toBeNull();
  });

  it('marks a retained lane as secondary: pressed but not expanded, with a cut-back label', () => {
    render(<WorkbenchBrandToggle retained onToggle={vi.fn()} />);
    const retained = screen.getByRole('button', { name: '活动：切回当前对话' });
    expect(retained.getAttribute('aria-pressed')).toBe('true');
    expect(retained.getAttribute('aria-expanded')).toBe('false');
    expect(retained.className).toContain('is-retained');
    expect(retained.className).not.toContain('is-active');
  });

  it('moves the hall eye holes toward the pointer and does not paint pupils', async () => {
    const { container } = render(<WorkbenchBrandToggle onToggle={vi.fn()} />);
    const face = container.querySelector('.sc-rail-avatar') as HTMLElement;
    expect(face).toBeTruthy();
    expect(container.querySelector('svg.sc-rail-hall')).toBeTruthy();
    expect(container.querySelector('.sc-rail-hall-eyes')?.parentElement?.tagName.toLowerCase()).toBe('mask');
    expect(container.querySelector('.sc-rail-eye')).toBeNull();
    expect(container.querySelector('svg.sc-rail-hall > path')?.getAttribute('fill')).toContain('35624A');
    face.getBoundingClientRect = () => ({
      x: 0, y: 0, left: 0, top: 0, right: 28, bottom: 28, width: 28, height: 28, toJSON() { return {}; },
    });
    await act(async () => {
      window.dispatchEvent(new MouseEvent('pointermove', { clientX: 80, clientY: 14 }));
      await new Promise(resolve => requestAnimationFrame(() => resolve(undefined)));
    });
    expect(Number.parseFloat(face.style.getPropertyValue('--eye-x'))).toBeGreaterThan(0);
    expect(Number.parseFloat(face.style.getPropertyValue('--eye-y'))).toBe(0);
    expect(face.style.getPropertyValue('--tilt-y')).toBe('-15.00deg');
    expect(face.style.getPropertyValue('--tilt-x')).toBe('0.00deg');
  });

  it('leaves the hall face still when reduced motion is requested', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query.includes('reduce'),
      media: query,
      addEventListener() {},
      removeEventListener() {},
    }));
    try {
      const { container } = render(<WorkbenchBrandToggle onToggle={vi.fn()} />);
      const face = container.querySelector('.sc-rail-avatar') as HTMLElement;
      await act(async () => {
        window.dispatchEvent(new MouseEvent('pointermove', { clientX: 80, clientY: 14 }));
        await new Promise(resolve => requestAnimationFrame(() => resolve(undefined)));
      });
      expect(face.style.getPropertyValue('--eye-x')).toBe('');
      expect(face.style.getPropertyValue('--tilt-y')).toBe('');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
