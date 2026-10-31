// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { issueReviewShare } from '../lib/review-share';
import type { RoomLayout } from '../lib/types';
import { ReviewSharePage } from './review-share-page';
import { ShareMenu, type ShareMenuActions } from './share-menu';

afterEach(cleanup);

function actions(): ShareMenuActions {
  return {
    onIssueReviewLink: vi.fn(async () => ({ url: 'https://studio.example/review/issued' })),
    onExportHandoff: vi.fn(),
    onOpenMaterials: vi.fn(),
    onOpenChecklist: vi.fn(),
  };
}

describe('share menu', () => {
  it('opens from the single 分享 control and closes on Escape', () => {
    const share = actions();
    render(<ShareMenu actions={share}/>);
    const trigger = screen.getByRole('button', { name: '分享' });
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(screen.getAllByRole('button', { name: '分享' })).toHaveLength(1);
    fireEvent.click(trigger);
    const dialog = screen.getByRole('dialog', { name: '分享' });
    for (const name of ['发评审链接', '导出交接', '打开资料', '到场清单']) {
      expect(dialog.textContent).toContain(name);
    }
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: '分享' })).toBeNull();
  });

  it('copies a review link and routes export, materials, and the checklist without a mode switch', async () => {
    const share = actions();
    const clipboard = vi.fn(async () => undefined);
    Object.assign(navigator, { clipboard: { writeText: clipboard } });
    render(<ShareMenu actions={share}/>);
    fireEvent.click(screen.getByRole('button', { name: '分享' }));
    fireEvent.click(screen.getByRole('button', { name: '发评审链接' }));
    expect((await screen.findByRole('status')).textContent).toContain('链接已复制');
    expect(screen.getByRole('textbox', { name: '评审链接' })).toHaveProperty('value', 'https://studio.example/review/issued');
    expect(clipboard).toHaveBeenCalledWith('https://studio.example/review/issued');
    fireEvent.click(screen.getByRole('button', { name: '复制链接' }));
    fireEvent.click(screen.getByRole('button', { name: '导出交接' }));
    expect(share.onExportHandoff).toHaveBeenCalledOnce();
    expect(screen.queryByRole('dialog', { name: '分享' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '分享' }));
    fireEvent.click(screen.getByRole('button', { name: '打开资料' }));
    expect(share.onOpenMaterials).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: '分享' }));
    fireEvent.click(screen.getByRole('button', { name: '到场清单' }));
    expect(share.onOpenChecklist).toHaveBeenCalledOnce();
  });
});

function sampleLayout(): RoomLayout {
  return {
    name: '发布会',
    width: 12,
    height: 8,
    floors: [{
      id: 'floor', name: '一层', floorColor: '#fff',
      items: [{ id: 'desk', type: 'table', name: '签到桌', width: 1.6, depth: 0.6, height: 0.75, color: '#c4a574', icon: 'table', position: { x: 0, z: 0 } }],
    }],
  };
}

describe('review share page', () => {
  it('shows the frozen plan and accepts a comment plus one reply, with no creator chrome', async () => {
    const { snapshot } = issueReviewShare(sampleLayout(), 'http://localhost');
    render(<ReviewSharePage shareId={snapshot.id}/>);
    expect(await screen.findByRole('heading', { name: '发布会' })).toBeTruthy();
    expect(screen.getByRole('img', { name: '发布会 的只读平面' })).toBeTruthy();
    expect(screen.getAllByText('签到桌').length).toBeGreaterThan(0);
    expect(screen.queryByRole('complementary', { name: '晴光' })).toBeNull();
    expect(screen.queryByRole('navigation', { name: '工具' })).toBeNull();
    expect(screen.queryByRole('navigation', { name: '工作流程' })).toBeNull();
    expect(document.querySelector('[data-storage="local-demo"]')).toBeTruthy();

    const plan = screen.getByRole('img', { name: '发布会 的只读平面' });
    plan.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, right: 640, bottom: 400, width: 640, height: 400, toJSON() { return {}; } });
    fireEvent.click(plan, { clientX: 320, clientY: 200 });
    fireEvent.change(screen.getByLabelText('议题'), { target: { value: '入口再宽一点' } });
    fireEvent.click(screen.getByRole('button', { name: '钉上' }));
    expect(await screen.findByText('入口再宽一点')).toBeTruthy();
    expect(screen.getAllByText('签到桌').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: '议题 1' })).toBeTruthy();
  });
});
