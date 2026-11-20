// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createStarterOutdoorPlan } from '../lib/outdoor-project-store';
import { CloudCaseCatalog } from './cloud-case-catalog';
import type { CloudCaseSessionContract } from '../lib/cloud-cases';

afterEach(cleanup);

const CASE_A = { id: 'cn-yuquan-chrysanthemum', title: '杭州植物园菊花展', category: '花卉展', sortOrder: 0, revision: 4, updatedAt: '2026-11-19T00:00:00.000Z' };
const CASE_B = { id: 'cn-west-lake-lantern', title: '西湖灯会', category: '灯会', sortOrder: 1, revision: 2 };

function sessionStub(overrides: {
  list?: () => Promise<unknown>;
  read?: () => Promise<unknown>;
} = {}): CloudCaseSessionContract {
  const list = overrides.list ?? (async () => [CASE_A, CASE_B]);
  const read = overrides.read ?? (async () => ({
    case: CASE_A,
    publicationId: 'pub-1',
    revision: 4,
    manifest: { outdoor: createStarterOutdoorPlan() },
    assets: [],
  }));
  return {
    getCloudCapabilities: vi.fn(async () => ({ version: 1, superAdmin: false })),
    listCloudCases: vi.fn(list),
    readCloudCase: vi.fn(read),
    upsertCloudCase: vi.fn(),
    listCloudCaseDrafts: vi.fn(async () => []),
    publishCloudCase: vi.fn(),
    unpublishCloudCase: vi.fn(),
    listCloudCaseVersions: vi.fn(async () => []),
    restoreCloudCase: vi.fn(),
  } as unknown as CloudCaseSessionContract;
}

describe('CloudCaseCatalog', () => {
  it('没接 controller 时如实显示不可用，不发任何请求', () => {
    const onUseCase = vi.fn();
    render(<CloudCaseCatalog session={null} onUseCase={onUseCase}/>);
    expect(screen.getByTestId('cloud-cases-unavailable').textContent).toContain('还没有接通');
    expect(document.querySelector('[data-testid="cloud-case-catalog"] li')).toBeNull();
  });

  it('目录加载后按卡展示元信息，「查看」取详情画只读缩略，「使用此案例」交给宿主', async () => {
    const session = sessionStub();
    const onUseCase = vi.fn();
    render(<CloudCaseCatalog session={session} onUseCase={onUseCase}/>);
    await waitFor(() => expect(screen.getByLabelText('查看云端案例 杭州植物园菊花展')).toBeTruthy());
    expect(screen.getByLabelText('查看云端案例 西湖灯会')).toBeTruthy();
    expect(screen.getByText(/公众版本 v4/)).toBeTruthy();
    // 目录只拉清单；详情等用户点「查看」才取。
    expect(session.readCloudCase).not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText('查看云端案例 杭州植物园菊花展'));
    await waitFor(() => expect(session.readCloudCase).toHaveBeenCalledOnce());
    // 只读预览 = manifest 画的 2D 缩略 + 明确的边界说明，不进画布。
    await waitFor(() => expect(document.querySelector('.sc-cloud-case-view svg.sc-case-thumb')).toBeTruthy());
    expect(screen.getByText(/只读预览为 2D 示意/).textContent).toContain('v4');
    expect(screen.getByText(/要编辑请「使用此案例」/)).toBeTruthy();
    fireEvent.click(screen.getByTestId('cloud-case-use-cn-yuquan-chrysanthemum'));
    expect(onUseCase).toHaveBeenCalledWith('cn-yuquan-chrysanthemum');
  });

  it('目录请求失败时给出原因与重试，重试真正重新拉取', async () => {
    const list = vi.fn()
      .mockRejectedValueOnce(new Error('网络断开'))
      .mockResolvedValueOnce([CASE_A]);
    const session = sessionStub({ list: list as unknown as () => Promise<unknown> });
    render(<CloudCaseCatalog session={session} onUseCase={vi.fn()}/>);
    const error = await screen.findByTestId('cloud-cases-error');
    expect(error.textContent).toContain('网络断开');
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    expect(await screen.findByLabelText('查看云端案例 杭州植物园菊花展')).toBeTruthy();
    expect(list).toHaveBeenCalledTimes(2);
  });

  it('云端还没有已发布案例时空态如实说明', async () => {
    const session = sessionStub({ list: async () => [] });
    render(<CloudCaseCatalog session={session} onUseCase={vi.fn()}/>);
    const empty = await screen.findByTestId('cloud-cases-empty');
    expect(empty.textContent).toContain('云端还没有已发布的案例');
  });
});
