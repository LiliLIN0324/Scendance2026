// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Lux3dDirectTest } from './lux3d-direct-test';
import { RECON_MATERIAL_BAN, CREDIT_CONFIRM_LABEL, VENUE_PACKAGE_MISSING, MOCK_HANG_DONE_NOTE } from '../lib/site-recon-mock';

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

/** 本机代理在这段测试里不需要活着：/health 一律回不起，只验证标签与预设的落地。 */
function offline() {
  const fetchMock = vi.fn(() => Promise.reject(new TypeError('proxy down')));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const card = (name: '场景生成' | '场地重建') => screen.getByRole('radio', { name: new RegExp(`^${name}`) });
const venue = (name: '场景生成' | '场地重建') => within(screen.getByRole('region', { name }));

describe('Aholo 场地重建接住地图采集单', () => {
  it('采集单送来一块地时自动切到场地重建，名字和应拍数量都带过来', async () => {
    offline();
    const { rerender } = render(<Lux3dDirectTest/>);
    expect(card('场景生成').getAttribute('aria-checked')).toBe('true');

    rerender(<Lux3dDirectTest reconPreset={{ name: '盐官潮乐之城', hint: '12 个站位 · 共 24 张' }}/>);
    await vi.waitFor(() => {
      expect(card('场地重建').getAttribute('aria-checked')).toBe('true');
    });
    expect((venue('场地重建').getByLabelText('场景名称') as HTMLInputElement).value).toBe('盐官潮乐之城');
    expect(screen.getByText(/这块地的采集单：12 个站位 · 共 24 张/)).toBeTruthy();
  });

  it('没有采集单时不抢她的输入：名字保持默认，也不凭空多一行提示', async () => {
    offline();
    render(<Lux3dDirectTest/>);
    fireEvent.click(card('场地重建'));
    await vi.waitFor(() => { expect(card('场地重建').getAttribute('aria-checked')).toBe('true'); });
    expect((venue('场地重建').getByLabelText('场景名称') as HTMLInputElement).value).toBe('Scendance 场景测试');
    expect(screen.queryByText(/这块地的采集单/)).toBeNull();
  });

  it('默认干跑：选一段视频可完成并回调挂载，不打代理', async () => {
    const fetchMock = offline();
    const onHang = vi.fn();
    render(<Lux3dDirectTest onHangMockScene={onHang} reconPreset={{ name: '盐官潮乐之城', hint: '12 个站位 · 共 24 张' }}/>);
    await vi.waitFor(() => {
      expect(card('场地重建').getAttribute('aria-checked')).toBe('true');
    });
    expect(screen.getByText(RECON_MATERIAL_BAN)).toBeTruthy();
    expect(screen.getByRole('checkbox', { name: /干跑模拟/ })).toBeTruthy();
    const input = venue('场地重建').getByLabelText('场地素材') as HTMLInputElement;
    const clip = new File([new Uint8Array([1, 2, 3])], '绕场.mp4', { type: 'video/mp4' });
    fireEvent.change(input, { target: { files: [clip] } });
    // health 的失败请求可能已发出；清空后再点干跑，确认重建路径不再打代理。
    fetchMock.mockClear();
    fireEvent.click(screen.getByRole('button', { name: '干跑重建（不扣额度）' }));
    await vi.waitFor(() => {
      expect(screen.getByRole('button', { name: '挂样例环境预览（仍缺本场包）' })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole('button', { name: '挂样例环境预览（仍缺本场包）' }));
    expect(onHang).toHaveBeenCalledTimes(1);
    expect(screen.getByText(MOCK_HANG_DONE_NOTE)).toBeTruthy();
    expect(screen.getByText(VENUE_PACKAGE_MISSING)).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('场地观感只出场地', () => {
  it('两张卡只有场景生成与场地重建，没有物料的文字 / 图片建模', () => {
    offline();
    render(<Lux3dDirectTest/>);
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(screen.getAllByRole('radio').map(item => item.textContent)).toEqual([
      expect.stringContaining('场景生成'), expect.stringContaining('场地重建'),
    ]);
    expect(screen.queryByText('文字建模')).toBeNull();
    expect(screen.queryByText('图片建模')).toBeNull();
    expect(screen.queryByText('物料生成')).toBeNull();
  });

  it('点生成给哪个 kind 就直接选中哪张卡', async () => {
    offline();
    const { rerender } = render(<Lux3dDirectTest/>);
    expect(card('场景生成').getAttribute('aria-checked')).toBe('true');
    rerender(<Lux3dDirectTest openKind={{ kind: 'world', nonce: 1 }}/>);
    await vi.waitFor(() => {
      expect(card('场景生成').getAttribute('aria-checked')).toBe('true');
    });
    rerender(<Lux3dDirectTest openKind={{ kind: 'recon', nonce: 2 }}/>);
    await vi.waitFor(() => {
      expect(card('场地重建').getAttribute('aria-checked')).toBe('true');
    });
  });
});

describe('Aholo 产品化壳体', () => {
  it('面板标题是场地观感，并写明主路径与禁令', () => {
    offline();
    render(<Lux3dDirectTest/>);
    expect(screen.getByRole('heading', { name: '场地观感' })).toBeTruthy();
    expect(screen.getAllByText(/物料生成在 Bingo 的「物料生成」里/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/主路径：地图圈画/).length).toBeGreaterThan(0);
    expect(screen.getByText(/卫星不可作重建素材/)).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Aholo 接口测试' })).toBeNull();
    const gated = screen.getByRole('button', { name: '先勾选扣额度确认闸' }) as HTMLButtonElement;
    expect(gated.disabled).toBe(true);
    fireEvent.click(gated);
    expect(screen.queryByText(/正在提交/)).toBeNull();
  });

  it('采集单预设时显示来源条并切到场地重建', async () => {
    offline();
    render(<Lux3dDirectTest reconPreset={{ name: '盐官潮乐之城', hint: '12 个站位 · 共 24 张' }}/>);
    await vi.waitFor(() => {
      expect(card('场地重建').getAttribute('aria-checked')).toBe('true');
    });
    expect(screen.getByText(/来自采集单「盐官潮乐之城」/)).toBeTruthy();
  });
});

describe('D2 真重建闸与本场包状态', () => {
  it('关干跑后须勾选扣额度确认闸才可真提交；未勾选按钮不可点', async () => {
    offline();
    render(<Lux3dDirectTest reconPreset={{ name: '盐官潮乐之城', hint: '12 个站位 · 共 24 张' }}/>);
    await vi.waitFor(() => {
      expect(card('场地重建').getAttribute('aria-checked')).toBe('true');
    });
    fireEvent.click(screen.getByRole('checkbox', { name: /干跑模拟/ }));
    expect(screen.getByText(/已关掉干跑/)).toBeTruthy();
    expect(screen.getByRole('checkbox', { name: CREDIT_CONFIRM_LABEL })).toBeTruthy();
    const input = venue('场地重建').getByLabelText('场地素材') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File([new Uint8Array([1])], '绕场.mp4', { type: 'video/mp4' })] } });
    // offline：代理未就绪，即使勾选确认闸按钮仍因 online!==true 不可点；先断言未勾选时文案是确认闸提示。
    expect(screen.getByRole('button', { name: '先勾选扣额度确认闸' })).toBeTruthy();
    expect((screen.getByRole('button', { name: '先勾选扣额度确认闸' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('干跑成功后标明仍缺本场包，不冒充本场', async () => {
    const fetchMock = offline();
    const onHang = vi.fn();
    render(<Lux3dDirectTest onHangMockScene={onHang} reconPreset={{ name: '盐官潮乐之城', hint: '12 个站位 · 共 24 张' }}/>);
    await vi.waitFor(() => {
      expect(card('场地重建').getAttribute('aria-checked')).toBe('true');
    });
    expect(screen.getByText(/仍缺本场包/)).toBeTruthy();
    fireEvent.change(venue('场地重建').getByLabelText('场地素材'), {
      target: { files: [new File([new Uint8Array([1])], '绕场.mp4', { type: 'video/mp4' })] },
    });
    fetchMock.mockClear();
    fireEvent.click(screen.getByRole('button', { name: '干跑重建（不扣额度）' }));
    await vi.waitFor(() => {
      expect(screen.getByText(VENUE_PACKAGE_MISSING)).toBeTruthy();
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
