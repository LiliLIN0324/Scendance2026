// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeLayout } from '../lib/__testfixtures__/fixtures';
import { rememberAholoAsset } from '../lib/aholo-assets';
import { INITIAL_LAYOUT } from '../lib/initial-layout';
import { createStarterOutdoorPlan, readOutdoorProjectRecord, saveOutdoorProjectRecord } from '../lib/outdoor-project-store';
import { onOutdoorProjectSwitch } from '../lib/outdoor-project-switch';
import { CN_REPLICA_CASES, REPLICA_CASES } from '../lib/replica-cases';
import { SpacePanel } from './space-panel';
import type { SplatPreviewState } from '../hooks/use-splat-preview';
import type { StoredEnvironment } from '../lib/environment-preference';
import type { BackendSession } from '@/lib/backend-session';

// 2026-11-19：上传走本机代理，单测里只验「面板把选中的文件交给上传口、并把结果/错误写回界面」。
const uploadScanFile = vi.hoisted(() => vi.fn());
const findScanLodUrl = vi.hoisted(() => vi.fn());
// 2026-11-22：上传后探活。默认放行，个别用例改成取不到。
const probeUploadedScan = vi.hoisted(() => vi.fn());
vi.mock('../lib/scan-upload', () => ({ uploadScanFile, findScanLodUrl, probeUploadedScan }));
// 空间卡现在常驻结构入口；这里只要给它一份最小壳体，不验证结构交互。
const structureContext = vi.hoisted(() => ({
  layout: { name: '普通壳体', width: 10, height: 8, floors: [{ id: 'ground', name: '活动场地', height: 3, items: [] }] },
  commitNow: () => {},
}));
vi.mock('../contexts', () => ({
  useRoomEditor: () => ({ layout: structureContext.layout, actions: {}, history: { commitNow: structureContext.commitNow } }),
  useSelection: () => ({ selectOnly: () => {} }),
}));

afterEach(() => { cleanup(); localStorage.clear(); });
beforeEach(() => {
  uploadScanFile.mockReset();
  findScanLodUrl.mockReset();
  findScanLodUrl.mockResolvedValue(undefined);
  probeUploadedScan.mockReset();
  probeUploadedScan.mockResolvedValue(true);
});

function environment(preview: SplatPreviewState = { status: 'idle', assetId: '', name: '' }, current: StoredEnvironment | null = null, thumbnails?: Readonly<Record<string, string>>) {
  return { preview, current, environments: current ? [current] : [], floors: [{ id: 'ground', name: '活动场地' }], onSelect: vi.fn(), onRemove: vi.fn(), onSetFloor: vi.fn(), onClear: vi.fn(), ...(thumbnails ? { thumbnails } : {}) };
}

describe('SpacePanel', () => {
  // 2026-11-19：登记要先探一次本机文件在不在，变成了异步；面板首帧可能是空列表。
  it('puts real venues first and folds secondary actions', async () => {
    render(<SpacePanel layout={INITIAL_LAYOUT}/>);
    expect(screen.getByRole('heading', { name: '真实场地' })).toBeTruthy();
    // 面板打开即自动登记云端扫描库（2026-11-19 收编江南村后索引 3 套实景），空库提示只在真没数据时出现
    expect(await screen.findByText(/\d+ 套已扫描/)).toBeTruthy();
    expect(screen.queryByText('用手机拍一段场地')).toBeNull();
  });

  it('lists scanned venues as cards with size and time, and places one on click', () => {
    const preview = environment();
    const onPlaceScan = vi.fn();
    rememberAholoAsset({
      assetId: '00000000-0000-4000-8000-000000000000', kind: 'spz', name: '午后咖啡馆', bytes: 20_000_000,
      savedAt: Date.UTC(2026, 10, 4), meters: { width: 12.4, depth: 8.6, height: 4.2 },
    });
    render(<SpacePanel layout={makeLayout()} environment={preview} onPlaceScan={onPlaceScan}/>);
    expect(screen.queryByText('还没有实景扫描')).toBeNull();
    const item = screen.getByLabelText('放置真实场地 午后咖啡馆');
    expect(screen.getByText(/12\.4 × 8\.6 m/)).toBeTruthy();
    // 2026-11-19 用户：「实景扫描的卡片也做成多个卡片的形式」——没止帧也走卡片，
    // 用淡点云图标占位，不再收成索引行。
    expect(item.classList.contains('sc-scan-card')).toBe(true);
    expect(item.querySelector('img')).toBeNull();
    expect(item.querySelector('.sc-scan-card-shot .sc-scan-card-blank')).toBeTruthy();
    expect(item.textContent).toContain('12.4 × 8.6 m');
    fireEvent.click(item);
    expect(onPlaceScan).toHaveBeenCalledWith(expect.objectContaining({
      assetId: '00000000-0000-4000-8000-000000000000',
      name: '午后咖啡馆',
      meters: { width: 12.4, depth: 8.6, height: 4.2 },
    }));
    // 演示场景仍留在环境切换里，不混进真实场地列表。
    expect(screen.queryByLabelText(/应用真实场地 .*宴会厅 A/)).toBeNull();
  });

  // 2026-11-19 用户：「实景扫描的卡片也做成多个卡片的形式」——多场并排成 2 列卡网，
  // 有止帧的用止帧、没止帧的用占位，两种卡同一尺寸，不因缺图被挤成别的形状。
  it('packs every scanned venue into one two-column card grid', () => {
    const cover = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lK3Q6wAAAABJRU5ErkJggg==';
    const framed = '00000000-0000-4000-8000-000000000011';
    const plainA = '00000000-0000-4000-8000-000000000012';
    const plainB = '00000000-0000-4000-8000-000000000013';
    rememberAholoAsset({ assetId: framed, kind: 'spz', name: '有封面的一场', bytes: 20_000_000, savedAt: 3 });
    rememberAholoAsset({ assetId: plainA, kind: 'spz', name: '没打开过的一场', bytes: 20_000_000, savedAt: 2 });
    rememberAholoAsset({ assetId: plainB, kind: 'ply', name: '导出的 PLY', bytes: 20_000_000, savedAt: 1 });
    render(<SpacePanel layout={makeLayout()} environment={environment(undefined, null, { [framed]: cover })}/>);
    const grid = document.querySelector('ul.sc-space-samples.sc-scan-cards') as HTMLUListElement;
    expect(grid).toBeTruthy();
    expect(grid.getAttribute('aria-label')).toBe('实景扫描');
    // 面板打开会先登记扫描库里的云端副本，这里只核「同一张卡网里装下所有场」，
    // 不把索引条数写死在用例里。
    const cards = grid.querySelectorAll('.sc-scan-card');
    expect(cards.length).toBeGreaterThanOrEqual(3);
    expect(grid.querySelectorAll('.sc-scan-card').length).toBe(grid.querySelectorAll('li').length);
    // 止帧那张是图，没打开过的两张是淡点云占位——都是同一颗卡，不再有单列行。
    expect(screen.getByLabelText('应用真实场地 有封面的一场').querySelector('img')?.getAttribute('src')).toBe(cover);
    for (const name of ['没打开过的一场', '导出的 PLY']) {
      const card = screen.getByLabelText(`应用真实场地 ${name}`);
      expect(card.classList.contains('sc-scan-card')).toBe(true);
      expect(card.querySelector('.sc-scan-card-blank')).toBeTruthy();
    }
    expect(document.querySelector('.sc-scan-row')).toBeNull();
    expect(document.querySelector('.sc-scan-rows')).toBeNull();
  });

  // 2026-11-19 用户：「实景扫描就是点击，然后放在特定的场地位置而已」——
  // 卡片主点击 = 放到场地上；用户随后拍板删掉卡片下沿的「只看这一场」。
  it('places a scan on the site on card click and renders no secondary action', () => {
    const onPlaceScan = vi.fn();
    const assetId = '00000000-0000-4000-8000-000000000021';
    rememberAholoAsset({
      assetId, kind: 'spz', name: '雨后庭院', bytes: 20_000_000,
      savedAt: Date.UTC(2026, 10, 6), meters: { width: 9.2, depth: 7.4, height: 3.1 },
    });
    render(<SpacePanel layout={makeLayout()} environment={environment()}
      onPlaceScan={onPlaceScan}/>);
    fireEvent.click(screen.getByLabelText('放置真实场地 雨后庭院'));
    expect(onPlaceScan).toHaveBeenCalledWith(expect.objectContaining({ assetId, name: '雨后庭院' }));
    expect(screen.queryByText('只看这一场')).toBeNull();
    expect(document.querySelector('.sc-scan-card-only')).toBeNull();
  });

  // 2026-11-19 用户：「把西湖标准档删了」——清单删掉的资产在面板打开时从注册表退掉，
  // 历史登记不能让已删扫描复活；没删的极速档不受影响。
  it('面板打开时执行墓碑同步：已删的标准档卡消失，极速档保留', async () => {
    rememberAholoAsset({ assetId: 'c338f720-3f60-4adb-8f3b-023300000001', kind: 'spz', name: '西湖 0233 · 标准档', bytes: 23_239_097, savedAt: 1_794_042_957_908 });
    rememberAholoAsset({ assetId: 'c338f720-3f60-4adb-8f3b-023300000002', kind: 'spz', name: '西湖 0233 · 极速档', bytes: 7_795_522, savedAt: 1_794_041_328_101 });
    render(<SpacePanel layout={makeLayout()} environment={environment()}/>);
    // 退墓碑是同步的：act 里 effect 跑完首帧就可能已刷掉，直接断言最终态。
    await waitFor(() => expect(screen.queryByText('西湖 0233 · 标准档')).toBeNull());
    expect(screen.getByText('西湖 0233 · 极速档')).toBeTruthy();
    // 注册表里也真的退掉了：刷新或重开面板都不会再出现。
    expect(localStorage.getItem('scendance:aholo-assets')).not.toContain('023300000001');
    expect(localStorage.getItem('scendance:aholo-assets')).toContain('023300000002');
  });

  it('已加入的扫描有独立编辑与重新落位入口，编辑不触发放置', () => {
    const assetId = '00000000-0000-4000-8000-000000000024';
    rememberAholoAsset({ assetId, kind: 'spz', name: '已放置庭院', bytes: 20000000, savedAt: 1 });
    const onMoveScan = vi.fn();
    const onPlaceScan = vi.fn();
    const current = { assetId, name: '已放置庭院', position: { x: 12, y: 0, z: 25 } };
    render(<SpacePanel variant="card" layout={makeLayout()} environment={environment(undefined, current)}
      onMoveScan={onMoveScan} onPlaceScan={onPlaceScan}/>);
    fireEvent.click(screen.getByRole('button', { name: '编辑实景扫描 已放置庭院' }));
    expect(onMoveScan).toHaveBeenCalledWith(assetId);
    expect(onPlaceScan).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '重新落位实景扫描 已放置庭院' }));
    expect(onPlaceScan).toHaveBeenCalledWith(expect.objectContaining({ assetId }));
  });

  // 2026-11-19 用户：「到底文件好没好？」——空态要能分开：「没打开过」和「加载失败」。
  it('separates 未打开过 from 加载失败 so a broken file is visible', () => {
    const broken = '00000000-0000-4000-8000-000000000022';
    const fresh = '00000000-0000-4000-8000-000000000023';
    rememberAholoAsset({ assetId: broken, kind: 'spz', name: '缺文件的场地', bytes: 20_000_000, savedAt: Date.UTC(2026, 10, 7) });
    rememberAholoAsset({ assetId: fresh, kind: 'spz', name: '没碰过的场地', bytes: 20_000_000, savedAt: Date.UTC(2026, 10, 8) });
    render(<SpacePanel layout={makeLayout()} environment={environment()} onPlaceScan={vi.fn()} failedScanIds={[broken]}/>);
    const brokenCard = screen.getByLabelText('重试加载真实场地 缺文件的场地');
    expect(brokenCard.classList.contains('is-missing')).toBe(true);
    expect(brokenCard.textContent).toContain('加载失败');
    expect(brokenCard.textContent).not.toContain('未打开过');
    const freshCard = screen.getByLabelText('放置真实场地 没碰过的场地');
    expect(freshCard.classList.contains('is-missing')).toBe(false);
    expect(freshCard.textContent).toContain('未打开过');
  });

  it('shows the captured cover as a large frame when one exists', () => {
    const assetId = '00000000-0000-4000-8000-000000000002';
    const cover = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lK3Q6wAAAABJRU5ErkJggg==';
    rememberAholoAsset({ assetId, kind: 'spz', name: '有封面的场地', bytes: 20_000_000, savedAt: 1 });
    render(<SpacePanel layout={makeLayout()} environment={environment(undefined, null, { [assetId]: cover })}/>);
    const frame = screen.getByLabelText('应用真实场地 有封面的场地');
    expect(frame.classList.contains('sc-scan-card')).toBe(true);
    expect(frame.querySelector('img')?.getAttribute('src')).toBe(cover);
  });

  it('marks the remembered environment as current and can remove it', () => {
    const current = { assetId: '00000000-0000-4000-8000-000000000000', name: '午后咖啡馆' };
    const preview = environment({ status: 'ready', assetId: current.assetId, name: current.name, splats: 1200 }, current);
    rememberAholoAsset({ assetId: current.assetId, kind: 'spz', name: current.name, bytes: 20_000_000, savedAt: 1 });
    render(<SpacePanel layout={makeLayout()} environment={preview} currentScanId={current.assetId}/>);
    expect(screen.getByLabelText('应用真实场地 午后咖啡馆').getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByText('更多场地选项'));
    fireEvent.click(screen.getByText('项目中的场景'));
    fireEvent.click(screen.getByRole('button', { name: '移除午后咖啡馆' }));
    expect(preview.onRemove).toHaveBeenCalledWith(current.assetId);
  });

  // 2026-11-19 用户：「我的实景扫描上传不到我的平台……图二这里应该新增一个上传功能」
  it('card：实景扫描分类行带「上传」，选文件后交给上传口并回报已加入', async () => {
    uploadScanFile.mockResolvedValue({
      assetId: '00000000-0000-4000-8000-000000000010', kind: 'spz', name: '新空间 2026-11-9',
      bytes: 194_000_000, savedAt: Date.now(),
    });
    render(<SpacePanel layout={makeLayout()} variant="card"/>);
    const button = screen.getByTestId('scan-upload-button');
    expect(button.textContent).toContain('上传');
    // 分类行里的动作不能顺手把这一段收起来。
    fireEvent.click(button);
    expect(screen.getByTestId('scan-upload-button')).toBeTruthy();
    const input = screen.getByTestId('scan-upload-input') as HTMLInputElement;
    const file = new File([new Uint8Array([0x1f, 0x8b, 0x08, 0x00])], '新空间 2026-11-9.spz');
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    fireEvent.change(input);
    await waitFor(() => expect(uploadScanFile).toHaveBeenCalledTimes(1));
    expect(uploadScanFile.mock.calls[0][0]).toBe(file);
    expect(findScanLodUrl).toHaveBeenCalledWith('新空间 2026-11-9.spz');
    expect((await screen.findByRole('status')).textContent).toContain('已加入「新空间 2026-11-9」');
  });

  // 2026-11-19：同名的本地 LOD 目录要在上传时就挂上，别等到预览才发现只有全量一档。
  it('card：探到同名 LOD 就随上传一起登记', async () => {
    findScanLodUrl.mockResolvedValue('/scans/jiangnan-village/lod-meta.json');
    uploadScanFile.mockResolvedValue({
      assetId: '00000000-0000-4000-8000-000000000011', kind: 'spz', name: 'jiangnan-village',
      bytes: 422_083_664, savedAt: Date.now(), lodUrl: '/scans/jiangnan-village/lod-meta.json',
    });
    render(<SpacePanel layout={makeLayout()} variant="card"/>);
    const input = screen.getByTestId('scan-upload-input') as HTMLInputElement;
    const file = new File([new Uint8Array([0x1f, 0x8b, 0x08, 0x00])], 'jiangnan-village.spz');
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    fireEvent.change(input);
    await waitFor(() => expect(uploadScanFile).toHaveBeenCalledTimes(1));
    expect(uploadScanFile.mock.calls[0][1]).toMatchObject({ lodUrl: '/scans/jiangnan-village/lod-meta.json' });
    expect((await screen.findByRole('status')).textContent).toContain('多档 LOD');
  });

  it('card：上传失败就把原因显示出来，并自动展开这一段', async () => {
    uploadScanFile.mockRejectedValue(new Error('连不上本机资产代理。先运行 npm run dev。'));
    render(<SpacePanel layout={makeLayout()} variant="card"/>);
    const group = [...document.querySelectorAll('details.sc-scene-group')]
      .find(node => node.querySelector('.sc-scene-group-label')?.textContent === '实景扫描') as HTMLDetailsElement;
    expect(group.open).toBe(false);
    const input = screen.getByTestId('scan-upload-input') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [new File(['x'], '场地.ply')], configurable: true });
    fireEvent.change(input);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('连不上本机资产代理');
    expect(group.open).toBe(true);
  });

  // 2026-11-22：落盘≠取得到。上传成功但本机代理探不到时，回执当场给结论，卡片标红，
  // 不让人点卡片落位、加载之后才发现文件是坏的。
  it('card：上传成功但探活取不到时当场标失败，卡片带加载失败', async () => {
    probeUploadedScan.mockResolvedValue(false);
    const asset = {
      assetId: '00000000-0000-4000-8000-0000000000ff', kind: 'spz' as const, name: '坏包',
      bytes: 1024, savedAt: Date.now(),
    };
    uploadScanFile.mockImplementation(async () => {
      rememberAholoAsset({ ...asset, kind: 'spz' });
      return asset;
    });
    render(<SpacePanel layout={makeLayout()} variant="card"/>);
    const input = screen.getByTestId('scan-upload-input') as HTMLInputElement;
    Object.defineProperty(input, 'files', {
      value: [new File([new Uint8Array([0x1f, 0x8b, 0x08, 0x00])], '坏包.spz')], configurable: true,
    });
    fireEvent.change(input);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('本机代理取不到这个文件');
    const card = await screen.findByLabelText('重试加载真实场地 坏包');
    expect(card.textContent).toContain('加载失败');
  });

  it('card：探活通过时回执维持「已加入」，卡片不标红', async () => {
    const asset = {
      assetId: '00000000-0000-4000-8000-0000000000fe', kind: 'spz' as const, name: '好包',
      bytes: 2048, savedAt: Date.now(),
    };
    uploadScanFile.mockImplementation(async () => {
      rememberAholoAsset({ ...asset, kind: 'spz' });
      return asset;
    });
    render(<SpacePanel layout={makeLayout()} variant="card" onPlaceScan={vi.fn()}/>);
    const input = screen.getByTestId('scan-upload-input') as HTMLInputElement;
    Object.defineProperty(input, 'files', {
      value: [new File([new Uint8Array([0x1f, 0x8b, 0x08, 0x00])], '好包.spz')], configurable: true,
    });
    fireEvent.change(input);
    expect((await screen.findByRole('status')).textContent).toContain('已加入「好包」');
    const card = await screen.findByLabelText('放置真实场地 好包');
    expect(card.textContent).not.toContain('加载失败');
  });

  it('shelf：列表上方也有上传入口与后缀提示', () => {
    render(<SpacePanel layout={makeLayout()}/>);
    expect(screen.getByTestId('scan-upload-button')).toBeTruthy();
    expect(screen.getByText(/从 Aholo Reality 下载的 \.spz \/ \.ply/)).toBeTruthy();
  });

  // 2026-11-17 用户：「是不是上面的应该放在下面」「项目中的场景这玩意根本就不重要啊」
  // ＋「经典案例我要的也是和其他的视觉一样的卡片预览图」。
  it('card：案例与模板库在前、实景扫描在后，项目中的场景不再占位', () => {
    render(<SpacePanel layout={makeLayout()} onAddSampleScene={vi.fn()} variant="card"/>);
    const labels = [...document.querySelectorAll('details.sc-scene-group')]
      .map(group => group.querySelector('.sc-scene-group-label')?.textContent);
    expect(labels[0]).toBe('国内案例');
    expect(labels[1]).toBe('经典案例');
    expect(labels).not.toContain('项目中的场景');
    expect(labels[labels.length - 1]).toBe('实景扫描');
    // 2026-11-17 用户：「每次打开都默认打开了示例场景和我的实景扫描……默认都不要打开」——
    // 2026-11-19 用户：「没有其他和我的区分」——分类行也不再叫「我的实景扫描」。
    // 两段从收起起步；展开与否交给用户点。
    for (const label of ['示例场景', '实景扫描']) {
      const group = [...document.querySelectorAll('details.sc-scene-group')]
        .find(node => node.querySelector('.sc-scene-group-label')?.textContent === label) as HTMLDetailsElement | undefined;
      expect(group, `${label} 分类行应该在`).toBeTruthy();
      expect(group!.open).toBe(false);
    }
    // 收起时不建卡（44 案各自要算一遍方案，懒挂载）。
    expect(document.querySelectorAll('.sc-space-cases .sc-space-sample').length).toBe(0);
    const group = document.querySelector('[data-testid="space-group-cases"]') as HTMLDetailsElement;
    group.open = true;
    fireEvent(group, new Event('toggle'));
    const cards = document.querySelectorAll('[data-testid="space-group-cases"] .sc-space-sample');
    expect(cards.length).toBe(REPLICA_CASES.length);
    expect(cards[0].querySelector('svg.sc-case-thumb')).toBeTruthy();
    expect(cards[0].textContent).toContain(REPLICA_CASES[0].title);
    // 官网中国案例单独一段，排在 OnePlan 经典案例之前，卡形一致。
    expect(CN_REPLICA_CASES.length).toBeGreaterThan(0);
    const cnGroup = document.querySelector('[data-testid="space-group-cn-cases"]') as HTMLDetailsElement;
    cnGroup.open = true;
    fireEvent(cnGroup, new Event('toggle'));
    const cnCards = document.querySelectorAll('[data-testid="space-group-cn-cases"] .sc-space-sample');
    expect(cnCards.length).toBe(CN_REPLICA_CASES.length);
    expect(cnCards[0].textContent).toContain(CN_REPLICA_CASES[0].title);
    expect(cnCards[0].querySelector('svg.sc-case-thumb')).toBeTruthy();
  });

  // 2026-11-17 用户：「切换经典案例不要直接白屏刷新重置……就按不换页改」——
  // 打开案例 = 写本机记录 + 请工作台就地换 project id；不再交给整页跳。
  it('card：打开经典案例先写本机记录，再请工作台同页切换', () => {
    const switched: string[] = [];
    const off = onOutdoorProjectSwitch(id => { switched.push(id); return true; });
    try {
      const expected = `replica-${REPLICA_CASES[0].id}`;
      const current = REPLICA_CASES[0].buildPlan();
      // 再次打开必须保留个人修改，不能随着案例初始方案更新而覆盖。
      saveOutdoorProjectRecord({ v: 1, projectId: expected, name: '旧案例', createdAt: '2026-11-17T00:00:00.000Z', updatedAt: '2026-11-17T00:00:00.000Z', plan: { ...current, zones: current.zones.slice(0, 2), facilities: [] } });
      render(<SpacePanel layout={makeLayout()} variant="card"/>);
      const group = document.querySelector('[data-testid="space-group-cases"]') as HTMLDetailsElement;
      group.open = true;
      fireEvent(group, new Event('toggle'));
      const card = document.querySelector('[data-testid="space-group-cases"] .sc-space-sample') as HTMLElement;
      fireEvent.click(card);
      expect(switched).toEqual([expected]);
      expect(readOutdoorProjectRecord(expected)?.name).toBe('旧案例');
      expect(readOutdoorProjectRecord(expected)?.plan).toEqual({ ...current, zones: current.zones.slice(0, 2), facilities: [] });
      expect(readOutdoorProjectRecord(expected)?.createdAt).toBe('2026-11-17T00:00:00.000Z');
    } finally {
      off();
    }
  });

  // 2026-11-20 任务 C：云端案例目录只接真实后端会话；backendSession 还没有案例方法时
  // 生产明确显示「不可用」，绝不用本机数据冒充云端目录。
  it('card：controller 没有云端案例方法时，目录段显示不可用且无目录卡', async () => {
    render(<SpacePanel layout={makeLayout()} variant="card" controller={{} as unknown as BackendSession}/>);
    const group = document.querySelector('[data-testid="space-group-cn-cases"]') as HTMLDetailsElement;
    group.open = true;
    fireEvent(group, new Event('toggle'));
    expect(await screen.findByTestId('cloud-cases-unavailable')).toBeTruthy();
    expect(document.querySelector('[data-testid="cloud-case-catalog"] li')).toBeNull();
  });

  // 2026-11-20 任务 C：云端案例「使用此案例」= 读公开 manifest 另存独立副本再同页切换；
  // 副本不继承当前项目的云端身份（不写 remoteActivityId/remoteRevision）。
  it('card：云端案例另存独立副本并同页切换，重复使用不覆盖已有副本', async () => {
    const session = {
      getCloudCapabilities: vi.fn(),
      listCloudCases: vi.fn(async () => [
        { id: 'cn-yuquan-chrysanthemum', title: '杭州植物园菊花展', category: '花卉展', sortOrder: 0, revision: 4 },
      ]),
      readCloudCase: vi.fn(async () => ({
        case: { id: 'cn-yuquan-chrysanthemum', title: '杭州植物园菊花展', revision: 4 },
        publicationId: 'pub-1',
        revision: 4,
        manifest: { outdoor: createStarterOutdoorPlan() },
        assets: [],
      })),
      upsertCloudCase: vi.fn(),
      listCloudCaseDrafts: vi.fn(),
      publishCloudCase: vi.fn(),
      unpublishCloudCase: vi.fn(),
      listCloudCaseVersions: vi.fn(),
      restoreCloudCase: vi.fn(),
    } as unknown as BackendSession;
    const expected = 'replica-cn-yuquan-chrysanthemum';
    const switched: string[] = [];
    const off = onOutdoorProjectSwitch(id => { switched.push(id); return true; });
    try {
      // 用户已改过这份副本：官方目录再怎么更新，重复使用都不覆盖。
      saveOutdoorProjectRecord({ v: 1, projectId: expected, name: '我改过的副本', createdAt: '2026-11-19T00:00:00.000Z', updatedAt: '2026-11-19T01:00:00.000Z', plan: { ...createStarterOutdoorPlan(), facilities: [] } });
      render(<SpacePanel layout={makeLayout()} variant="card" controller={session}/>);
      const group = document.querySelector('[data-testid="space-group-cn-cases"]') as HTMLDetailsElement;
      group.open = true;
      fireEvent(group, new Event('toggle'));
      const use = await screen.findByTestId('cloud-case-use-cn-yuquan-chrysanthemum');
      fireEvent.click(use);
      await waitFor(() => expect(switched).toEqual([expected]));
      expect(readOutdoorProjectRecord(expected)?.name).toBe('我改过的副本');
      expect(readOutdoorProjectRecord(expected)?.updatedAt).toBe('2026-11-19T01:00:00.000Z');
      expect(readOutdoorProjectRecord(expected)?.remoteActivityId).toBeUndefined();
      // 已有副本续用：不读 manifest，也不再写记录。
      expect((session as unknown as { readCloudCase: ReturnType<typeof vi.fn> }).readCloudCase).not.toHaveBeenCalled();
      // 全新副本才走「读 manifest → 落新记录 → 不带云端身份」。
      // （已有副本的路径在上面两行已核；新落记录路径在 lib/cloud-cases.test.ts 覆盖。）
    } finally {
      off();
    }
  });
});
