// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PlanBomPanel } from './plan-bom-panel';
import type { BomFacility } from '../lib/plan-bom';
import type { ComponentProps } from 'react';

afterEach(() => {
  cleanup();
});

const chair = (name = '折叠椅', unitPrice?: number): BomFacility => ({
  name,
  templateId: 'chair',
  modelOverride: 'folding-chair',
  size: { width: 0.55, depth: 0.53 },
  ...(unitPrice !== undefined ? { unitPrice } : {}),
});

function openPanel(props: Partial<ComponentProps<typeof PlanBomPanel>> = {}) {
  const onPriceModel = props.onPriceModel ?? vi.fn();
  const onQuoteChange = props.onQuoteChange ?? vi.fn();
  render(
    <PlanBomPanel
      facilities={props.facilities ?? [chair(), chair(), { ...chair('圆桌'), templateId: 'table', modelOverride: 'round-table', size: { width: 1, depth: 1 } }]}
      quote={props.quote}
      onPriceModel={onPriceModel}
      onQuoteChange={onQuoteChange}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: '物料清单' }));
  return { onPriceModel, onQuoteChange };
}

describe('物料清单面板', () => {
  it('展开后按型号列出未定价，不把缺价写成 0 元', () => {
    openPanel();
    const list = screen.getByLabelText('清单内容').textContent ?? '';
    expect(list).toContain('折叠椅');
    expect(list).toContain('未定价');
    expect(list).not.toContain('¥0');
    expect((screen.getByLabelText('单价-折叠椅') as HTMLInputElement).value).toBe('');
  });

  it('单价失焦写回型号，空值清价', () => {
    const { onPriceModel } = openPanel();
    const input = screen.getByLabelText('单价-折叠椅');
    fireEvent.change(input, { target: { value: '88' } });
    fireEvent.blur(input);
    expect(onPriceModel).toHaveBeenCalledWith('folding-chair', 88);
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.blur(input);
    expect(onPriceModel).toHaveBeenCalledWith('folding-chair', null);
  });

  it('报价抬头改动交给 plan，并显示已经落盘的值', () => {
    const { onQuoteChange } = openPanel({ quote: { projectName: '秋季发布会' } });
    const client = screen.getByLabelText('报价单-客户') as HTMLInputElement;
    const project = screen.getByLabelText('报价单-项目名') as HTMLInputElement;
    expect(project.value).toBe('秋季发布会');
    fireEvent.change(client, { target: { value: '星河品牌部' } });
    expect(onQuoteChange).toHaveBeenCalledWith({ projectName: '秋季发布会', client: '星河品牌部' });
  });

  it('清空最后一个抬头字段时交回 undefined', () => {
    const { onQuoteChange } = openPanel({ quote: { client: '星河品牌部' } });
    fireEvent.change(screen.getByLabelText('报价单-客户'), { target: { value: '' } });
    expect(onQuoteChange).toHaveBeenCalledWith(undefined);
  });
});
