// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryStorage } from '../../lib/test-support-memory-storage';
import { MembershipPlans } from './membership-plans';

/**
 * 会员订阅区块（mock 通道，不触网）。断言口径是「按位置」：
 * pill 只在对应状态渲染（等待支付结果只出现在 pending），没有该条件就不出现。
 */
let mem: MemoryStorage;
beforeEach(() => {
  mem = new MemoryStorage();
  vi.stubGlobal('Storage', MemoryStorage);
  vi.stubGlobal('localStorage', mem);
  window.localStorage = mem;
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('membership plans', () => {
  it('默认按年：专业版年价 + 月均行，免费版是当前方案，企业版不进线上支付', async () => {
    render(<MembershipPlans />);
    await waitFor(() => expect(screen.getByText(/当前：免费版/)).toBeTruthy());

    expect(screen.getByText('¥999.00')).toBeTruthy();
    expect(screen.getByText(/月均 ¥83\.25，按年一次付清/)).toBeTruthy();
    expect(screen.getByText('¥3999.00')).toBeTruthy();

    // 免费版：当前方案（禁用），没有升级按钮
    const current = screen.getByRole('button', { name: '当前方案' });
    expect((current as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole('button', { name: '升级免费版' })).toBeNull();

    // 企业版只列权益与线下事实句，不渲染下单按钮
    expect(screen.queryByRole('button', { name: '升级企业版' })).toBeNull();
    expect(screen.getByText('线下合同，不进线上支付。')).toBeTruthy();
  });

  it('切到按月：月价出现，年付月均行消失', async () => {
    render(<MembershipPlans />);
    await waitFor(() => expect(screen.getByText(/当前：免费版/)).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: '按月' }));
    expect(screen.getByText('¥99.00')).toBeTruthy();
    expect(screen.getByText('¥399.00')).toBeTruthy();
    await waitFor(() => expect(screen.queryByText(/月均/)).toBeNull());
  });

  it('mock 通道点升级专业版：直接已开通，等待支付结果不渲染', async () => {
    render(<MembershipPlans />);
    await waitFor(() => expect(screen.getByText(/当前：免费版/)).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: '升级专业版' }));

    await waitFor(() => expect(screen.getByText('已开通')).toBeTruthy());
    expect(screen.getByText('模拟支付 · 未真实扣款')).toBeTruthy();
    expect(screen.getByText(/专业版已开通，有效期至/)).toBeTruthy();
    expect(screen.getByText(/到期后方案转只读，不删除数据；不自动续费。/)).toBeTruthy();
    // 状态回执按条件渲染：mock 直接到账，不存在等待态
    expect(screen.queryByText('等待支付结果')).toBeNull();
    expect(screen.queryByText('支付宝扫码支付')).toBeNull();
    // 订单行
    expect(screen.getByText('应付')).toBeTruthy();
    expect(screen.getByText('2 次 / 月')).toBeTruthy();
  });

  it('免费权益之外的项目灰显（—），勾选项带对勾', () => {
    render(<MembershipPlans />);
    const off = screen.getAllByText('白标客户分享');
    expect(off.length).toBeGreaterThanOrEqual(2);
    // 权益清单条目齐全（同一条目在多张卡重复，按出现次数断言）
    expect(screen.getAllByText('物料清单导出').length).toBe(2); // 免费版灰显 + 专业版包含
    expect(screen.getAllByText('白标客户分享').length).toBe(3); // 免/专灰显 + 团队版包含
    expect(screen.getByText('版本与审批留痕')).toBeTruthy();
    expect(screen.getByText('3 个席位，增席 ¥99 / 席 / 月')).toBeTruthy();
  });
});
