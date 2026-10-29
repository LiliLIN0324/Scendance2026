// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { rememberAholoAsset } from '../lib/aholo-assets';
import { loadStoredAholoCatalogItem } from '../lib/aholo-model-placement';
import { GeneratedItemLibrary } from './generated-item-library';
import type { CatalogItem } from '../lib/types';

// 落盘与量尺寸的链路另有真实测试；这里只验证物料库把它接成了能反复摆放的卡片。
vi.mock('../lib/aholo-model-placement', () => ({ loadStoredAholoCatalogItem: vi.fn() }));

const GLB_ID = '4165e104-e2c1-4f5e-b2a4-46602bf9f932';
const SPZ_ID = '00000000-0000-4000-8000-000000000000';
const ITEM: CatalogItem = {
  type: 'glb-asset', name: '一张白色圆桌', width: 1.2, depth: 1.2, height: 0.75,
  color: '#ffffff', icon: '◇', price: 0, category: 'decor', source: 'generated',
  materialId: 'asset', assetId: GLB_ID, glbUrl: `http://127.0.0.1:3199/asset/${GLB_ID}.glb`,
};

const card = () => screen.queryByRole('button', { name: '添加一张白色圆桌' });
const seed = (assetId: string, kind: 'glb' | 'spz', name: string, savedAt: number) =>
  rememberAholoAsset({ assetId, kind, name, bytes: 6_433_368, savedAt });

describe('物料库的生成物件', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(loadStoredAholoCatalogItem).mockReset().mockResolvedValue(ITEM);
  });
  afterEach(cleanup);

  it('只列本机落盘的 GLB，场景点云不当作物件', () => {
    seed(GLB_ID, 'glb', '一张白色圆桌', 1);
    seed(SPZ_ID, 'spz', '场地扫描', 2);
    render(<GeneratedItemLibrary onAdd={vi.fn()}/>);
    expect(card()).not.toBeNull();
    expect(screen.queryByRole('button', { name: '添加场地扫描' })).toBeNull();
  });

  it('本机没落过盘时，仓库留档的那几件照样能摆', () => {
    render(<GeneratedItemLibrary onAdd={vi.fn()}/>);
    // 空提示只在两边都没有时才该出现，否则用户以为生成历史全丢了。
    expect(screen.queryByText(/Aholo 接口测试/)).toBeNull();
    expect(screen.getByRole('button', { name: '添加中式木扶手椅' })).not.toBeNull();
  });

  it('仓库留档的物件走同一条摆放链路，失败也不撤这张卡', async () => {
    vi.mocked(loadStoredAholoCatalogItem).mockRejectedValue(new Error('模型下载失败（HTTP 404）。'));
    render(<GeneratedItemLibrary onAdd={vi.fn()}/>);
    fireEvent.click(screen.getByRole('button', { name: '添加中式木扶手椅' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('HTTP 404');
    expect(loadStoredAholoCatalogItem).toHaveBeenCalledWith('shipped-chinese-wood-armchair');
    expect(screen.getByRole('button', { name: '添加中式木扶手椅' })).not.toBeNull();
  });

  it('点击卡片按资产号换回物件，交给现有摆放管线', async () => {
    seed(GLB_ID, 'glb', '一张白色圆桌', 1);
    const onAdd = vi.fn();
    render(<GeneratedItemLibrary onAdd={onAdd}/>);
    fireEvent.click(card()!);
    await waitFor(() => expect(onAdd).toHaveBeenCalledWith(ITEM));
    expect(loadStoredAholoCatalogItem).toHaveBeenCalledWith(GLB_ID);
  });

  it('取回期间只发一次请求，卡片不再假装能点', async () => {
    seed(GLB_ID, 'glb', '一张白色圆桌', 1);
    let finish!: (item: CatalogItem) => void;
    vi.mocked(loadStoredAholoCatalogItem).mockReturnValue(new Promise<CatalogItem>(resolve => { finish = resolve; }));
    const onAdd = vi.fn();
    render(<GeneratedItemLibrary onAdd={onAdd}/>);
    fireEvent.click(card()!);
    expect((card() as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(card()!);
    expect(loadStoredAholoCatalogItem).toHaveBeenCalledTimes(1);
    await act(async () => { finish(ITEM); });
    await waitFor(() => expect(onAdd).toHaveBeenCalledTimes(1));
  });

  it('本机文件已经没了就撤掉这张卡，并说明原因', async () => {
    seed(GLB_ID, 'glb', '一张白色圆桌', 1);
    vi.mocked(loadStoredAholoCatalogItem).mockRejectedValue(new Error('本机已经没有这个模型，请重新生成。'));
    const onAdd = vi.fn();
    render(<GeneratedItemLibrary onAdd={onAdd}/>);
    fireEvent.click(card()!);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('本机已经没有这个模型');
    expect(onAdd).not.toHaveBeenCalled();
    await waitFor(() => expect(card()).toBeNull());
  });

  it('物料满了的时候不偷偷摆放', () => {
    seed(GLB_ID, 'glb', '一张白色圆桌', 1);
    render(<GeneratedItemLibrary disabled onAdd={vi.fn()}/>);
    fireEvent.click(card()!);
    expect(loadStoredAholoCatalogItem).not.toHaveBeenCalled();
  });
});
