// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { VenueConfirmCard } from './agent-confirm-cards';

// globals 未开启时 Testing Library 不会自动卸载上一用例的 DOM，渲染次数一多就会串页。
afterEach(cleanup);

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

/**
 * 幕景Agent Test B 步（2026-11-22，用户截图 A3）：新会话一次都没确认过场地/边界/分区，
 * 卡片却写「已确认的场地、边界和分区都原样保留」。按位置钉住：
 * 没有 scopeConfirmed 时该位置不渲染「已确认」，也不给「先按当前场地往下做」。
 */
describe('VenueConfirmCard 无候选时按实际状态说话', () => {
  const emptyState = { query: '临安青山湖水上森林', candidates: [], loading: false, picking: null };

  it('一次都没确认过：不说「已确认」，不给「先按当前场地往下做」', () => {
    render(<VenueConfirmCard state={emptyState} onPick={vi.fn()} onDismiss={vi.fn()} />);

    expect(screen.queryByText(/已确认的场地、边界和分区/)).toBeNull();
    expect(screen.queryByText(/先按当前场地往下做/)).toBeNull();
    expect(screen.getByText('没搜到匹配「临安青山湖水上森林」的场地。当前方案没有改动。')).toBeTruthy();
  });

  it('确实确认过：保留「已确认…原样保留」与第三条出路', () => {
    render(<VenueConfirmCard state={emptyState} scopeConfirmed onPick={vi.fn()} onDismiss={vi.fn()} />);

    expect(screen.getByText(/已确认的场地、边界和分区都原样保留/)).toBeTruthy();
    expect(screen.getByText(/先按当前场地往下做/)).toBeTruthy();
  });

  it('检索失败与没搜到分开说：失败时不承认「没这个场地」', () => {
    render(<VenueConfirmCard state={{ ...emptyState, failed: true }} onPick={vi.fn()} onDismiss={vi.fn()} />);

    expect(screen.getByText('检索「临安青山湖水上森林」暂时失败，不代表没这个场地。当前方案没有改动。')).toBeTruthy();
    expect(screen.getByText('下一步可以：① 再说一次重试；② 在地图上手动圈画。')).toBeTruthy();
    // 失败状态下不得说成「没搜到」
    expect(screen.queryByText(/没搜到匹配/)).toBeNull();
  });
});
