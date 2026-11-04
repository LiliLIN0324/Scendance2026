/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfirmModal } from './ConfirmModal';

afterEach(cleanup);

describe('ConfirmModal 站内确认弹层', () => {
  it('open 时渲染标题与描述，关闭时不挂载', () => {
    render(
      <ConfirmModal
        open
        title='应用这份方案'
        description='将把当前提案落到画布上。'
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByRole('dialog', { name: '应用这份方案' })).toBeTruthy();
    expect(screen.getByText('将把当前提案落到画布上。')).toBeTruthy();
    expect(screen.getByRole('button', { name: '确认' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '取消' })).toBeTruthy();
  });

  it('open=false 时不渲染任何弹层节点', () => {
    render(
      <ConfirmModal
        open={false}
        title='不会出现'
        description='也不会出现'
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('点击确认按钮触发 onConfirm，点击取消按钮触发 onCancel', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <ConfirmModal
        open
        title='应用这份方案'
        description='…'
        confirmText='应用'
        cancelText='再想想'
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '应用' }));
    expect(onConfirm).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: '再想想' }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('Esc 键与点击遮罩都触发 onCancel', () => {
    const onCancel = vi.fn();
    const { container } = render(
      <ConfirmModal
        open
        title='提示'
        description='…'
        onConfirm={vi.fn()}
        onCancel={onCancel}
      />,
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);
    const backdrop = container.firstElementChild as HTMLElement;
    fireEvent.click(backdrop);
    expect(onCancel).toHaveBeenCalledTimes(2);
  });
});
