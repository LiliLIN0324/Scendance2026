// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { arrangeAholoSheet } from '../lib/arrange-choices';
import { openGenerationSheet, resetGenerationSheetForTests } from '../lib/generation-sheet';
import { GenerationSheetHost } from '../panels/generation-sheet';
import { ArrangeChoiceList } from './arrange-choice-list';

afterEach(() => {
  cleanup();
  resetGenerationSheetForTests();
});

const choices = [
  {
    slug: 'chair',
    name: '礼堂椅',
    reason: '能力命中 · 场景匹配',
    count: 12,
    thumb: '/showcase/assets/library/thumb/hall-chair.webp',
    templateId: 'chair',
  },
  {
    slug: 'bench',
    name: '长凳',
    reason: '能力命中',
    count: 12,
    thumb: '',
    templateId: 'chair',
  },
];

describe('候选方案条', () => {
  it('列出型号和理由，点一款、换一批、取消都交给父组件', () => {
    const onPick = vi.fn();
    const onRefresh = vi.fn();
    const onCancel = vi.fn();
    render(
      <ArrangeChoiceList
        choices={choices}
        onPick={onPick}
        onRefresh={onRefresh}
        onCancel={onCancel}
        onGenerate={() => undefined}
      />,
    );
    expect(screen.getByRole('group', { name: '候选方案' })).toBeTruthy();
    expect(screen.getByText('能力命中 · 场景匹配 · 12 件')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '礼堂椅' }));
    fireEvent.click(screen.getByRole('button', { name: '换一批' }));
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(onPick).toHaveBeenCalledWith('chair');
    expect(onRefresh).toHaveBeenCalledOnce();
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('有缩略图就显示图片，没有就用折叠椅贴纸', () => {
    render(
      <ArrangeChoiceList
        choices={choices}
        onPick={() => undefined}
        onRefresh={() => undefined}
        onCancel={() => undefined}
        onGenerate={() => undefined}
      />,
    );
    const photo = screen.getByTestId('arrange-choice-thumb').querySelector('img');
    expect(photo?.getAttribute('src')).toBe('/showcase/assets/library/thumb/hall-chair.webp');
    const sticker = screen.getByTestId('arrange-choice-sticker').querySelector('img');
    expect(sticker?.getAttribute('data-oneplan-sticker')).toBe('scale:folding-chair');
    fireEvent.error(photo!);
    expect(screen.getAllByTestId('arrange-choice-sticker')).toHaveLength(2);
  });

  it('用 Aholo 生成一款只通知父组件，不代替点选', () => {
    const onPick = vi.fn();
    const onGenerate = vi.fn();
    render(
      <ArrangeChoiceList
        choices={choices}
        onPick={onPick}
        onRefresh={() => undefined}
        onCancel={() => undefined}
        onGenerate={onGenerate}
      />,
    );
    expect(screen.getByText('确认额度后才会提交，生成完可以在这里预览。')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '用 Aholo 生成一款' }));
    expect(onGenerate).toHaveBeenCalledOnce();
    expect(onPick).not.toHaveBeenCalled();
  });

  it('排布进行中不能再点型号、换一批或生成', () => {
    const onPick = vi.fn();
    const onRefresh = vi.fn();
    const onGenerate = vi.fn();
    render(
      <ArrangeChoiceList
        choices={choices}
        busy
        onPick={onPick}
        onRefresh={onRefresh}
        onCancel={() => undefined}
        onGenerate={onGenerate}
      />,
    );
    const chair = screen.getByRole('button', { name: '礼堂椅' }) as HTMLButtonElement;
    const refresh = screen.getByRole('button', { name: '换一批' }) as HTMLButtonElement;
    const generate = screen.getByRole('button', { name: '用 Aholo 生成一款' }) as HTMLButtonElement;
    expect(chair.disabled).toBe(true);
    expect(refresh.disabled).toBe(true);
    expect(generate.disabled).toBe(true);
    fireEvent.click(chair);
    fireEvent.click(refresh);
    fireEvent.click(generate);
    expect(onPick).not.toHaveBeenCalled();
    expect(onRefresh).not.toHaveBeenCalled();
    expect(onGenerate).not.toHaveBeenCalled();
  });

  it('用 Aholo 生成一款打开现成生成面板，不勾选额度就不能提交', () => {
    resetGenerationSheetForTests();
    const sheet = arrangeAholoSheet('要能坐 12 把', { id: 'booth-1', name: '马戏团售票亭 1' });
    openGenerationSheet(sheet);
    render(<GenerationSheetHost />);
    expect(screen.getByRole('complementary', { name: '生成模型' })).toBeTruthy();
    expect(screen.getByTestId('generation-target').textContent).toContain('用于「马戏团售票亭 1」');
    expect((screen.getByRole('textbox', { name: '描述' }) as HTMLTextAreaElement).value).toBe('一把能坐的椅子');
    const credit = screen.getByRole('checkbox', { name: '消耗额度' }) as HTMLInputElement;
    const submit = screen.getByTestId('generation-primary') as HTMLButtonElement;
    expect(credit.checked).toBe(false);
    expect(submit.disabled).toBe(true);
    fireEvent.click(submit);
    expect(screen.queryByText(/已提交/)).toBeNull();
    resetGenerationSheetForTests();
  });
});
