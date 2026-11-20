// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { planOutline, ShareMenu, shareBingoStatus, sharePublishReadOnly, shareTriggerChrome, type ShareMenuActions } from './share-menu';
import { displayShareUrl, SHARE_READ_ONLY_LINE, SharePanel, type ShareExportEntry } from './share-panel';
import { registerPublishGateProvider, type PublishGateSnapshot } from '../lib/project-manifest';
import { appendShareRecord, type ServerShare } from '../lib/share-records';
import type { RoomLayout } from '../lib/types';
import type { BackendSession } from '@/lib/backend-session';

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

  it('opens on the pin-review share tab when the workbench asks', () => {
    localStorage.clear();
    const view = render(<ShareMenu actions={actions()} layout={sampleLayout()} />);
    fireEvent.click(screen.getByRole('button', { name: '分享' }));
    fireEvent.click(screen.getByRole('tab', { name: '发布' }));
    expect(screen.getByRole('tab', { name: '发布' }).getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(document, { key: 'Escape' });
    view.rerender(<ShareMenu actions={actions()} layout={sampleLayout()} openRequest={1} />);
    expect(screen.getByRole('tab', { name: '分享' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tabpanel', { name: '分享' })).toBeTruthy();
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
  it('opens on 分享 with one create action and Bingo only', () => {
    localStorage.clear();
    render(<ShareMenu actions={actions()} layout={sampleLayout()} />);
    const dialog = openMenu();
    expect(screen.getByRole('tab', { name: '分享' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tab', { name: '分享' }).getAttribute('data-tone')).toBe('ink');
    expect(screen.getByRole('tab', { name: '发布' }).getAttribute('data-tone')).toBe('quiet');
    expect(dialog.textContent).toContain('发布会');
    expect(dialog.textContent).toContain('发给客户：可留言、可看 3D。');
    const create = screen.getByRole('button', { name: '送出评审链接' });
    const bingo = screen.getByRole('button', { name: /进入 Bingo 审校台/ });
    expect(create.className).toContain('sc-share-cta');
    expect(bingo.className).toContain('sc-share-row');
    expect(screen.queryByTestId('review-link-row')).toBeNull();
    expect(bingo.querySelector('.sc-share-row-label')?.textContent).toBe('进入 Bingo 审校台');
    expect(bingo.querySelector('.sc-share-row-status')?.textContent).toBe('暂无待评');
    const mark = bingo.querySelector('.sc-bingo-badge');
    expect(mark?.getAttribute('data-visual')).toBe('to-send');
    expect(mark?.querySelector('[data-part="ring"]')?.getAttribute('stroke')).toContain('55585F');
    expect(mark?.querySelector('circle')).toBeNull();
    expect(bingo.getAttribute('data-align')).toBe('start');
    expect(dialog.querySelector('img, .sc-publish-plan')).toBeNull();
    expect(dialog.textContent).not.toMatch(/方案预览|生成分享链接|3D 漫游|分享记录|密码|过期/);
  });

  it('creates the review link, copies it, and shows its current state', async () => {
    localStorage.clear();
    const share = actions();
    const clipboard = vi.fn(async () => undefined);
    Object.assign(navigator, { clipboard: { writeText: clipboard } });
    render(<ShareMenu actions={share} layout={sampleLayout()} />);
    openMenu();
    fireEvent.click(screen.getByRole('button', { name: '送出评审链接' }));
    expect((await screen.findByRole('status')).textContent).toContain('评审链接已复制');
    expect(clipboard).toHaveBeenCalledWith('https://studio.example/review/issued');
    expect(screen.getByTestId('review-link-row').textContent).toContain('studio.example/review/issued');
    expect(screen.getByRole('button', { name: '复制' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '打开' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '重新送出（当前版本）' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /进入 Bingo 审校台/ }).querySelector('.sc-share-row-status')?.textContent).toBe('待评');
    expect(share.onIssueReviewLink).toHaveBeenCalledOnce();
  });

  it('revokes the issued review short link and clears the link row', async () => {
    localStorage.clear();
    const revoke = vi.fn(async () => undefined);
    const share = actions({ onRevokeReviewLink: revoke });
    vi.mocked(share.onIssueReviewLink).mockResolvedValue({
      url: 'https://studio.example/r/abcdef1234567890abcdef12',
      isCurrent: () => true,
    });
    const clipboard = vi.fn(async () => undefined);
    Object.assign(navigator, { clipboard: { writeText: clipboard } });
    render(<ShareMenu actions={share} layout={sampleLayout()} />);
    openMenu();
    fireEvent.click(screen.getByRole('button', { name: '送出评审链接' }));
    await screen.findByTestId('review-link-row');

    fireEvent.click(screen.getByRole('button', { name: '作废这条评审链接' }));
    expect(revoke).toHaveBeenCalledWith('abcdef1234567890abcdef12');
    await screen.findByRole('status');
    expect(screen.getByRole('status').textContent).toContain('已作废');
    expect(screen.queryByTestId('review-link-row')).toBeNull();
  });

  it('keeps the link row when revocation fails', async () => {
    localStorage.clear();
    const revoke = vi.fn(async () => { throw new Error('这条评审链接没有被作废，请稍后再试。'); });
    const share = actions({ onRevokeReviewLink: revoke });
    vi.mocked(share.onIssueReviewLink).mockResolvedValue({
      url: 'https://studio.example/r/abcdef1234567890abcdef12',
      isCurrent: () => true,
    });
    render(<ShareMenu actions={share} layout={sampleLayout()} />);
    openMenu();
    fireEvent.click(screen.getByRole('button', { name: '送出评审链接' }));
    await screen.findByTestId('review-link-row');

    fireEvent.click(screen.getByRole('button', { name: '作废这条评审链接' }));
    await screen.findByRole('status');
    expect(screen.getByRole('status').textContent).toContain('没有被作废');
    expect(screen.getByTestId('review-link-row')).toBeTruthy();
  });

  it('hides the revoke entry when the workbench does not wire review revocation', async () => {
    localStorage.clear();
    const share = actions();
    vi.mocked(share.onIssueReviewLink).mockResolvedValue({
      url: 'https://studio.example/r/abcdef1234567890abcdef12',
      isCurrent: () => true,
    });
    render(<ShareMenu actions={share} layout={sampleLayout()} />);
    openMenu();
    fireEvent.click(screen.getByRole('button', { name: '送出评审链接' }));
    await screen.findByTestId('review-link-row');
    expect(screen.queryByRole('button', { name: '作废这条评审链接' })).toBeNull();
  });

  it('sends the ink permission switches with the review link', async () => {
    const share = actions();
    render(<ShareMenu actions={share} layout={sampleLayout()} />);
    openMenu();
    fireEvent.click(screen.getByRole('switch', { name: '可落钉意见' }));
    fireEvent.click(screen.getByRole('button', { name: '送出评审链接' }));
    await screen.findByRole('status');
    expect(share.onIssueReviewLink).toHaveBeenCalledWith({ pins: false, levels: true, basemap: true });
  });

  it('P2：改权限后旧链接与新链接各自何时生效分开说，重新送出才按新权限生成', async () => {
    localStorage.clear();
    const share = actions();
    const clipboard = vi.fn(async () => undefined);
    Object.assign(navigator, { clipboard: { writeText: clipboard } });
    render(<ShareMenu actions={share} layout={sampleLayout()} />);
    openMenu();
    // 还没送出：先把规则说清——开关只影响下一次送出。
    expect(screen.getByTestId('permit-rule').textContent).toContain('开关只影响下一次送出');
    expect(screen.queryByTestId('permit-pending')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '送出评审链接' }));
    await screen.findByTestId('review-link-row');
    // 送出后：这条链接的权限是送出那刻写进去的。
    expect(screen.getByTestId('permit-rule').textContent).toContain('这条链接送出时是「可落钉意见 · 可切换图层 · 可切换底图」');
    // 意见归属原方案版本（V16）。
    expect(screen.getByTestId('review-version-owner').textContent).toContain('客户意见记在这一版上');
    expect(screen.queryByTestId('permit-pending')).toBeNull();
    expect(share.onIssueReviewLink).toHaveBeenCalledWith({ pins: true, levels: true, basemap: true });
    // 改开关：没作用到任何链接，旧链接仍是原权限，旧地址不变。
    fireEvent.click(screen.getByRole('switch', { name: '可落钉意见' }));
    const pending = screen.getByTestId('permit-pending');
    expect(pending.textContent).toContain('开关已改成「不可落钉意见 · 可切换图层 · 可切换底图」');
    expect(pending.textContent).toContain('这条仍是「可落钉意见 · 可切换图层 · 可切换底图」');
    expect(screen.getByTestId('review-link-row').textContent).toContain('studio.example/review/issued');
    expect(share.onIssueReviewLink).toHaveBeenCalledOnce();
    // 重新送出：按新开关生成新链接，旧链接不会被动过。
    fireEvent.click(screen.getByRole('button', { name: '重新送出（当前版本）' }));
    await waitFor(() => expect(screen.queryByTestId('permit-pending')).toBeNull());
    expect(share.onIssueReviewLink).toHaveBeenLastCalledWith({ pins: false, levels: true, basemap: true });
    expect(screen.getByTestId('permit-rule').textContent).toContain('「不可落钉意见 · 可切换图层 · 可切换底图」');
  });

  it('P4：送出是动作、待评是结果、进入是去处，三者不互相冒充', async () => {
    localStorage.clear();
    const share = actions({ onOpenBingo: vi.fn() });
    render(<ShareMenu actions={share} layout={sampleLayout()} />);
    openMenu();
    expect(screen.getByTestId('review-send-status').textContent).toContain('送出状态：待发');
    fireEvent.click(screen.getByRole('button', { name: '送出评审链接' }));
    await screen.findByTestId('review-link-row');
    // 送出不会把人带进审校台；审校台那一行也不发链接。
    expect(share.onOpenBingo).not.toHaveBeenCalled();
    expect(screen.getByTestId('review-send-status').textContent).toContain('送出状态：待评');
    const desk = screen.getByRole('button', { name: /进入 Bingo 审校台，待评/ });
    expect(desk.querySelector('.sc-share-row-status')?.textContent).toBe('待评');
    fireEvent.click(desk);
    expect(share.onOpenBingo).toHaveBeenCalledOnce();
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
    fireEvent.click(screen.getByRole('button', { name: '送出评审链接' }));
    // P4（V17）：送出这一动作自己的状态在送出按钮与状态行上，「进入」那一行不冒充发送中。
    const sending = screen.getByRole('button', { name: '正在送出…' }) as HTMLButtonElement;
    expect(sending.disabled).toBe(true);
    expect(screen.getByTestId('review-send-status').textContent).toContain('送出状态：送出中');
    const deskRow = screen.getByRole('button', { name: /进入 Bingo 审校台/ });
    expect(deskRow.querySelector('.sc-share-row-label')?.textContent).toBe('进入 Bingo 审校台');
    expect(deskRow.querySelector('.sc-share-row-status')?.textContent).toBe('暂无待评');
    act(() => { epoch += 1; });
    await act(async () => finish({ url: 'https://studio.example/review/old', isCurrent: () => epoch === token }));
    expect(screen.getByRole('status').textContent).toContain('旧链接未复制');
    expect(clipboard).not.toHaveBeenCalled();
    expect(screen.getByTestId('review-send-status').textContent).toContain('送出状态：待发');
    expect(screen.queryByTestId('review-link-row')).toBeNull();
  });

  it('分享行待评和已回执用同一枚状态圈', () => {
    const shareId = '11111111-1111-4111-8111-111111111111';
    const record = {
      saved: true,
      status: 'needs-review',
      projectKey: 'project-1',
      title: '发布会',
      shareId,
      reviewPlanKey: shareId,
      markedAt: '2026-10-31T00:00:00.000Z',
    };
    localStorage.clear();
    localStorage.setItem('scendance.reviewMark.v1', JSON.stringify([record]));
    const waitingView = render(<ShareMenu actions={actions()} layout={sampleLayout()} />);
    openMenu();
    const waiting = screen.getByRole('button', { name: /进入 Bingo 审校台，待评/ });
    expect(waiting.querySelector('.sc-share-row-status')?.textContent).toBe('待评 1 份');
    expect(waiting.querySelector('.sc-bingo-badge')?.getAttribute('data-visual')).toBe('awaiting');
    expect(waiting.querySelector('text')?.textContent).toBe('1');
    expect(waiting.querySelector('[data-part="bead"]')?.getAttribute('fill')).toContain('96651F');
    expect(waiting.querySelector('[data-ring] text')).toBeNull();
    // P4（V17）：送出状态与「进入」分开：同一份记录下，送出那一行说的是待评。
    expect(screen.getByTestId('review-send-status').textContent).toContain('送出状态：待评');
    waitingView.unmount();

    localStorage.setItem('scendance-review-share-return-v1', JSON.stringify({
      version: 1,
      planKey: shareId,
      at: '2026-10-31T08:00:00.000Z',
    }));
    render(<ShareMenu actions={actions()} layout={sampleLayout()} />);
    openMenu();
    const done = screen.getByRole('button', { name: /进入 Bingo 审校台，有回执/ });
    expect(done.querySelector('.sc-share-row-status')?.textContent).toBe('有回执');
    const badge = done.querySelector('.sc-bingo-badge');
    expect(badge?.getAttribute('data-step')).toBe('check');
    expect(badge?.querySelector('[data-part="bead"]')).toBeNull();
    expect(badge?.querySelector('[data-part="ring"]')?.getAttribute('fill')).toBe('none');
    expect(badge?.querySelector('[data-mark="check"]')?.getAttribute('stroke')).toContain('141416');
  });

  it('进入 Bingo 审校台只切审校台，不再生成第二条链接', () => {
    localStorage.clear();
    const share = actions({ onOpenBingo: vi.fn() });
    render(<ShareMenu actions={share} layout={sampleLayout()} />);
    openMenu();
    fireEvent.click(screen.getByRole('button', { name: /进入 Bingo 审校台/ }));
    expect(share.onOpenBingo).toHaveBeenCalledOnce();
    expect(share.onIssueReviewLink).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog', { name: '分享、发布与导出' })).toBeNull();
  });
});

describe('发布页签', () => {
  it('shows only the green publish action until a link exists', async () => {
    localStorage.clear();
    render(<ShareMenu actions={actions()} layout={sampleLayout()} />);
    openMenu();
    fireEvent.click(screen.getByRole('tab', { name: '发布' }));
    const publish = screen.getByRole('tab', { name: '发布' });
    expect(publish.getAttribute('aria-selected')).toBe('true');
    expect(publish.getAttribute('data-tone')).toBe('ink');
    const cta = await screen.findByRole('button', { name: '发布并复制链接' });
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
    fireEvent.click(await screen.findByRole('button', { name: '发布并复制链接' }));
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

  it('2026-11-20 任务 C：交给客户的是云端发布链接；场地快照降级为明确标注的离线固定副本', async () => {
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
    fireEvent.click(await screen.findByRole('button', { name: '发布并复制链接' }));
    expect(await screen.findByRole('button', { name: /^复制$/ })).toBeTruthy();
    // 发布页不再把自带快照的场地页冒充主链接：交给客户的是受控发布链接（版本/撤回都在云端）。
    expect(screen.getByTestId('share-link-row').textContent).toContain('studio.example/view/#token');
    expect(screen.getByText('打开即可查看场地、分区和尺度，页里可看 3D。')).toBeTruthy();
    // 场地快照只在说明里出现，并如实标注边界：固定副本、不随项目更新、无法远程撤回。
    const offline = screen.getByText(/打开离线场地快照/).closest('p');
    expect(offline?.textContent).toContain('固定副本，不随项目更新，无法远程撤回');
    expect(clipboard).toHaveBeenCalledWith('https://studio.example/view/#token');
    expect(localStorage.getItem('scendance.publishedLink.v1.project-1')).toContain('https://studio.example/site#s2=1.abc123');
    expect(localStorage.getItem('scendance.shareLog.v1.project-1')).toContain('https://studio.example/view/#token');
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
    expect(await screen.findByRole('button', { name: '发布并复制链接' })).toBeTruthy();
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
    fireEvent.click(await screen.findByRole('button', { name: '发布并复制链接' }));
    expect((await screen.findByRole('status')).textContent).toContain('保存后再发布');
    expect(screen.queryByRole('button', { name: '二维码' })).toBeNull();
    expect(await screen.findByRole('button', { name: '发布并复制链接' })).toBeTruthy();
  });
});

describe('导出页签', () => {
  it('lists only the export actions the workbench already provides', async () => {
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
      expect(screen.getByRole('button', { name: new RegExp(`^${name}`) })).toBeTruthy();
    }
    expect(screen.queryByRole('button', { name: '导出交接' })).toBeNull();
    expect(screen.queryByRole('button', { name: '到场清单' })).toBeNull();
    // P3（V18）：导出不关菜单——关菜单既表示不了成功，也表示不了失败。
    fireEvent.click(screen.getByRole('button', { name: /^物料清单/ }));
    expect(share.onExportCsv).toHaveBeenCalledOnce();
    expect(screen.getByRole('tab', { name: '导出' }).getAttribute('aria-selected')).toBe('true');
    // CSV/GeoJSON 句柄是同步 void：只能如实写「已交给画布导出」，不冒充完成。
    expect(screen.getByTestId('export-status-materials').textContent).toContain('已交给画布导出');
    fireEvent.click(screen.getByRole('button', { name: /^效果图/ }));
    expect(share.onExportImage).toHaveBeenCalledOnce();
    // 效果图句柄有回执（Promise<boolean>）：resolve 才写「已导出」。
    await waitFor(() => expect(screen.getByTestId('export-status-render').textContent).toContain('已导出'));
    fireEvent.click(screen.getByRole('button', { name: /^场地范围文件/ }));
    expect(share.onExportGeoJson).toHaveBeenCalledOnce();
    expect(screen.getByTestId('export-status-site').textContent).toContain('已交给画布导出');
  });

  it('does not invent an export row when that callback is absent', () => {
    localStorage.clear();
    render(<ShareMenu actions={actions({ onExportImage: vi.fn(async () => true) })} layout={sampleLayout()} />);
    openMenu();
    fireEvent.click(screen.getByRole('tab', { name: '导出' }));
    expect(screen.getByRole('button', { name: /^效果图/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^物料清单/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^场地范围文件/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^演示稿/ })).toBeNull();
  });

  it('P3：四类导出的范围与版本写在行下，失败留在面板里给重试', async () => {
    localStorage.clear();
    let csvCalls = 0;
    const share = actions({
      onExportImage: vi.fn(async () => true),
      onExportCsv: vi.fn(() => { csvCalls += 1; if (csvCalls === 1) throw new Error('清单没有可写的行。'); }),
      onExportGeoJson: vi.fn(),
      onPrintDeck: vi.fn(),
    });
    render(<ShareMenu
      actions={share}
      layout={sampleLayout()}
      controller={{ getSnapshot: () => ({ configured: true, sessionId: 's1', revision: 4, dirty: false, user: { id: 'u1' }, project: { id: 'project-1' } }) } as never}
    />);
    openMenu();
    fireEvent.click(screen.getByRole('tab', { name: '导出' }));
    // 选择范围时绑定明确版本：每行都写清覆盖哪一段，并在点击时绑定当前版本。
    for (const name of ['效果图', '物料清单', '场地范围文件', '演示稿']) {
      expect(screen.getByRole('button', { name: new RegExp(`^${name}`) })).toBeTruthy();
    }
    expect(screen.getByTestId('export-row-materials').textContent).toContain('全部楼层物件与数量，CSV');
    expect(screen.getByTestId('export-row-site').textContent).toContain('场地轮廓与户外分区，GeoJSON');
    expect(screen.getByTestId('export-row-deck').textContent).toContain('当前方案的分页排版，PDF');
    expect(screen.getByTestId('export-binding').textContent).toContain('版本 4');
    // 失败不被关菜单当成成功：错误与重试都留在面板里。
    fireEvent.click(screen.getByRole('button', { name: /^物料清单/ }));
    const failed = await screen.findByTestId('export-status-materials');
    expect(failed.getAttribute('role')).toBe('alert');
    expect(failed.textContent).toContain('导出没成功');
    expect(failed.textContent).toContain('清单没有可写的行。');
    expect(failed.textContent).toContain('版本 4');
    expect(screen.getByTestId('share-panel')).toBeTruthy();
    fireEvent.click(screen.getByTestId('export-retry-materials'));
    await waitFor(() => expect(screen.getByTestId('export-status-materials').textContent).toContain('已交给画布导出'));
    expect(share.onExportCsv).toHaveBeenCalledTimes(2);
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
    fireEvent.click(await screen.findByRole('button', { name: '发布并复制链接' }));
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
      const row = screen.getByRole('button', { name: /^效果图/ });
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
    onOpenBingoDesk: () => undefined,
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

describe('案例页签（任务 C，2026-11-20）', () => {
  it('没传 controller 时不出现案例页签', () => {
    localStorage.clear();
    render(<ShareMenu actions={actions()} layout={sampleLayout()} />);
    openMenu();
    expect(screen.queryByRole('tab', { name: '案例' })).toBeNull();
  });

  it('传了 controller 就有案例页签；服务端方法没接通时如实显示不可用', () => {
    localStorage.clear();
    render(<ShareMenu actions={actions()} layout={sampleLayout()} controller={{ getSnapshot: () => ({ revision: 1 }) } as never} />);
    openMenu();
    fireEvent.click(screen.getByRole('tab', { name: '案例' }));
    expect(screen.getByRole('tabpanel', { name: '案例' }).textContent).toContain('还没有接通');
    expect(screen.queryByTestId('case-save-draft')).toBeNull();
  });
});

describe('完整只读分享（2026-11-20 集成，C12/C13）', () => {
  const TOKEN = 'a'.repeat(64);

  afterEach(() => registerPublishGateProvider(null));

  function cloudController(extra: Record<string, unknown> = {}): BackendSession {
    return {
      getSnapshot: () => ({
        configured: true, sessionId: 's1', revision: 4, dirty: false,
        user: { id: 'user-1' },
        project: { id: 'proj-1', name: '项目' },
        lease: { projectId: 'proj-1', sessionId: 's1', generation: 1, expiresAt: new Date(Date.now() + 60_000).toISOString(), revision: 4 },
      }),
      saveCompleteProject: vi.fn(async () => ({})),
      createCompleteShare: vi.fn(async () => ({ shareId: 'share-9', publicationId: 'pub-9', revision: 4, token: TOKEN })),
      revokeCompleteShare: vi.fn(async () => ({ revoked: true })),
      ...extra,
    } as unknown as BackendSession;
  }

  function completeGate(overrides: Partial<PublishGateSnapshot> = {}): PublishGateSnapshot {
    return {
      scopeId: 'p', projectId: 'proj-1', cloudRevision: 4,
      manifest: {
        version: 1,
        scene: { schemaVersion: 1 as const, venue: { shape: 'rectangle' as const, width: 12, depth: 10, height: 3, entrances: [] }, objects: [], camera: 'overview' as const, lighting: 'neutral' as const },
        outdoor: null, sources: {},
        dependencies: [{ assetId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', visibility: 'private' }],
      },
      gaps: [], complete: true, readyForPublish: true, note: 'ok', conflict: null,
      ...overrides,
    };
  }

  async function openPublishWith(controller: BackendSession): Promise<void> {
    localStorage.clear();
    render(<ShareMenu actions={actions()} layout={sampleLayout()} controller={controller} />);
    openMenu();
    fireEvent.click(screen.getByRole('tab', { name: '发布' }));
  }

  it('archives published deps then creates the controlled link and copies it once', async () => {
    registerPublishGateProvider(async () => completeGate());
    const controller = cloudController();
    const clipboard = vi.fn(async () => undefined);
    Object.assign(navigator, { clipboard: { writeText: clipboard } });
    await openPublishWith(controller);
    fireEvent.click(screen.getByTestId('complete-share').querySelector('button')!);
    expect(await screen.findByTestId('complete-share-link-row')).toBeTruthy();
    // 先按 published 口径落库（幂等 CAS），再创建受控分享。
    expect(controller.saveCompleteProject).toHaveBeenCalledWith('proj-1', expect.objectContaining({
      expectedRevision: 4,
      manifest: expect.objectContaining({ dependencies: [{ assetId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', visibility: 'published' }] }),
    }));
    expect(controller.createCompleteShare).toHaveBeenCalledWith('proj-1', expect.objectContaining({ expectedRevision: 4 }));
    await act(async () => {}); // 等 create 的 finally（busy 结算）落定再点复制
    fireEvent.click(screen.getByTestId('complete-share-link-row').querySelector('.sc-share-copy')!);
    await act(async () => {});
    expect(clipboard).toHaveBeenCalledWith(`${window.location.origin}/view/#c${TOKEN}`);
    // 撤销走既有项目分享口。
    fireEvent.click(screen.getByTestId('complete-share-link-row').querySelector('button:last-child')!);
    await waitFor(() => expect(screen.queryByTestId('complete-share-link-row')).toBeNull());
    expect(controller.revokeCompleteShare).toHaveBeenCalledWith('proj-1', 'share-9');
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('已撤销'));
  });

  it('shows the archive gap and never calls createCompleteShare when dependencies are incomplete', async () => {
    registerPublishGateProvider(async () => completeGate({
      complete: false, readyForPublish: false,
      gaps: [{ localId: 'scan-1', kind: 'scan', name: '西湖扫描', reason: 'not-uploaded' }],
    }));
    const controller = cloudController();
    await openPublishWith(controller);
    fireEvent.click(screen.getByTestId('complete-share').querySelector('button')!);
    expect((await screen.findByText(/西湖扫描/)).textContent).toContain('西湖扫描');
    expect(controller.createCompleteShare).not.toHaveBeenCalled();
    expect(controller.saveCompleteProject).not.toHaveBeenCalled();
    expect(screen.queryByTestId('complete-share-link-row')).toBeNull();
  });
});

// P0-A（主计划 PUB-05/PUB-06 复现与回归，2026-11-20）：切项目与迟到回执的项目/版本一致性。
describe('P0-A 项目切换与迟到回执一致性', () => {
  const TOKEN = 'b'.repeat(64);

  afterEach(() => registerPublishGateProvider(null));

  function cloudController(extra: Record<string, unknown> = {}, snapshotOverride?: () => Record<string, unknown>): BackendSession {
    return {
      getSnapshot: snapshotOverride ?? (() => ({
        configured: true, sessionId: 's1', revision: 4, dirty: false,
        user: { id: 'user-1' },
        project: { id: 'proj-1', name: '项目' },
        lease: { projectId: 'proj-1', sessionId: 's1', generation: 1, expiresAt: new Date(Date.now() + 60_000).toISOString(), revision: 4 },
      })),
      saveCompleteProject: vi.fn(async () => ({})),
      createCompleteShare: vi.fn(async () => ({ shareId: 'share-9', publicationId: 'pub-9', revision: 4, token: TOKEN })),
      revokeCompleteShare: vi.fn(async () => ({ revoked: true })),
      ...extra,
    } as unknown as BackendSession;
  }

  function completeGateFor(projectId: string, overrides: Partial<PublishGateSnapshot> = {}): PublishGateSnapshot {
    return {
      scopeId: projectId, projectId, cloudRevision: 4,
      manifest: {
        version: 1,
        scene: { schemaVersion: 1 as const, venue: { shape: 'rectangle' as const, width: 12, depth: 10, height: 3, entrances: [] }, objects: [], camera: 'overview' as const, lighting: 'neutral' as const },
        outdoor: null, sources: {},
        dependencies: [{ assetId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', visibility: 'private' }],
      },
      gaps: [], complete: true, readyForPublish: true, note: 'ok', conflict: null,
      ...overrides,
    };
  }

  it('PUB-05 复现：切项目后旧项目的完整只读链接残留在新项目面板里', async () => {
    localStorage.clear();
    registerPublishGateProvider(async () => completeGateFor('proj-1'));
    const controller = cloudController();
    const view = render(<ShareMenu actions={actions()} layout={sampleLayout()} controller={controller} />);
    openMenu();
    fireEvent.click(screen.getByRole('tab', { name: '发布' }));
    fireEvent.click(screen.getByTestId('complete-share').querySelector('button')!);
    expect(await screen.findByTestId('complete-share-link-row')).toBeTruthy();
    // 切到另一份方案（另一活动）：上一份的受控链接、令牌行和复制动作都不得跟着过来。
    view.rerender(<ShareMenu actions={actions()} layout={{ ...sampleLayout(), id: 'project-2', name: '另一个活动' }} controller={controller} />);
    fireEvent.click(screen.getByRole('tab', { name: '发布' }));
    expect(screen.queryByTestId('complete-share-link-row')).toBeNull();
    expect(screen.queryByText(/令牌只在这一次显示/)).toBeNull();
  });

  it('PUB-05 复现：发布回执迟到时写入新项目面板', async () => {
    localStorage.clear();
    const share = actions();
    let finish!: (value: { url: string; revision: number }) => void;
    vi.mocked(share.onPublish).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const clipboard = vi.fn(async () => undefined);
    Object.assign(navigator, { clipboard: { writeText: clipboard } });
    const view = render(<ShareMenu actions={share} layout={sampleLayout()} />);
    openMenu();
    fireEvent.click(screen.getByRole('tab', { name: '发布' }));
    fireEvent.click(await screen.findByRole('button', { name: '发布并复制链接' }));
    // 发布在途时切到另一份方案。
    view.rerender(<ShareMenu actions={share} layout={{ ...sampleLayout(), id: 'project-2', name: '另一个活动' }} />);
    await act(async () => finish({ url: 'https://studio.example/view/#old-token', revision: 3 }));
    // 回执迟到后用户在新项目里点开发布页签：旧项目的链接不得出现。
    fireEvent.click(screen.getByRole('tab', { name: '发布' }));
    expect(screen.queryByTestId('share-link-row')).toBeNull();
    expect(clipboard).not.toHaveBeenCalled();
    // 服务端确实为原项目生成了链接：记录写回原项目名下，切回去还能看到。
    expect(localStorage.getItem('scendance.publishedLink.v1.project-1')).toContain('old-token');
  });

  it('PUB-06 复现：完整分享用归档时读到的快照之外的项目创建分享', async () => {
    localStorage.clear();
    registerPublishGateProvider(async () => completeGateFor('proj-1'));
    let phase = 0;
    const snapshot = () => phase === 0
      ? {
        configured: true, sessionId: 's1', revision: 4,
        project: { id: 'proj-1', name: '项目' },
        lease: { projectId: 'proj-1', sessionId: 's1', generation: 1, expiresAt: new Date(Date.now() + 60_000).toISOString(), revision: 4 },
      }
      : {
        configured: true, sessionId: 's1', revision: 9,
        project: { id: 'proj-2', name: '另一个项目' },
        lease: { projectId: 'proj-2', sessionId: 's1', generation: 1, expiresAt: new Date(Date.now() + 60_000).toISOString(), revision: 9 },
      };
    const controller = cloudController({
      saveCompleteProject: vi.fn(async () => { phase = 1; return {}; }),
    }, snapshot);
    render(<ShareMenu actions={actions()} layout={sampleLayout()} controller={controller} />);
    openMenu();
    fireEvent.click(screen.getByRole('tab', { name: '发布' }));
    fireEvent.click(screen.getByTestId('complete-share').querySelector('button')!);
    await screen.findByRole('status');
    // 归档落在 proj-1；切到 proj-2 后不得把 proj-1 的归档确认配上 proj-2 的分享请求。
    expect(controller.saveCompleteProject).toHaveBeenCalledWith('proj-1', expect.anything());
    expect(controller.createCompleteShare).not.toHaveBeenCalled();
    expect(screen.queryByTestId('complete-share-link-row')).toBeNull();
  });

  it('P0-A：完整分享失败后重试复用同一 requestId（服务端幂等闸按 actor+requestId 去重）', async () => {
    localStorage.clear();
    registerPublishGateProvider(async () => completeGateFor('proj-1'));
    const controller = cloudController({
      createCompleteShare: vi.fn()
        .mockImplementationOnce(async () => { throw new Error('NETWORK_ERROR'); })
        .mockImplementationOnce(async () => ({ shareId: 'share-9', publicationId: 'pub-9', revision: 4, token: TOKEN })),
    });
    render(<ShareMenu actions={actions()} layout={sampleLayout()} controller={controller} />);
    openMenu();
    fireEvent.click(screen.getByRole('tab', { name: '发布' }));
    const create = () => screen.getByTestId('complete-share').querySelector('button')!;
    fireEvent.click(create());
    expect((await screen.findByText(/NETWORK_ERROR/)).textContent).toContain('NETWORK_ERROR');
    fireEvent.click(create());
    expect(await screen.findByTestId('complete-share-link-row')).toBeTruthy();
    const calls = vi.mocked(controller.createCompleteShare).mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[0]![1].requestId).toBe(calls[1]![1].requestId);
    expect(calls[1]![0]).toBe('proj-1');
    // 成功后创建钮被链接行替换（重新生成须先撤销）：UI 自身挡住「新操作复用旧身份」。
    expect(screen.getByTestId('complete-share').querySelector('.sc-share-copy')).toBeTruthy();
  });

  it('P0-A：发布请求丢失但服务端已有新分享记录时按可能已成功处理，不引导重复发布', async () => {
    localStorage.clear();
    const share = actions({
      onListShares: vi.fn(async () => [
        { shareId: 'sh-x', publicationId: 'pub-x', revision: 3, createdAt: new Date().toISOString(), revokedAt: null },
      ]),
    });
    vi.mocked(share.onPublish).mockRejectedValueOnce(Object.assign(new Error('暂时无法连接分享服务，请重试。'), { publishAmbiguous: true }));
    render(<ShareMenu actions={share} layout={sampleLayout()} />);
    openMenu();
    fireEvent.click(screen.getByRole('tab', { name: '发布' }));
    fireEvent.click(await screen.findByRole('button', { name: '发布并复制链接' }));
    expect((await screen.findByRole('status')).textContent).toContain('可能已成功');
    expect(share.onListShares).toHaveBeenCalledOnce();
    // URL 不可知（令牌只返回一次）：不伪造链接行，也不写本机链接键。
    expect(screen.queryByTestId('share-link-row')).toBeNull();
    expect(localStorage.getItem('scendance.publishedLink.v1.project-1')).toBeNull();
  });

  it('P0-A：发布请求丢失且服务端无新记录时如实说未知', async () => {
    localStorage.clear();
    const share = actions({ onListShares: vi.fn(async () => []) });
    vi.mocked(share.onPublish).mockRejectedValueOnce(Object.assign(new Error('暂时无法连接分享服务，请重试。'), { publishAmbiguous: true }));
    render(<ShareMenu actions={share} layout={sampleLayout()} />);
    openMenu();
    fireEvent.click(screen.getByRole('tab', { name: '发布' }));
    fireEvent.click(await screen.findByRole('button', { name: '发布并复制链接' }));
    expect((await screen.findByRole('status')).textContent).toContain('是否成功未知');
    expect(share.onListShares).toHaveBeenCalledOnce();
  });

  it('P0-A：同一项目内方案已变（isCurrent=false）时不复制不展示，链接记录仍写回本项目', async () => {
    localStorage.clear();
    const share = actions();
    const clipboard = vi.fn(async () => undefined);
    Object.assign(navigator, { clipboard: { writeText: clipboard } });
    vi.mocked(share.onPublish).mockResolvedValueOnce({ url: 'https://studio.example/view/#tok', revision: 3, isCurrent: () => false });
    render(<ShareMenu actions={share} layout={sampleLayout()} />);
    openMenu();
    fireEvent.click(screen.getByRole('tab', { name: '发布' }));
    fireEvent.click(await screen.findByRole('button', { name: '发布并复制链接' }));
    expect((await screen.findByRole('status')).textContent).toContain('方案或版本已变化');
    expect(clipboard).not.toHaveBeenCalled();
    expect(screen.queryByTestId('share-link-row')).toBeNull();
    // 服务端确已生成 v3 的链接：记录写回本项目名下（服务端记录为准），重开面板可见。
    expect(localStorage.getItem('scendance.publishedLink.v1.project-1')).toContain('#tok');
  });

  it('P0-A：在途发布切项目后旧任务结算不再干扰新项目的发布', async () => {
    localStorage.clear();
    const share = actions();
    const clipboard = vi.fn(async () => undefined);
    Object.assign(navigator, { clipboard: { writeText: clipboard } });
    const resolvers: Array<(value: { url: string; revision: number }) => void> = [];
    vi.mocked(share.onPublish).mockImplementation(() => new Promise(resolve => { resolvers.push(resolve); }));
    const view = render(<ShareMenu actions={share} layout={sampleLayout()} />);
    openMenu();
    fireEvent.click(screen.getByRole('tab', { name: '发布' }));
    fireEvent.click(await screen.findByRole('button', { name: '发布并复制链接' }));
    view.rerender(<ShareMenu actions={share} layout={{ ...sampleLayout(), id: 'project-2', name: '另一个活动' }} />);
    fireEvent.click(screen.getByRole('tab', { name: '发布' }));
    // 切项目复位任务态：新项目的发布钮立即可用。
    const cta = await screen.findByRole('button', { name: '发布并复制链接' });
    expect(cta).toBeTruthy();
    fireEvent.click(cta);
    // 旧任务的回执先到：不进入新项目面板、不复制、不动 busy。
    await act(async () => resolvers[0]!({ url: 'https://studio.example/view/#old', revision: 3 }));
    expect(screen.queryByTestId('share-link-row')).toBeNull();
    expect(clipboard).not.toHaveBeenCalled();
    // 新任务的回执后到：正常展示并复制。
    await act(async () => resolvers[1]!({ url: 'https://studio.example/view/#new', revision: 5 }));
    expect(screen.getByTestId('share-link-row').textContent).toContain('#new');
    expect(clipboard).toHaveBeenCalledWith('https://studio.example/view/#new');
    expect(localStorage.getItem('scendance.publishedLink.v1.project-1')).toContain('#old');
    expect(localStorage.getItem('scendance.publishedLink.v1.project-2')).toContain('#new');
  });

  it('P1-A：打开发布页即预检，保存状态与服务端记录合并渲染，令牌丢失如实说明', async () => {
    localStorage.clear();
    registerPublishGateProvider(async () => completeGateFor('proj-1'));
    const share = actions({
      onListShares: vi.fn(async () => [
        { shareId: 'sh-1', publicationId: 'pub-1', revision: 3, createdAt: '2026-11-19T04:12:00Z', revokedAt: null },
        { shareId: 'sh-2', publicationId: 'pub-2', revision: 2, createdAt: '2026-11-18T04:12:00Z', revokedAt: '2026-11-18T05:00:00Z' },
      ] as ServerShare[]),
    });
    appendShareRecord('project-1', { kind: 'web', url: 'https://studio.example/view/#tok', revision: 3, at: Date.parse('2026-11-19T04:12:00Z') });
    render(<ShareMenu actions={share} layout={sampleLayout()} controller={cloudController()} />);
    openMenu();
    fireEvent.click(screen.getByRole('tab', { name: '发布' }));
    // 预检状态块：保存状态 + 最近发布版本 + 当前修改。
    expect(await screen.findByTestId('publish-status')).toBeTruthy();
    expect(screen.getByTestId('publish-status').textContent).toContain('已发布：版本 3');
    // 服务端权威发布记录：合并本机 URL 后按版本渲染，含已撤回行。
    await waitFor(() => expect(screen.getByTestId('publish-records')).toBeTruthy());
    expect(screen.getByTestId('publish-records').textContent).toContain('版本 3');
    expect(screen.getByTestId('publish-records').textContent).toContain('版本 2');
    expect(screen.getByTestId('publish-records').textContent).toContain('已撤回');
    // 服务端有记录但本机没 URL 的行（v2 已撤回）与有 URL 的行（v3）分别渲染：
    // URL 丢失行如实说明「链接只在生成时显示一次」，不假装能恢复。
    const rows = screen.getAllByTestId(/^publish-record-/);
    const revokedRow = rows.find(row => row.textContent?.includes('版本 2'));
    expect(revokedRow?.textContent).toContain('已撤回');
    expect(rows.some(row => row.querySelector('.sc-share-copy'))).toBe(true);
  });

  it('P1-A：预检阻塞时列出缺口与既有动作入口；发布成功与复制失败分开反馈', async () => {
    localStorage.clear();
    registerPublishGateProvider(async () => completeGateFor('proj-1', {
      complete: false,
      gaps: [{ localId: 'scan-1', kind: 'scan', name: '西湖扫描', reason: 'not-uploaded' }],
    }));
    const share = actions({ onPrecheckAction: vi.fn() });
    render(<ShareMenu actions={share} layout={sampleLayout()} controller={cloudController()} />);
    openMenu();
    fireEvent.click(screen.getByRole('tab', { name: '发布' }));
    const blockers = await screen.findByTestId('publish-blockers');
    expect(blockers.textContent).toContain('西湖扫描');
    expect(blockers.textContent).toContain('需要处理');
    // 阻塞项动作按钮接到宿主 onPrecheckAction，不造假入口。
    fireEvent.click(screen.getByRole('button', { name: '去归档页补传' }));
    expect(share.onPrecheckAction).toHaveBeenCalledWith('archive-page');
    // 缺口补齐后（闸门 provider 换可发布快照）：发布成功、复制失败分别反馈，不诱导重复发布。
    registerPublishGateProvider(async () => completeGateFor('proj-1'));
    // copyText 的契约是「writeText 不抛错即复制成功」；要模拟拒绝剪贴板权限，桩必须 reject。
    delete (navigator as { clipboard?: unknown }).clipboard;
    const clipboard = vi.fn(async () => { throw new Error('NotAllowedError'); });
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: clipboard }, configurable: true });
    fireEvent.click(await screen.findByRole('button', { name: '发布并复制链接' }));
    await waitFor(() => expect(screen.getByTestId('publish-feedback').textContent).toContain('已发布版本 3'));
    expect(screen.getByTestId('copy-feedback').textContent).toContain('复制没成功');
    expect(screen.getByTestId('copy-feedback').getAttribute('data-tone')).toBe('warn');
    expect(clipboard).toHaveBeenCalledWith('https://studio.example/view/#token');
  });
});

// P0-B（2026-11-20 集成补）：预检先报「检查中」，再给发布摘要；阻塞动作只在宿主声明支持时才给按钮。
describe('P0-B 预检呈现（2026-11-20 集成）', () => {
  afterEach(() => registerPublishGateProvider(null));

  const gate: PublishGateSnapshot = {
    scopeId: 'p', projectId: 'proj-1', cloudRevision: 3,
    manifest: {
      version: 1,
      scene: { schemaVersion: 1 as const, venue: { shape: 'rectangle' as const, width: 12, depth: 10, height: 3, entrances: [] }, objects: [], camera: 'overview' as const, lighting: 'neutral' as const },
      outdoor: null, sources: {}, dependencies: [],
    },
    gaps: [], complete: true, readyForPublish: true, note: 'ok', conflict: null,
  };

  function loggedInController(): BackendSession {
    return {
      getSnapshot: () => ({
        configured: true, sessionId: 's1', revision: 3, dirty: false,
        user: { id: 'user-1' },
        project: { id: 'proj-1', name: '项目' },
        lease: { projectId: 'proj-1', sessionId: 's1', generation: 1, expiresAt: new Date(Date.now() + 60_000).toISOString(), revision: 3 },
      }),
    } as unknown as BackendSession;
  }

  it('打开发布页先报检查中，再按类别列出本次发布内容与对外范围', async () => {
    localStorage.clear();
    registerPublishGateProvider(async () => gate);
    render(<ShareMenu actions={actions()} layout={sampleLayout()} controller={loggedInController()} />);
    openMenu();
    fireEvent.click(screen.getByRole('tab', { name: '发布' }));
    // 首查完成后按类别列清本次发布内容（PUB-02/PUB-11）；「检查中」渲染由 share-panel 用例覆盖。
    const summary = await screen.findByTestId('publish-summary');
    expect(summary.textContent).toContain('场地与楼层');
    expect(summary.textContent).toContain('12 × 8 米');
    expect(summary.textContent).toContain('本次不含户外规划');
    // 对外范围如实写：原件与扫描不随发布公开（PUB-11）。
    expect(summary.textContent).toContain('资料原件');
  });

  it('阻塞项只在宿主声明支持时给处理按钮', async () => {
    localStorage.clear();
    registerPublishGateProvider(async () => ({
      ...gate,
      complete: false,
      gaps: [{ localId: 'scan-1', kind: 'scan' as const, name: '西湖扫描', reason: 'not-uploaded' as const }],
    }));
    const onPrecheckAction = vi.fn();
    render(<ShareMenu
      actions={actions({ onPrecheckAction, precheckActions: ['login', 'archive-page'] })}
      layout={sampleLayout()}
      controller={loggedInController()}
    />);
    openMenu();
    fireEvent.click(screen.getByRole('tab', { name: '发布' }));
    const blocker = await screen.findByTestId('publish-blocker-archive-gaps');
    expect(blocker.textContent).toContain('西湖扫描');
    fireEvent.click(blocker.querySelector('button')!);
    expect(onPrecheckAction).toHaveBeenCalledWith('archive-page');
  });

  it('宿主没提供恢复动作时只说明原因，不放必失败的按钮', async () => {
    localStorage.clear();
    registerPublishGateProvider(async () => ({
      ...gate,
      complete: false,
      gaps: [{ localId: 'scan-1', kind: 'scan' as const, name: '西湖扫描', reason: 'not-uploaded' as const }],
    }));
    render(<ShareMenu actions={actions()} layout={sampleLayout()} controller={loggedInController()} />);
    openMenu();
    fireEvent.click(screen.getByRole('tab', { name: '发布' }));
    const blocker = await screen.findByTestId('publish-blocker-archive-gaps');
    expect(blocker.textContent).toContain('西湖扫描');
    expect(blocker.querySelector('button')).toBeNull();
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
