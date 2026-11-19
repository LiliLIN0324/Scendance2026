// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { VenueConfirmCard } from './agent-confirm-cards';

/**
 * T1-a（2026-11-19）：失败卡必须说清「试了什么 / 已保留什么 / 下一步」，
 * 不再只要求用户「换个说法」。
 */
describe('VenueConfirmCard 失败态（T1-a）', () => {
  const emptyState = { query: '西湖草坪婚礼', candidates: [], loading: false, picking: null };

  it('没候选时说清已保留内容与三条下一步，不只要求换说法', () => {
    render(<VenueConfirmCard state={emptyState} onPick={vi.fn()} onDismiss={vi.fn()} />);

    expect(screen.getByText(/没搜到匹配「西湖草坪婚礼」的场地/)).toBeTruthy();
    expect(screen.getByText(/当前方案没有改动/)).toBeTruthy();
    expect(screen.getByText(/下一步可以/)).toBeTruthy();
    // 旧的「换个说法再说一句」式甩锅文案不再出现
    expect(screen.queryByText(/换个说法再说一句/)).toBeNull();
  });

  it('没候选时给地图手动圈画入口，不用用户自己找右栏', () => {
    const onManual = vi.fn();
    render(<VenueConfirmCard state={emptyState} onPick={vi.fn()} onDismiss={vi.fn()} onManual={onManual} />);
    screen.getByRole('button', { name: '在地图上手动圈画' }).click();
    expect(onManual).toHaveBeenCalledOnce();
  });

  it('有候选时拒绝按钮不要求用户改说法', () => {
    const state = {
      query: '西湖草坪婚礼',
      candidates: [{ id: 'p1', name: '示例草坪', address: '杭州' }],
      loading: false,
      picking: null,
    } as unknown as Parameters<typeof VenueConfirmCard>[0]['state'];
    render(<VenueConfirmCard state={state} onPick={vi.fn()} onDismiss={vi.fn()} />);

    expect(screen.getByText('都不合适，按条件再找')).toBeTruthy();
    expect(screen.queryByText('都不是，换个说法')).toBeNull();
  });
});
