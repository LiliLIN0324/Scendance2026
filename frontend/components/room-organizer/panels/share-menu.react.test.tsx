// @vitest-environment jsdom
import { act,cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RoomLayout } from '../lib/types';
import { planOutline, ShareMenu, type ShareMenuActions } from './share-menu';

afterEach(cleanup);

function actions(): ShareMenuActions {
  return {
    onIssueReviewLink: vi.fn(async () => ({ url: 'https://studio.example/review/issued',isCurrent:()=>true })),
    onPublish: vi.fn(async () => ({ url: 'https://studio.example/view/#token', revision: 3 })),
    onExportHandoff: vi.fn(),
    onOpenMaterials: vi.fn(),
    onOpenChecklist: vi.fn(),
  };
}

describe('发布卡片', () => {
  it('opens from the single 发布 control, shows preview, scan, and outline, and closes on Escape', () => {
    localStorage.clear();
    render(<ShareMenu actions={actions()} layout={sampleLayout()}/>);
    const trigger = screen.getByRole('button', { name: '发布' });
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(screen.getAllByRole('button', { name: '发布' })).toHaveLength(1);
    fireEvent.click(trigger);
    const dialog = screen.getByRole('dialog', { name: '发布' });
    for (const name of ['方案预览', '手机看方案', '项目大纲', '发布当前版本', '发评审链接', '导出交接', '打开资料', '到场清单']) {
      expect(dialog.textContent).toContain(name);
    }
    expect(dialog.textContent).toContain('12 × 8 m');
    expect(dialog.textContent).toContain('1 件');
    expect(dialog.textContent).toContain('签到');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: '发布' })).toBeNull();
  });

  it('publishes the saved version, draws the QR, and copies the link', async () => {
    localStorage.clear();
    const share = actions();
    const clipboard = vi.fn(async () => undefined);
    Object.assign(navigator, { clipboard: { writeText: clipboard } });
    render(<ShareMenu actions={share} layout={sampleLayout()}/>);
    fireEvent.click(screen.getByRole('button', { name: '发布' }));
    expect(screen.getByText(/发布后这里出二维码/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '发布当前版本' }));
    expect(await screen.findByRole('img', { name: '只读方案二维码' })).toBeTruthy();
    expect((screen.getByRole('status')).textContent).toContain('版本 3 已发布');
    expect(screen.getByRole('link', { name: '打开只读页' })).toHaveProperty('href', 'https://studio.example/view/#token');
    fireEvent.click(screen.getByRole('button', { name: '复制链接' }));
    expect(clipboard).toHaveBeenCalledWith('https://studio.example/view/#token');
    expect(localStorage.getItem('scendance.publishedLink.v1.project-1')).toContain('https://studio.example/view/#token');
    expect(share.onPublish).toHaveBeenCalledOnce();
  });

  it('shows the reason when publishing is refused', async () => {
    localStorage.clear();
    const share = actions();
    vi.mocked(share.onPublish).mockRejectedValueOnce(new Error('还有改动没保存，保存后再发布。'));
    render(<ShareMenu actions={share} layout={sampleLayout()}/>);
    fireEvent.click(screen.getByRole('button', { name: '发布' }));
    fireEvent.click(screen.getByRole('button', { name: '发布当前版本' }));
    expect((await screen.findByRole('status')).textContent).toContain('保存后再发布');
    expect(screen.queryByRole('img', { name: '只读方案二维码' })).toBeNull();
  });

  it('copies a review link and routes export, materials, and the checklist without a mode switch', async () => {
    localStorage.clear();
    const share = actions();
    const clipboard = vi.fn(async () => undefined);
    Object.assign(navigator, { clipboard: { writeText: clipboard } });
    render(<ShareMenu actions={share} layout={sampleLayout()}/>);
    fireEvent.click(screen.getByRole('button', { name: '发布' }));
    fireEvent.click(screen.getByRole('button', { name: '发评审链接' }));
    expect((await screen.findByRole('status')).textContent).toContain('请确认当前活动和方案后复制');
    expect(screen.getByRole('textbox', { name: '评审链接' })).toHaveProperty('value', 'https://studio.example/review/issued');
    expect(clipboard).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'复制评审链接'}));
    expect(clipboard).toHaveBeenCalledWith('https://studio.example/review/issued');
    fireEvent.click(screen.getByRole('button', { name: '导出交接' }));
    expect(share.onExportHandoff).toHaveBeenCalledOnce();
    expect(screen.queryByRole('dialog', { name: '发布' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '发布' }));
    fireEvent.click(screen.getByRole('button', { name: '打开资料' }));
    expect(share.onOpenMaterials).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: '发布' }));
    fireEvent.click(screen.getByRole('button', { name: '到场清单' }));
    expect(share.onOpenChecklist).toHaveBeenCalledOnce();
  });
  it('never copies a link whose activity changes before the async result returns',async()=>{
    const share=actions(),clipboard=vi.fn(async()=>undefined);Object.assign(navigator,{clipboard:{writeText:clipboard}});
    let finish!:(value:{url:string;isCurrent:()=>boolean})=>void,epoch=0;const token=epoch;
    vi.mocked(share.onIssueReviewLink).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
    render(<ShareMenu actions={share} layout={sampleLayout()}/>);fireEvent.click(screen.getByRole('button',{name:'发布'}));fireEvent.click(screen.getByRole('button',{name:'发评审链接'}));
    act(()=>{epoch++;epoch++;});await act(async()=>finish({url:'https://studio.example/review/old',isCurrent:()=>epoch===token}));
    expect(screen.getByRole('status').textContent).toContain('旧链接未复制');expect(clipboard).not.toHaveBeenCalled();expect(screen.queryByRole('textbox',{name:'评审链接'})).toBeNull();
  });
});

describe('项目大纲', () => {
  it('rolls floors, material categories, zones, and the design book into one outline', () => {
    const outline = planOutline({
      ...sampleLayout(),
      width: 12.5,
      height: 6,
      designBook: { activeId: 'a', variants: [{ id: 'a', name: '方案 A', layout: sampleLayout() }, { id: 'b', name: '方案 B', layout: sampleLayout() }] },
      floors: [
        { id: 'f1', name: '一层', floorColor: '#fff', zones: [{ id: 'z1', name: '签到区', color: '#c4a574', x: 0, z: 0, w: 4, d: 3 }], items: [
          { id: 'desk', type: 'table', category: 'checkin', name: '签到桌', width: 1.6, depth: 0.6, height: 0.75, color: '#c4a574', icon: 'table', position: { x: 0, z: 0 } },
          { id: 'chair', type: 'chair', category: 'seating', name: '椅子', width: 0.5, depth: 0.5, height: 0.8, color: '#8B4513', icon: '🪑', position: { x: 1, z: 1 } },
        ] },
        { id: 'f2', name: '二层', floorColor: '#fff', items: [{ id: 'col', type: 'wall', name: '柱', width: 0.3, depth: 0.3, height: 3, color: '#999', icon: '▥', structuralColumnId: 'col-1' }] },
      ],
    });
    expect(outline.size).toBe('12.5 × 6 m');
    expect(outline.floors).toEqual(['一层', '二层']);
    expect(outline.itemCount).toBe(2);
    expect(outline.categories).toEqual([{ label: '签到', count: 1 }, { label: '座席', count: 1 }]);
    expect(outline.zones).toEqual(['签到区']);
    expect(outline.variants).toEqual([{ name: '方案 A', active: true }, { name: '方案 B', active: false }]);
  });
});

function sampleLayout(): RoomLayout {
  return {
    id: 'project-1',
    name: '发布会',
    width: 12,
    height: 8,
    floors: [{
      id: 'floor', name: '一层', floorColor: '#fff',
      items: [{ id: 'desk', type: 'table', category: 'checkin', name: '签到桌', width: 1.6, depth: 0.6, height: 0.75, color: '#c4a574', icon: 'table', position: { x: 0, z: 0 } }],
    }],
  };
}

