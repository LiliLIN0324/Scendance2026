// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { planOutline, ShareMenu, shareBingoStatus, sharePublishReadOnly, shareTriggerChrome, type ShareMenuActions } from './share-menu';
import { displayShareUrl, SHARE_READ_ONLY_LINE, SharePanel, type ShareExportEntry } from './share-panel';
import type { ServerShare } from '../lib/share-records';
import type { RoomLayout } from '../lib/types';

afterEach(cleanup);

function actions(extra: Partial<ShareMenuActions> = {}): ShareMenuActions {
  return {
    onIssueReviewLink: vi.fn(async () => ({ url: 'https://studio.example/review/issued', isCurrent: () => true })),
    onPublish: vi.fn(async () => ({ url: 'https://studio.example/view/#token', revision: 3 })),
    onExportHandoff: vi.fn(),
    onOpenMaterials: vi.fn(),
    onOpenChecklist: vi.fn(),
    ...extra,
  };
}

function openMenu(): HTMLElement {
  fireEvent.click(screen.getByRole('button', { name: '分享' }));
  return screen.getByRole('dialog', { name: '分享、发布与导出' });
}

describe('分享钮', () => {
  it('stays a white line-art key and only greens the frame while open', () => {
    localStorage.clear();
    render(<ShareMenu actions={actions()} layout={sampleLayout()} />);
    const trigger = screen.getByRole('button', { name: '分享' });
    expect(trigger.getAttribute('data-share-chrome')).toBe('closed');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(screen.getAllByRole('button', { name: '分享' })).toHaveLength(1);
    expect(trigger.querySelector('svg')).toBeTruthy();
    expectChrome(trigger, false);
    fireEvent.click(trigger);
    expect(trigger.getAttribute('data-share-chrome')).toBe('open');
    expectChrome(trigger, true);
    expect(trigger.style.backgroundColor.toLowerCase()).not.toMatch(/4a7c59|74,\s*124,\s*89/);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: '分享、发布与导出' })).toBeNull();
    expect(trigger.getAttribute('data-share-chrome')).toBe('closed');
  });

  it('describes the two chrome states without a green fill', () => {
    expect(shareTriggerChrome(false)).toMatchObject({
      width: 32, height: 32, borderRadius: 8, backgroundColor: '#FFFFFF', color: '#55585F', borderWidth: 0.6, borderColor: '#E4E4E7',
    });
    expect(shareTriggerChrome(true)).toMatchObject({
      backgroundColor: '#FFFFFF', color: '#4A7C59', borderWidth: 1.2, borderColor: '#4A7C59',
    });
  });
});

describe('分享页签', () => {
  it('opens on 分享 with the audience row and Bingo only', () => {
    localStorage.clear();
    render(<ShareMenu actions={actions()} layout={sampleLayout()} />);
    const dialog = openMenu();
    expect(screen.getByRole('tab', { name: '分享' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tab', { name: '分享' }).getAttribute('data-tone')).toBe('ink');
    expect(screen.getByRole('tab', { name: '发布' }).getAttribute('data-tone')).toBe('quiet');
    expect(dialog.textContent).toContain('发布会');
    expect(dialog.textContent).toContain('打开即可查看场地、分区和尺度，页里可看 3D。');
    const audience = screen.getByRole('button', { name: '发给谁' });
    const bingo = screen.getByRole('button', { name: /送到 Bingo/ });
    expect(audience.className).toContain('sc-share-row');
    expect(bingo.className).toContain('sc-share-row');
    expect(audience.textContent).toContain('送评审方');
    expect(audience.querySelector('.sc-share-row-status')?.textContent).toBe('可批注');
    expect(bingo.querySelector('.sc-share-row-label')?.textContent).toBe('送到 Bingo');
    expect(bingo.querySelector('.sc-share-row-status')?.textContent).toBe('待发');
    expect(audience.getAttribute('data-align')).toBe('start');
    expect(bingo.getAttribute('data-align')).toBe('start');
    expect(dialog.querySelector('img, .sc-publish-plan')).toBeNull();
    expect(dialog.textContent).not.toMatch(/方案预览|生成分享链接|3D 漫游|分享记录|密码|过期/);
  });

  it('copies the review link for 发给谁 and marks Bingo sent', async () => {
    localStorage.clear();
    const share = actions();
    const clipboard = vi.fn(async () => undefined);
    Object.assign(navigator, { clipboard: { writeText: clipboard } });
    render(<ShareMenu actions={share} layout={sampleLayout()} />);
    openMenu();
    fireEvent.click(screen.getByRole('button', { name: '发给谁' }));
    expect((await screen.findByRole('status')).textContent).toContain('评审链接已复制');
    expect(clipboard).toHaveBeenCalledWith('https://studio.example/review/issued');
    expect(screen.getByRole('button', { name: /送到 Bingo/ }).querySelector('.sc-share-row-status')?.textContent).toBe('待评');
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(share.onIssueReviewLink).toHaveBeenCalledOnce();
  });

  it('never copies a review link whose activity changes before the result returns', async () => {
    const share = actions();
    const clipboard = vi.fn(async () => undefined);
    Object.assign(navigator, { clipboard: { writeText: clipboard } });
    let finish!: (value: { url: string; isCurrent: () => boolean }) => void;
    let epoch = 0;
    const token = epoch;
    vi.mocked(share.onIssueReviewLink).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    render(<ShareMenu actions={share} layout={sampleLayout()} />);
    openMenu();
    fireEvent.click(screen.getByRole('button', { name: /送到 Bingo/ }));
    act(() => { epoch += 1; });
    await act(async () => finish({ url: 'https://studio.example/review/old', isCurrent: () => epoch === token }));
    expect(screen.getByRole('status').textContent).toContain('旧链接未复制');
    expect(clipboard).not.toHaveBeenCalled();
    expect(screen.getByText('待发')).toBeTruthy();
  });
});

describe('发布页签', () => {
  it('shows only the green publish action until a link exists', () => {
    localStorage.clear();
    render(<ShareMenu actions={actions()} layout={sampleLayout()} />);
    openMenu();
    fireEvent.click(screen.getByRole('tab', { name: '发布' }));
    const publish = screen.getByRole('tab', { name: '发布' });
    expect(publish.getAttribute('aria-selected')).toBe('true');
    expect(publish.getAttribute('data-tone')).toBe('ink');
    const cta = screen.getByRole('button', { name: '发布并复制链接' });
    expect(cta.getAttribute('data-tone')).toBe('green');
    expect(screen.getByText('发布后即可查看场地、分区和尺度，页里可看 3D。')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^复制$/ })).toBeNull();
    expect(screen.queryByRole('button', { name: '二维码' })).toBeNull();
    expect(screen.queryByRole('img', { name: '方案二维码' })).toBeNull();
    const panel = screen.getByTestId('share-panel');
    expect(panel.querySelector('img, .sc-publish-plan')).toBeNull();
  });

  it('publishes, copies the real url, and keeps copy plus the QR key on the link row', async () => {
    localStorage.clear();
    const share = actions();
    const clipboard = vi.fn(async () => undefined);
    Object.assign(navigator, { clipboard: { writeText: clipboard } });
    render(<ShareMenu actions={share} layout={sampleLayout()} />);
    openMenu();
    fireEvent.click(screen.getByRole('tab', { name: '发布' }));
    fireEvent.click(screen.getByRole('button', { name: '发布并复制链接' }));
    expect(await screen.findByRole('button', { name: /^复制$/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '发布并复制链接' })).toBeNull();
    expect(screen.getByText('打开即可查看场地、分区和尺度，页里可看 3D。')).toBeTruthy();
    expect(screen.getByTestId('share-link-row').textContent).toContain('studio.example/view/#token');
    const qr = screen.getByRole('button', { name: '二维码' });
    expect(qr.getAttribute('data-tone')).toBe('paper');
    expect(screen.getByRole('button', { name: /^复制$/ }).getAttribute('data-tone')).toBe('paper');
    expect(screen.queryByRole('img', { name: '方案二维码' })).toBeNull();
    expect(screen.queryByText('扫码打开')).toBeNull();
    fireEvent.click(qr);
    expect(await screen.findByRole('img', { name: '方案二维码' })).toBeTruthy();
    expect(clipboard).toHaveBeenCalledWith('https://studio.example/view/#token');
    fireEvent.click(screen.getByRole('button', { name: /^复制$/ }));
    expect(clipboard).toHaveBeenCalledTimes(2);
    expect(localStorage.getItem('scendance.publishedLink.v1.project-1')).toContain('https://studio.example/view/#token');
    expect(localStorage.getItem('scendance.shareLog.v1.project-1')).toContain('https://studio.example/view/#token');
    expect(share.onPublish).toHaveBeenCalledOnce();
    expect(screen.getByTestId('share-panel').querySelector('.sc-publish-plan')).toBeNull();
  });

  it('hands out the site page when the publish returns one, keeping the cloud revision behind it', async () => {
    localStorage.clear();
    const share = actions();
    vi.mocked(share.onPublish).mockResolvedValueOnce({
      url: 'https://studio.example/view/#token',
      revision: 4,
      siteUrl: 'https://studio.example/site#s2=1.abc123',
    });
    const clipboard = vi.fn(async () => undefined);
    Object.assign(navigator, { clipboard: { writeText: clipboard } });
    render(<ShareMenu actions={share} layout={sampleLayout()} />);
    openMenu();
    fireEvent.click(screen.getByRole('tab', { name: '发布' }));
    fireEvent.click(screen.getByRole('button', { name: '发布并复制链接' }));
    expect(await screen.findByRole('button', { name: /^复制$/ })).toBeTruthy();
    expect(screen.getByTestId('share-link-row').textContent).toContain('studio.example/site#s2=1.abc');
    expect(screen.getByText('打开即可查看场地轮廓、分区和尺度，只读、无需登录。')).toBeTruthy();
    expect(screen.queryByText('打开即可查看场地、分区和尺度，页里可看 3D。')).toBeNull();
    expect(clipboard).toHaveBeenCalledWith('https://studio.example/site#s2=1.abc123');
    fireEvent.click(screen.getByRole('button', { name: /^复制$/ }));
    expect(clipboard).toHaveBeenLastCalledWith('https://studio.example/site#s2=1.abc123');
    expect(localStorage.getItem('scendance.publishedLink.v1.project-1')).toContain('https://studio.example/site#s2=1.abc123');
    expect(localStorage.getItem('scendance.shareLog.v1.project-1')).toContain('https://studio.example/site#s2=1.abc123');
  });

  it('restores a saved link as the published row and drops it when the server revoked that revision', async () => {
    localStorage.clear();
    localStorage.setItem('scendance.publishedLink.v1.project-1', JSON.stringify({
      url: 'https://scendance.lilicoding.space/s/abc123def4567890extra',
      revision: 2,
    }));
    let finish!: (rows: ServerShare[]) => void;
    const share = actions({
      onListShares: vi.fn<() => Promise<ServerShare[]>>(() => new Promise(resolve => { finish = resolve; })),
    });
    render(<ShareMenu actions={share} layout={sampleLayout()} />);
    openMenu();
    fireEvent.click(screen.getByRole('tab', { name: '发布' }));
    expect(screen.getByTestId('share-link-row').textContent).toContain('scendance.lilicoding.space/s/abc…');
    expect(screen.getByRole('button', { name: '二维码' })).toBeTruthy();
    expect(screen.queryByRole('img', { name: '方案二维码' })).toBeNull();
    expect(screen.queryByRole('button', { name: '发布并复制链接' })).toBeNull();
    await act(async () => finish([{ shareId: 'sh-1', publicationId: 'pub-1', revision: 2, createdAt: '2026-11-17T04:12:00Z', revokedAt: '2026-11-17T05:00:00Z' }]));
    expect(screen.getByRole('button', { name: '发布并复制链接' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '二维码' })).toBeNull();
    expect(screen.getByRole('status').textContent).toContain('已撤回');
    expect(localStorage.getItem('scendance.publishedLink.v1.project-1')).toBeNull();
  });

  it('shows the reason when publishing is refused', async () => {
    localStorage.clear();
    const share = actions();
    vi.mocked(share.onPublish).mockRejectedValueOnce(new Error('还有改动没保存，保存后再发布。'));
    render(<ShareMenu actions={share} layout={sampleLayout()} />);
    openMenu();
    fireEvent.click(screen.getByRole('tab', { name: '发布' }));
    fireEvent.click(screen.getByRole('button', { name: '发布并复制链接' }));
    expect((await screen.findByRole('status')).textContent).toContain('保存后再发布');
    expect(screen.queryByRole('button', { name: '二维码' })).toBeNull();
    expect(screen.getByRole('button', { name: '发布并复制链接' })).toBeTruthy();
  });
});

describe('导出页签', () => {
  it('lists only the export actions the workbench already provides', () => {
    localStorage.clear();
    const share = actions({
      onExportImage: vi.fn(async () => true),
      onExportCsv: vi.fn(),
      onExportGeoJson: vi.fn(),
    });
    render(<ShareMenu actions={share} layout={sampleLayout()} />);
    openMenu();
    fireEvent.click(screen.getByRole('tab', { name: '导出' }));
    expect(screen.getByRole('tab', { name: '导出' }).getAttribute('data-tone')).toBe('ink');
    for (const name of ['效果图', '物料清单', '场地范围文件']) {
      expect(screen.getByRole('button', { name })).toBeTruthy();
    }
    expect(screen.queryByRole('button', { name: '导出交接' })).toBeNull();
    expect(screen.queryByRole('button', { name: '到场清单' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '物料清单' }));
    expect(share.onExportCsv).toHaveBeenCalledOnce();
    expect(screen.queryByRole('dialog', { name: '分享、发布与导出' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '分享' }));
    fireEvent.click(screen.getByRole('tab', { name: '导出' }));
    fireEvent.click(screen.getByRole('button', { name: '效果图' }));
    expect(share.onExportImage).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: '分享' }));
    fireEvent.click(screen.getByRole('tab', { name: '导出' }));
    fireEvent.click(screen.getByRole('button', { name: '场地范围文件' }));
    expect(share.onExportGeoJson).toHaveBeenCalledOnce();
  });

  it('does not invent an export row when that callback is absent', () => {
    localStorage.clear();
    render(<ShareMenu actions={actions({ onExportImage: vi.fn(async () => true) })} layout={sampleLayout()} />);
    openMenu();
    fireEvent.click(screen.getByRole('tab', { name: '导出' }));
    expect(screen.getByRole('button', { name: '效果图' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '物料清单' })).toBeNull();
    expect(screen.queryByRole('button', { name: '场地范围文件' })).toBeNull();
  });
});

describe('链接展示', () => {
  it('drops the protocol and truncates a long host path', () => {
    expect(displayShareUrl('https://studio.example/view/#token')).toBe('studio.example/view/#token');
    expect(displayShareUrl('https://scendance.lilicoding.space/s/abc123def4567890extra')).toBe('scendance.lilicoding.space/s/abc…');
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

describe('发布页只读', () => {
  it('hides the green publish CTA and keeps the read-only line', () => {
    localStorage.clear();
    render(<ShareMenu actions={actions({ readOnly: true })} layout={sampleLayout()} />);
    openMenu();
    fireEvent.click(screen.getByRole('tab', { name: '发布' }));
    expect(screen.getByTestId('share-readonly').textContent).toBe(SHARE_READ_ONLY_LINE);
    expect(screen.queryByRole('button', { name: '发布并复制链接' })).toBeNull();
    expect(document.querySelector('.sc-share-cta')).toBeNull();
    expect(document.querySelector('[data-tone="green"]')).toBeNull();
  });

  it('drops the enabled green CTA once publish reports the read-only line', async () => {
    localStorage.clear();
    const share = actions();
    vi.mocked(share.onPublish).mockRejectedValueOnce(new Error(SHARE_READ_ONLY_LINE));
    render(<ShareMenu actions={share} layout={sampleLayout()} />);
    openMenu();
    fireEvent.click(screen.getByRole('tab', { name: '发布' }));
    fireEvent.click(screen.getByRole('button', { name: '发布并复制链接' }));
    expect((await screen.findByTestId('share-readonly')).textContent).toBe(SHARE_READ_ONLY_LINE);
    expect(screen.queryByRole('button', { name: '发布并复制链接' })).toBeNull();
    const cta = document.querySelector('.sc-share-cta');
    expect(cta).toBeNull();
  });

  it('treats a signed-in project without edit rights as read-only, and not a signed-out canvas', () => {
    const user = { is_anonymous: false };
    expect(sharePublishReadOnly({ configured: true, user, project: { id: 'project-1' }, writeBlocked: true }, 'project-1')).toBe(true);
    expect(sharePublishReadOnly({ configured: true, user: null, project: null, writeBlocked: true }, 'project-1')).toBe(false);
    expect(sharePublishReadOnly({ configured: false, user, project: { id: 'project-1' }, writeBlocked: true })).toBe(false);
    expect(sharePublishReadOnly({ configured: true, user: { is_anonymous: true }, project: { id: 'project-1' }, writeBlocked: true })).toBe(false);
    expect(sharePublishReadOnly({ configured: true, user, project: null, writeBlocked: true })).toBe(false);
  });
});

describe('Bingo 状态', () => {
  it('uses 待评 and 已回执 from the project record instead of a separate 已送 chip', () => {
    const shareId = '11111111-1111-4111-8111-111111111111';
    const storage = bucket();
    expect(shareBingoStatus('project-1', false, storage)).toBe('待发');
    expect(shareBingoStatus('project-1', true, storage)).toBe('待评');
    storage.set('scendance.reviewMark.v1', [mark(shareId, { projectKey: 'project-1' })]);
    expect(shareBingoStatus('project-1', false, storage)).toBe('待评');
    storage.set('scendance-review-share-return-v1', { version: 1, planKey: shareId, at: '2026-10-31T08:00:00.000Z' });
    expect(shareBingoStatus('project-1', true, storage)).toBe('已回执');
    expect(shareBingoStatus('other-project', false, storage)).toBe('待发');
  });
});

describe('弹层对齐与阴影', () => {
  const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../../app/globals.css'), 'utf8');
  const panelStart = css.indexOf('/* 分享 / 发布 / 导出：宽约 400');
  const panelEnd = css.indexOf('/* 左下「设置」小弹层');
  const panelCss = css.slice(panelStart, panelEnd);

  it('groups the globe with 发布到网页 on the left, not space-between', () => {
    localStorage.clear();
    render(<ShareMenu actions={actions()} layout={sampleLayout()} />);
    openMenu();
    fireEvent.click(screen.getByRole('tab', { name: '发布' }));
    const heading = document.querySelector('#share-panel-publish .sc-share-heading');
    const lock = heading?.querySelector('.sc-share-titlelock');
    expect(heading?.getAttribute('data-layout')).toBe('grouped');
    expect(heading?.children).toHaveLength(1);
    expect(lock?.querySelector('svg')).toBeTruthy();
    expect(lock?.querySelector('h2')?.textContent).toBe('发布到网页');
    expect(panelCss).toMatch(/\.sc-share-heading\s*\{[^}]*justify-content:\s*flex-start/);
    expect(panelCss).toMatch(/\.sc-share-titlelock\s*\{[^}]*justify-content:\s*flex-start[^}]*gap:\s*4px/);
    expect(panelCss).not.toMatch(/\.sc-share-heading\s*\{[^}]*space-between/);
    expect(panelCss).not.toMatch(/\.sc-share-titlelock\s*\{[^}]*space-between/);
  });

  it('left-aligns export rows with the tab bar', () => {
    const entries: ShareExportEntry[] = [
      { id: 'render', label: '效果图', icon: 'image', onSelect: vi.fn() },
      { id: 'materials', label: '物料清单', icon: 'list', onSelect: vi.fn() },
      { id: 'site', label: '场地范围文件', icon: 'site', onSelect: vi.fn() },
    ];
    render(<div className="sc-workbench"><div className="sc-tool-column"><div className="oc-cluster oc-tr">
      <SharePanel {...panelProps({ tab: 'export', exports: entries })} />
    </div></div></div>);
    const list = document.querySelector('.sc-share-exports');
    expect(list?.getAttribute('data-align')).toBe('start');
    const rows = screen.getAllByRole('button', { name: /效果图|物料清单|场地范围文件/ });
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row.className).toContain('sc-share-export');
      expect(row.getAttribute('data-align')).toBe('start');
      expect(row.querySelector('svg')).toBeTruthy();
    }
    expect(panelCss).toMatch(/button\.sc-share-export\s*\{[^}]*justify-content:\s*flex-start/);
    expect(panelCss).toMatch(/button\.sc-share-export\s*\{[^}]*height:\s*36px/);
    expect(panelCss).toMatch(/\.sc-share-exports li \+ li\s*\{[^}]*border-top:\s*1px solid/);
  });

  it('keeps a two-family ink shadow clearly stronger than a 0.08 single layer', () => {
    const shadow = panelCss.match(/box-shadow:\s*([\s\S]*?);/)?.[1]?.replace(/\s+/g, ' ').trim() ?? '';
    const layers = shadowLayers(shadow);
    expect(layers.length).toBeGreaterThanOrEqual(2);
    const alphas = layers.map(layerAlpha);
    expect(Math.max(...alphas)).toBeGreaterThan(0.4);
    expect(alphas.every(alpha => alpha > 0.2)).toBe(true);
    expect(shadow).not.toMatch(/var\(--e1\)|rgba\(0,\s*0,\s*0|rgba\(20,\s*20,\s*22,\s*0?\.0*8\)/);
    for (const layer of layers) expect(layer).toMatch(/rgba\(20,\s*20,\s*22,/);
    const contact = layers.find(layer => /1\.2px/.test(layer));
    const lift = layers.find(layer => /18px/.test(layer));
    expect(contact).toBeTruthy();
    expect(lift).toBeTruthy();
    expect(layerAlpha(contact ?? '')).toBeGreaterThanOrEqual(0.55);
    expect(layerAlpha(lift ?? '')).toBeGreaterThanOrEqual(0.4);
  });

  it('still left-aligns the title and export rows when cluster CSS centers buttons', () => {
    const hostile = document.createElement('style');
    hostile.textContent = `
      .sc-share-heading { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
      .sc-workbench .sc-tool-column .oc-cluster button { display: inline-flex; align-items: center; justify-content: center; }
      .sc-workbench .sc-tool-column .oc-cluster.oc-tr button > span { width: 22px; height: 22px; }
      .sc-workbench .sc-tool-pop { box-shadow: 0 6px 18px rgba(20, 20, 22, 0.08); }
      ${panelCss}
    `;
    document.head.appendChild(hostile);
    try {
      const entries: ShareExportEntry[] = [
        { id: 'render', label: '效果图', icon: 'image', onSelect: vi.fn() },
      ];
      render(<div className="sc-workbench"><div className="sc-tool-column"><div className="oc-cluster oc-tr">
        <SharePanel {...panelProps({ tab: 'publish' })} />
        <SharePanel {...panelProps({ tab: 'export', exports: entries })} />
      </div></div></div>);
      const heading = document.querySelector('#share-panel-publish .sc-share-heading') as HTMLElement;
      const panel = document.querySelector('#share-panel-publish')?.closest('[data-testid="share-panel"]') as HTMLElement;
      expect(getComputedStyle(heading).justifyContent).toMatch(/flex-start|start/);
      const painted = getComputedStyle(panel).boxShadow;
      expect(painted.length).toBeGreaterThan(8);
      expect(painted).toMatch(/20,\s*20,\s*22|20 20 22/);
      expect(painted).not.toMatch(/0\.08/);
      const row = screen.getByRole('button', { name: '效果图' });
      const label = row.querySelector('span') as HTMLElement;
      expect(getComputedStyle(row).justifyContent).toMatch(/flex-start|start/);
      expect(getComputedStyle(label).width).not.toBe('22px');
    } finally {
      hostile.remove();
    }
  });
});

function shadowLayers(value: string): string[] {
  const layers: string[] = [];
  let current = '';
  let depth = 0;
  for (const char of value) {
    if (char === '(') depth += 1;
    if (char === ')') depth -= 1;
    if (char === ',' && depth === 0) {
      if (current.trim()) layers.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }
  if (current.trim()) layers.push(current.trim());
  return layers;
}

function layerAlpha(layer: string): number {
  const match = layer.match(/rgba\(\s*20\s*,\s*20\s*,\s*22\s*,\s*([0-9.]+)\s*\)/);
  return match ? Number(match[1]) : 0;
}

function bucket() {
  const map = new Map<string, string>();
  return {
    getItem(key: string) { return map.get(key) ?? null; },
    set(key: string, value: unknown) { map.set(key, JSON.stringify(value)); },
  };
}

function mark(shareId: string, extra: Record<string, unknown> = {}) {
  return {
    saved: true,
    status: 'needs-review',
    projectKey: 'local-draft',
    title: '发布会',
    shareId,
    reviewPlanKey: shareId,
    markedAt: '2026-10-31T00:00:00.000Z',
    ...extra,
  };
}

function panelProps(extra: Partial<Parameters<typeof SharePanel>[0]> = {}): Parameters<typeof SharePanel>[0] {
  return {
    tab: 'publish',
    onTab: () => undefined,
    title: '发布会',
    published: null,
    busy: false,
    notice: '',
    bingoStatus: '待发',
    qrOpen: false,
    qrSvg: '',
    exports: [],
    onIssueAudience: () => undefined,
    onSendBingo: () => undefined,
    onPublish: () => undefined,
    onCopy: () => undefined,
    onToggleQr: () => undefined,
    ...extra,
  };
}

function expectChrome(trigger: HTMLElement, open: boolean): void {
  expect(trigger.style.width).toBe('32px');
  expect(trigger.style.height).toBe('32px');
  expect(trigger.style.borderRadius).toBe('8px');
  expect(trigger.style.backgroundColor.toLowerCase()).toMatch(/#fff|#ffffff|rgb\(255,\s*255,\s*255\)/);
  expect(trigger.style.borderTopWidth).toBe(open ? '1.2px' : '0.6px');
  const ink = open ? /#4a7c59|rgb\(74,\s*124,\s*89\)/ : /#55585f|rgb\(85,\s*88,\s*95\)/;
  const hair = open ? /#4a7c59|rgb\(74,\s*124,\s*89\)/ : /#e4e4e7|rgb\(228,\s*228,\s*231\)/;
  expect(trigger.style.color.toLowerCase()).toMatch(ink);
  expect(trigger.style.borderTopColor.toLowerCase()).toMatch(hair);
}

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
