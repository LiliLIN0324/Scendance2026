// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { Bubbles, type Bubble } from './agent-bubbles';

it('renders the latest outdoor question once, as the last bubble', () => {
  const bubbles: Bubble[] = [
    { id: 'previous', role: 'agent', text: '要办什么活动？', outdoorQuestion: true },
    { id: 'request', role: 'user', text: '帮我设计一下场地' },
    { id: 'question', role: 'agent', text: '请补充：①活动类型；②预计人数；③室内区域用途。', outdoorQuestion: true },
  ];
  const { container } = render(<Bubbles bubbles={bubbles} sessionKey="fixture"
    onPickOption={vi.fn()} onOpenMaterials={vi.fn()} />);
  const question = screen.getByRole('region', { name: '待你回复' });
  // 当前问题只出现一次，且仍是气泡区的最后一格：卡片不再插进这一格，滚动锚点由 .ap-feed 钉底。
  expect(screen.getAllByRole('region', { name: '待你回复' })).toHaveLength(1);
  expect(container.querySelectorAll('.ap-bubble-wrap').item(container.querySelectorAll('.ap-bubble-wrap').length - 1)?.contains(question)).toBe(true);
  expect(screen.getAllByText('请补充：')).toHaveLength(1);
  expect(within(question).getAllByRole('listitem')).toHaveLength(3);
  expect(screen.getByRole('region', { name: '追问' })).toBeTruthy();
});
