// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AnnotateDrawTools } from './annotate-draw-tools';

afterEach(() => cleanup());

const TOOL_NAMES = ['文本', '矩形', '圆形', '三角形', '线段'] as const;

function renderTools(active: 'note' | 'rect' | 'circle' | 'triangle' | 'line' | null = 'rect') {
  const onNote = vi.fn();
  const onShape = vi.fn();
  render(<AnnotateDrawTools active={active} onNote={onNote} onShape={onShape} />);
  return { onNote, onShape };
}

describe('AnnotateDrawTools', () => {
  it('lays out text and every shape at once, with no dropdown', () => {
    renderTools('triangle');
    const bar = screen.getByTestId('annotate-draw-tools');
    expect(bar.style.flexWrap).toBe('nowrap');
    const buttons = TOOL_NAMES.map(name => screen.getByRole('button', { name }));
    const order = [...bar.querySelectorAll('button')];
    const indexes = buttons.map(button => order.indexOf(button as HTMLButtonElement));
    expect(indexes.every(index => index >= 0)).toBe(true);
    expect(indexes).toEqual([...indexes].sort((a, b) => a - b));
    expect(buttons).toHaveLength(5);
    expect(screen.getByRole('button', { name: '三角形' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: '文本' }).getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByRole('button', { name: '矩形' }).getAttribute('aria-pressed')).toBe('false');
    expect(bar.querySelector('[role="listbox"]')).toBeNull();
    expect(bar.querySelector('[role="menu"]')).toBeNull();
    expect(bar.querySelector('[aria-haspopup]')).toBeNull();
    expect(screen.queryByTestId('annotate-shape-menu')).toBeNull();
    expect(screen.queryByTestId('annotate-type-shape')).toBeNull();
    for (const button of buttons) expect(getComputedStyle(button).display).not.toBe('none');
  });

  it('exposes one Figma shortcut per tool and keeps a single pressed tool', () => {
    renderTools('line');
    const keys = { 文本: 'T', 矩形: 'R', 圆形: 'O', 三角形: 'Y', 线段: 'L' } as const;
    for (const [name, key] of Object.entries(keys)) {
      const button = screen.getByRole('button', { name });
      expect(button.getAttribute('aria-keyshortcuts')).toBe(key);
      expect(button.getAttribute('title')).toContain(key);
      expect(button.getAttribute('aria-pressed')).toBe(name === '线段' ? 'true' : 'false');
    }
  });

  it('picks a shape or text in one click', () => {
    const { onNote, onShape } = renderTools(null);
    fireEvent.click(screen.getByRole('button', { name: '圆形' }));
    fireEvent.click(screen.getByRole('button', { name: '线段' }));
    fireEvent.click(screen.getByRole('button', { name: '文本' }));
    expect(onShape).toHaveBeenNthCalledWith(1, 'circle');
    expect(onShape).toHaveBeenNthCalledWith(2, 'line');
    expect(onNote).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('uses 46px hit targets, optically balanced per-kind icons, and a filled active state', () => {
    renderTools('rect');
    const rect = screen.getByRole('button', { name: '矩形' });
    const circle = screen.getByRole('button', { name: '圆形' });
    expect(rect.style.width).toBe('46px');
    expect(rect.style.height).toBe('46px');
    expect(rect.style.border).toContain('1.5px solid');
    expect(rect.style.background).not.toBe('transparent');
    expect(circle.style.background).toBe('transparent');
    // 2026-11-28 用户拍板的最终尺寸：Square/Circle/Triangle 16、Minus 20+2.5，T 字 18px。
    expect(rect.querySelector('svg')?.getAttribute('width')).toBe('16');
    expect(circle.querySelector('svg')?.getAttribute('width')).toBe('16');
    expect(screen.getByRole('button', { name: '三角形' }).querySelector('svg')?.getAttribute('width')).toBe('16');
    const lineSvg = screen.getByRole('button', { name: '线段' }).querySelector('svg');
    expect(lineSvg?.getAttribute('width')).toBe('20');
    expect(lineSvg?.getAttribute('stroke-width')).toBe('2.5');
  });

  it('replaces the shape menu in the annotate zone and leaves the color bar beside it', () => {
    const src = readFileSync(join(process.cwd(), 'components/room-organizer/components/outdoor-plan-canvas.tsx'), 'utf8');
    const zoneAt = src.indexOf('data-testid="annotate-zone"');
    const toolsAt = src.indexOf('<AnnotateDrawTools', zoneAt);
    const barAt = src.indexOf('<AnnotateColorBar', toolsAt);
    expect(zoneAt).toBeGreaterThan(0);
    expect(toolsAt).toBeGreaterThan(zoneAt);
    expect(barAt).toBeGreaterThan(toolsAt);
    const between = src.slice(toolsAt, barAt);
    expect(between).not.toContain('annotate-shape-menu');
    expect(between).not.toContain('annotate-type-shape');
    expect(src.slice(zoneAt)).not.toContain('annotateMenuOpen');
    expect(src.slice(barAt, barAt + 400)).not.toContain("mode === 'shape'");
  });

  it('keeps every hint/status row out of the annotate popover entirely', () => {
    const src = readFileSync(join(process.cwd(), 'components/room-organizer/components/outdoor-plan-canvas.tsx'), 'utf8');
    // 2026-11-28 用户指令：提示行整个删掉——不写引导文案，也不留占位高度或条件回执行；
    // annotateNotice 状态一并退役（setEditMessage 是唯一失败通道）。
    expect(src).not.toContain('const annotateHint');
    expect(src).not.toContain('annotateNotice');
    expect(src).not.toContain('annotate-hint');
    expect(src).not.toContain('选一个工具，在图上绘制');
    expect(src).not.toContain('文本 · 点一下输入');
    expect(src).not.toContain('按住拖或点两个点');
    expect(src).not.toContain('单击 3 点连成三角形');
    expect(src).not.toContain('点，还需');
    // 固定宽度；有明确关闭口，不靠点外部收起。
    expect(src).toContain('const ANNOTATE_CARD_WIDTH = 286');
    expect(src).toContain('data-testid="outdoor-inspector-card-annotate-close"');
    expect(src).toContain('const halfPanel = panelWidth / 2');
  });
});
