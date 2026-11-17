// @vitest-environment jsdom
import { act,cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RoomLayout } from '../lib/types';
import QRCode from 'qrcode';
import { planOutline, shareAudienceEmptyCopy, shareExportPlan, ShareMenu, type ShareMenuActions } from './share-menu';

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

describe('分享卡片', () => {
  it('opens from the single 分享 control, splits actions by audience, and closes on Escape', () => {
    localStorage.clear();
    render(<ShareMenu actions={actions()} layout={sampleLayout()}/>);
    const trigger = screen.getByRole('button', { name: '分享' });
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(screen.getAllByRole('button', { name: '分享' })).toHaveLength(1);
    fireEvent.click(trigger);
    const dialog = screen.getByRole('dialog', { name: '分享' });
    for (const name of ['发给客户', '送评审方', '内部协作', '方案网页', '发布当前版本', '复制链接', '3D 漫游', '生成漫游链接', '未发布', '未生成漫游', '未送审', '项目大纲']) {
      expect(dialog.textContent).toContain(name);
    }
    expect(dialog.textContent).not.toContain('生成分享链接');
    expect(screen.queryByRole('button', { name: '发评审链接' })).toBeNull();
    expect(screen.queryByRole('button', { name: '导出交接' })).toBeNull();
    expect(screen.getByRole('tab', { name: '发给客户', selected: true })).toBeTruthy();
    expect(dialog.textContent).toContain('12 × 8 m');
    expect(dialog.textContent).toContain('1 件');
    expect(dialog.textContent).toContain('签到');
    fireEvent.click(screen.getByRole('tab', { name: '送评审方' }));
    expect(screen.getByRole('button', { name: '发评审链接' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '发布当前版本' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '生成漫游链接' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '导出交接' })).toBeNull();
    expect(screen.queryByRole('button', { name: '打开资料' })).toBeNull();
    expect(screen.queryByRole('button', { name: '到场清单' })).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: '内部协作' }));
    expect(screen.getByRole('button', { name: '发评审链接' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '导出交接' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '打开资料' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '到场清单' })).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: '分享' })).toBeNull();
  });

  it('switches audience tabs with the keyboard and keeps one aria-selected tab', () => {
    localStorage.clear();
    render(<ShareMenu actions={actions()} layout={sampleLayout()}/>);
    fireEvent.click(screen.getByRole('button', { name: '分享' }));
    const names = ['发给客户', '送评审方', '内部协作'] as const;
    const tab = (name: typeof names[number]) => screen.getByRole('tab', { name });
    const selected = () => names.filter(name => tab(name).getAttribute('aria-selected') === 'true');
    expect(selected()).toEqual(['发给客户']);
    expect(tab('发给客户').tabIndex).toBe(0);
    expect(tab('送评审方').getAttribute('aria-selected')).toBe('false');
    expect(tab('送评审方').tabIndex).toBe(-1);
    expect(tab('内部协作').tabIndex).toBe(-1);
    tab('发给客户').focus();
    fireEvent.keyDown(tab('发给客户'), { key: 'ArrowRight' });
    expect(selected()).toEqual(['送评审方']);
    expect(tab('送评审方').tabIndex).toBe(0);
    expect(document.activeElement).toBe(tab('送评审方'));
    expect(screen.getByRole('button', { name: '发评审链接' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '导出交接' })).toBeNull();
    expect(screen.getByText(shareAudienceEmptyCopy('review').web)).toBeTruthy();
    fireEvent.keyDown(tab('送评审方'), { key: 'ArrowRight' });
    expect(selected()).toEqual(['内部协作']);
    expect(document.activeElement).toBe(tab('内部协作'));
    expect(screen.getByRole('button', { name: '导出交接' })).toBeTruthy();
    fireEvent.keyDown(tab('内部协作'), { key: 'ArrowRight' });
    expect(selected()).toEqual(['发给客户']);
    expect(screen.queryByRole('button', { name: '发评审链接' })).toBeNull();
    fireEvent.keyDown(tab('发给客户'), { key: 'ArrowLeft' });
    expect(selected()).toEqual(['内部协作']);
    fireEvent.keyDown(tab('内部协作'), { key: 'Home' });
    expect(selected()).toEqual(['发给客户']);
    expect(document.activeElement).toBe(tab('发给客户'));
    fireEvent.keyDown(tab('发给客户'), { key: 'End' });
    expect(selected()).toEqual(['内部协作']);
    expect(document.activeElement).toBe(tab('内部协作'));
    fireEvent.keyDown(tab('内部协作'), { key: 'ArrowRight', ctrlKey: true });
    expect(selected()).toEqual(['内部协作']);
    expect(screen.getByRole('dialog', { name: '分享' })).toBeTruthy();
  });

  it('publishes the saved version, draws the QR, and copies the link', async () => {
    localStorage.clear();
    const share = actions();
    const clipboard = vi.fn(async () => undefined);
    Object.assign(navigator, { clipboard: { writeText: clipboard } });
    render(<ShareMenu actions={share} layout={sampleLayout()}/>);
    fireEvent.click(screen.getByRole('button', { name: '分享' }));
    expect(screen.queryByRole('img', { name: '只读方案二维码' })).toBeNull();
    expect(document.querySelector('.sc-publish-aside')).toBeNull();
    expect(screen.getByRole('dialog', { name: '分享' }).classList.contains('is-published')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: '发布当前版本' }));
    expect(await screen.findByRole('img', { name: '只读方案二维码' })).toBeTruthy();
    const aside = document.querySelector('.sc-publish-aside');
    const split = document.querySelector('.sc-publish-split');
    expect(split?.children[0]?.classList.contains('sc-publish-main')).toBe(true);
    expect(split?.children[1]).toBe(aside);
    expect(aside?.contains(screen.getByRole('region', { name: '方案预览' }))).toBe(true);
    expect(aside?.contains(screen.getByRole('img', { name: '发布会 的平面预览' }))).toBe(true);
    expect(aside?.contains(screen.getByRole('img', { name: '只读方案二维码' }))).toBe(true);
    expect(aside?.textContent).toContain('版本 3 · 只读，扫码即看');
    expect(aside?.textContent).toContain('12 × 8 m');
    expect(screen.getByRole('dialog', { name: '分享' }).classList.contains('is-published')).toBe(true);
    expect((screen.getByRole('status')).textContent).toContain('版本 3 链接已生成');
    expect(screen.getByRole('link', { name: '打开方案网页' })).toHaveProperty('href', 'https://studio.example/view/#token');
    fireEvent.click(screen.getByRole('tab', { name: '送评审方' }));
    expect(document.querySelector('.sc-publish-aside')?.contains(screen.getByRole('img', { name: '只读方案二维码' }))).toBe(true);
    expect(document.querySelector('.sc-publish-aside')?.contains(screen.getByRole('region', { name: '方案预览' }))).toBe(true);
    expect(screen.getByRole('button', { name: '发评审链接' })).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: '发给客户' }));
    expect(screen.queryByRole('button', { name: '发评审链接' })).toBeNull();
    expect(screen.getByRole('link', { name: '打开方案网页' })).toHaveProperty('href', 'https://studio.example/view/#token');
    fireEvent.click(screen.getByRole('button', { name: '复制链接' }));
    expect(clipboard).toHaveBeenCalledWith('https://studio.example/view/#token');
    expect(localStorage.getItem('scendance.publishedLink.v1.project-1')).toContain('https://studio.example/view/#token');
    expect(share.onPublish).toHaveBeenCalledOnce();
  });

  it('restores the saved publish link as the right-hand preview and QR', async () => {
    localStorage.clear();
    localStorage.setItem('scendance.publishedLink.v1.project-1', JSON.stringify({ url: 'https://studio.example/view/#saved', revision: 2 }));
    render(<ShareMenu actions={actions()} layout={sampleLayout()}/>);
    fireEvent.click(screen.getByRole('button', { name: '分享' }));
    const aside = (await screen.findByRole('img', { name: '只读方案二维码' })).closest('.sc-publish-aside');
    expect(aside?.contains(screen.getByRole('region', { name: '方案预览' }))).toBe(true);
    expect(aside?.contains(screen.getByRole('img', { name: '发布会 的平面预览' }))).toBe(true);
    expect(aside?.textContent).toContain('版本 2 · 只读，扫码即看');
    expect(screen.getByRole('link', { name: '打开方案网页' })).toHaveProperty('href', 'https://studio.example/view/#saved');
    expect(screen.queryByText(shareAudienceEmptyCopy('client').web)).toBeNull();
    expect(screen.getByRole('dialog', { name: '分享' }).classList.contains('is-published')).toBe(true);
  });

  it('shows the reason when publishing is refused', async () => {
    localStorage.clear();
    const share = actions();
    vi.mocked(share.onPublish).mockRejectedValueOnce(new Error('还有改动没保存，保存后再生成链接。'));
    render(<ShareMenu actions={share} layout={sampleLayout()}/>);
    fireEvent.click(screen.getByRole('button', { name: '分享' }));
    fireEvent.click(screen.getByRole('button', { name: '发布当前版本' }));
    expect((await screen.findByRole('status')).textContent).toContain('保存后再生成');
    expect(screen.queryByRole('img', { name: '只读方案二维码' })).toBeNull();
  });

  it('copies a review link and routes export, materials, and the checklist without a mode switch', async () => {
    localStorage.clear();
    const share = actions();
    const clipboard = vi.fn(async () => undefined);
    Object.assign(navigator, { clipboard: { writeText: clipboard } });
    render(<ShareMenu actions={share} layout={sampleLayout()}/>);
    fireEvent.click(screen.getByRole('button', { name: '分享' }));
    fireEvent.click(screen.getByRole('tab', { name: '送评审方' }));
    fireEvent.click(screen.getByRole('button', { name: '发评审链接' }));
    expect((await screen.findByRole('status')).textContent).toContain('请确认当前活动和方案后复制');
    expect(screen.getByRole('textbox', { name: '评审链接' })).toHaveProperty('value', 'https://studio.example/review/issued');
    expect(clipboard).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'复制评审链接'}));
    expect(clipboard).toHaveBeenCalledWith('https://studio.example/review/issued');
    fireEvent.click(screen.getByRole('tab', { name: '内部协作' }));
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
  it('never copies a link whose activity changes before the async result returns',async()=>{
    const share=actions(),clipboard=vi.fn(async()=>undefined);Object.assign(navigator,{clipboard:{writeText:clipboard}});
    let finish!:(value:{url:string;isCurrent:()=>boolean})=>void,epoch=0;const token=epoch;
    vi.mocked(share.onIssueReviewLink).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
    render(<ShareMenu actions={share} layout={sampleLayout()}/>);fireEvent.click(screen.getByRole('button',{name:'分享'}));fireEvent.click(screen.getByRole('tab',{name:'送评审方'}));fireEvent.click(screen.getByRole('button',{name:'发评审链接'}));
    act(()=>{epoch++;epoch++;});await act(async()=>finish({url:'https://studio.example/review/old',isCurrent:()=>epoch===token}));
    expect(screen.getByRole('status').textContent).toContain('旧链接未复制');expect(clipboard).not.toHaveBeenCalled();expect(screen.queryByRole('textbox',{name:'评审链接'})).toBeNull();
  });

  it('generates a walkthrough link, then copies, opens, and regenerates it', async () => {
    localStorage.clear();
    const share = actions();
    share.onGenerateShareLink = vi.fn(async () => ({ url: 'https://studio.example/view#s1=abc', name: '发布会', objects: 4, droppedAssets: 0 }));
    const clipboard = vi.fn(async () => undefined);
    Object.assign(navigator, { clipboard: { writeText: clipboard } });
    render(<ShareMenu actions={share} layout={sampleLayout()}/>);
    fireEvent.click(screen.getByRole('button', { name: '分享' }));
    expect((screen.getByRole('button', { name: '复制漫游链接' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: '打开漫游' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: '重新生成漫游链接' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '生成漫游链接' }));
    expect(await screen.findByRole('link', { name: '打开漫游' })).toHaveProperty('href', 'https://studio.example/view#s1=abc');
    expect(screen.getByRole('button', { name: '生成漫游链接' })).toBeTruthy();
    expect((screen.getByRole('button', { name: '重新生成漫游链接' }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByRole('status').textContent).toContain('4 件物件');
    expect(screen.getByText('已生成 · 4 件物件')).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: '送评审方' }));
    expect(screen.getByRole('link', { name: '打开漫游' })).toHaveProperty('href', 'https://studio.example/view#s1=abc');
    fireEvent.click(screen.getByRole('tab', { name: '发给客户' }));
    fireEvent.click(screen.getByRole('button', { name: '复制漫游链接' }));
    expect(clipboard).toHaveBeenCalledWith('https://studio.example/view#s1=abc');
    fireEvent.click(screen.getByRole('button', { name: '重新生成漫游链接' }));
    expect(share.onGenerateShareLink).toHaveBeenCalledTimes(2);
  });

  it('keeps 方案网页 and the four walkthrough actions in every audience column', () => {
    localStorage.clear();
    render(<ShareMenu actions={actions()} layout={sampleLayout()}/>);
    fireEvent.click(screen.getByRole('button', { name: '分享' }));
    const names = ['发布当前版本', '复制链接', '打开方案网页', '生成漫游链接', '复制漫游链接', '打开漫游', '重新生成漫游链接'];
    for (const tab of ['发给客户', '送评审方', '内部协作']) {
      fireEvent.click(screen.getByRole('tab', { name: tab }));
      for (const name of names) expect(screen.getByRole('button', { name })).toBeTruthy();
      expect(screen.queryByRole('region', { name: '导出资料' })).toBeNull();
    }
    fireEvent.click(screen.getByRole('tab', { name: '发给客户' }));
    expect(screen.queryByRole('button', { name: '发评审链接' })).toBeNull();
    expect(screen.queryByRole('button', { name: '到场清单' })).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: '送评审方' }));
    expect(screen.getByRole('button', { name: '发评审链接' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '打开资料' })).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: '内部协作' }));
    expect(screen.getByRole('button', { name: '发评审链接' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '导出交接' })).toBeTruthy();
    expect(screen.getByRole('region', { name: '方案网页' })).toBeTruthy();
    expect(screen.getByRole('region', { name: '3D 漫游' })).toBeTruthy();
    expect(screen.getByRole('region', { name: '分享链路状态' }).textContent).toContain('未送审');
  });

  it('exports the checked PNG, CSV, and GeoJSON items from one button', () => {
    localStorage.clear();
    const share = actions();
    share.onExportImage = vi.fn(async () => true);
    share.onExportCsv = vi.fn();
    share.onExportGeoJson = vi.fn();
    share.onPrintDeck = vi.fn();
    render(<ShareMenu actions={share} layout={sampleLayout()}/>);
    fireEvent.click(screen.getByRole('button', { name: '分享' }));
    expect((screen.getByRole('checkbox', { name: 'PNG' }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole('checkbox', { name: 'CSV' }) as HTMLInputElement).checked).toBe(false);
    expect((screen.getByRole('checkbox', { name: 'GeoJSON' }) as HTMLInputElement).checked).toBe(false);
    expect(screen.getByRole('button', { name: '导出演示稿 PDF' })).toBeTruthy();
    fireEvent.click(screen.getByRole('checkbox', { name: 'PNG' }));
    expect((screen.getByRole('button', { name: '导出 0 项资料' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('checkbox', { name: 'PNG' }));
    fireEvent.click(screen.getByRole('tab', { name: '送评审方' }));
    expect(screen.queryByRole('checkbox', { name: 'PNG' })).toBeNull();
    expect(screen.queryByRole('button', { name: '导出演示稿 PDF' })).toBeNull();
    expect(screen.queryByRole('button', { name: '导出 1 项资料' })).toBeNull();
    expect(screen.getByRole('button', { name: '发布当前版本' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '生成漫游链接' })).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: '内部协作' }));
    expect((screen.getByRole('checkbox', { name: 'PNG' }) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByRole('button', { name: '导出交接' })).toBeTruthy();
    fireEvent.click(screen.getByRole('checkbox', { name: 'CSV' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'GeoJSON' }));
    fireEvent.click(screen.getByRole('button', { name: '导出 3 项资料' }));
    expect(share.onExportImage).toHaveBeenCalledOnce();
    expect(share.onExportCsv).toHaveBeenCalledOnce();
    expect(share.onExportGeoJson).toHaveBeenCalledOnce();
    expect(share.onPrintDeck).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog', { name: '分享' })).toBeNull();
  });
});

describe('三受众空态', () => {
  it('explains the unpublished page and the missing walkthrough, then clears each line once it exists', async () => {
    localStorage.clear();
    const share = actions();
    share.onGenerateShareLink = vi.fn(async () => ({ url: 'https://studio.example/view#s1=abc', name: '发布会', objects: 4, droppedAssets: 0 }));
    render(<ShareMenu actions={share} layout={sampleLayout()}/>);
    fireEvent.click(screen.getByRole('button', { name: '分享' }));
    const client = shareAudienceEmptyCopy('client');
    const review = shareAudienceEmptyCopy('review');
    const internal = shareAudienceEmptyCopy('internal');
    expect(screen.getByText(client.web)).toBeTruthy();
    expect(screen.getByText(client.walk)).toBeTruthy();
    expect(screen.getByText('未生成漫游')).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: '送评审方' }));
    expect(screen.getByText(review.web)).toBeTruthy();
    expect(screen.getByText(review.walk)).toBeTruthy();
    expect(screen.queryByText(client.web)).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: '内部协作' }));
    expect(screen.getByText(internal.web)).toBeTruthy();
    expect(screen.getByText(internal.walk)).toBeTruthy();
    expect(screen.queryByText(review.walk)).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: '发给客户' }));
    fireEvent.click(screen.getByRole('button', { name: '发布当前版本' }));
    expect(await screen.findByRole('img', { name: '只读方案二维码' })).toBeTruthy();
    expect(screen.queryByText(client.web)).toBeNull();
    expect(screen.getByText(client.walk)).toBeTruthy();
    expect(screen.getByRole('region', { name: '分享链路状态' }).textContent).toContain('已分享 v3');
    expect(screen.getByRole('region', { name: '分享链路状态' }).textContent).not.toContain('未发布');
    fireEvent.click(screen.getByRole('button', { name: '生成漫游链接' }));
    expect(await screen.findByRole('link', { name: '打开漫游' })).toBeTruthy();
    expect(screen.queryByText(client.walk)).toBeNull();
    expect(screen.getByText('已生成 · 4 件物件')).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: '送评审方' }));
    expect(screen.queryByText(review.web)).toBeNull();
    expect(screen.queryByText(review.walk)).toBeNull();
  });
});

describe('分享导出接到既有文件', () => {
  it('uses the plan snapshot on the 2D map and keeps file exports in 3D when a plan exists', () => {
    expect(shareExportPlan({ outdoor2D: true, outdoor3d: false, hasPlan: true })).toEqual({ png: 'plan', files: true });
    expect(shareExportPlan({ outdoor2D: true, outdoor3d: false, hasPlan: false })).toEqual({ png: 'plan', files: true });
    expect(shareExportPlan({ outdoor2D: false, outdoor3d: true, hasPlan: true })).toEqual({ png: 'frame3d', files: true });
    expect(shareExportPlan({ outdoor2D: false, outdoor3d: true, hasPlan: false })).toEqual({ png: 'frame3d', files: false });
    expect(shareExportPlan({ outdoor2D: false, outdoor3d: false, hasPlan: false })).toEqual({ png: 'indoor', files: false });
    expect(shareExportPlan({ outdoor2D: false, outdoor3d: false, hasPlan: true })).toEqual({ png: 'indoor', files: true });
  });
});

describe('分享二维码占位与失败', () => {
  it('shows a placeholder while the code is drawing, then the code itself', async () => {
    localStorage.clear();
    let release!: (svg: string) => void;
    const spy = vi.spyOn(QRCode, 'toString').mockImplementationOnce(
      () => new Promise(resolve => { release = resolve; }),
    );
    try {
      render(<ShareMenu actions={actions()} layout={sampleLayout()}/>);
      fireEvent.click(screen.getByRole('button', { name: '分享' }));
      fireEvent.click(screen.getByRole('button', { name: '发布当前版本' }));
      expect(await screen.findByText('正在生成二维码。')).toBeTruthy();
      expect(document.querySelector('.sc-publish-qr-frame.is-pending')).toBeTruthy();
      expect(screen.queryByRole('img', { name: '只读方案二维码' })).toBeNull();
      await act(async () => { release('<svg xmlns="http://www.w3.org/2000/svg"></svg>'); });
      expect(await screen.findByRole('img', { name: '只读方案二维码' })).toBeTruthy();
      expect(screen.queryByText('正在生成二维码。')).toBeNull();
      expect(screen.getByText('版本 3 · 只读，扫码即看')).toBeTruthy();
    } finally {
      spy.mockRestore();
    }
  });

  it('keeps the published link when drawing fails, and redraws locally', async () => {
    localStorage.clear();
    const share = actions();
    const clipboard = vi.fn(async () => undefined);
    Object.assign(navigator, { clipboard: { writeText: clipboard } });
    let release!: (svg: string) => void;
    const spy = vi.spyOn(QRCode, 'toString')
      .mockRejectedValueOnce(new Error('The amount of data is too big to be stored in a QR Code'))
      .mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    try {
      render(<ShareMenu actions={share} layout={sampleLayout()}/>);
      fireEvent.click(screen.getByRole('button', { name: '分享' }));
      fireEvent.click(screen.getByRole('button', { name: '发布当前版本' }));
      expect(await screen.findByText('二维码没有生成。链接可以复制或打开。')).toBeTruthy();
      expect(screen.getByRole('status').textContent).toContain('二维码没有生成，可以复制或打开');
      expect(document.querySelector('.sc-publish-qr-frame.is-failed')).toBeTruthy();
      expect(screen.queryByRole('img', { name: '只读方案二维码' })).toBeNull();
      expect(screen.getByRole('link', { name: '打开方案网页' })).toHaveProperty('href', 'https://studio.example/view/#token');
      fireEvent.click(screen.getByRole('button', { name: '复制链接' }));
      expect(clipboard).toHaveBeenCalledWith('https://studio.example/view/#token');
      fireEvent.click(screen.getByRole('button', { name: '再画一次' }));
      expect(share.onPublish).toHaveBeenCalledOnce();
      expect(await screen.findByText('正在生成二维码。')).toBeTruthy();
      await act(async () => { release('<svg xmlns="http://www.w3.org/2000/svg"></svg>'); });
      expect(await screen.findByRole('img', { name: '只读方案二维码' })).toBeTruthy();
      expect(screen.queryByRole('button', { name: '再画一次' })).toBeNull();
      expect(share.onPublish).toHaveBeenCalledOnce();
      expect(spy).toHaveBeenCalledTimes(2);
    } finally {
      spy.mockRestore();
    }
  });

  it('treats a blank drawing as a failure', async () => {
    localStorage.clear();
    const share = actions();
    const spy = vi.spyOn(QRCode, 'toString').mockResolvedValueOnce('   ' as never);
    try {
      render(<ShareMenu actions={share} layout={sampleLayout()}/>);
      fireEvent.click(screen.getByRole('button', { name: '分享' }));
      fireEvent.click(screen.getByRole('button', { name: '发布当前版本' }));
      expect(await screen.findByText('二维码没有生成。链接可以复制或打开。')).toBeTruthy();
      expect(screen.queryByRole('img', { name: '只读方案二维码' })).toBeNull();
      expect(share.onPublish).toHaveBeenCalledOnce();
    } finally {
      spy.mockRestore();
    }
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

  it('converts the outline size to feet when the display unit is ft', () => {
    const outline = planOutline({ ...sampleLayout(), width: 12.5, height: 6 }, 'ft');
    expect(outline.size).toBe('41.0 × 19.7 ft');
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

