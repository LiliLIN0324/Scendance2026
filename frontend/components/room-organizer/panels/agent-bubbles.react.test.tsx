// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { Bubbles, type Bubble } from './agent-bubbles';

it('renders the current outdoor question once, after its thought record', () => {
  const bubbles: Bubble[] = [
    { id: 'previous', role: 'agent', text: '要办什么活动？', outdoorQuestion: true },
    { id: 'request', role: 'user', text: '帮我设计一下场地' },
    { id: 'question', role: 'agent', text: '请补充：①活动类型；②预计人数；③室内区域用途。', outdoorQuestion: true },
  ];
  render(<Bubbles bubbles={bubbles} sessionKey="fixture" beforeLatestQuestion={<details><summary>思考记录</summary></details>}
    onPickOption={vi.fn()} onOpenMaterials={vi.fn()} />);
  const thought = screen.getByText('思考记录');
  const question = screen.getByRole('region', { name: '待你回复' });
  expect(thought.compareDocumentPosition(question) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(screen.getAllByText('请补充：')).toHaveLength(1);
  expect(within(question).getAllByRole('listitem')).toHaveLength(3);
  expect(screen.getByRole('region', { name: '追问' })).toBeTruthy();
});
