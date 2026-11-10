// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { OneplanSticker } from './oneplan-stickers';

describe('OneplanSticker（图例/面板贴纸组件）', () => {
  it('有贴纸时渲染 <img>，指向 /oneplan-icons 下对应文件并带 data 标记', () => {
    const { container } = render(
      <OneplanSticker sticker={{ kind: 'scale', slug: 'market-stall', icon: 'tent' }} title="市集摊位" />,
    );
    const img = container.querySelector('img')!;
    expect(img).toBeTruthy();
    expect(img.getAttribute('src')).toBe('/oneplan-icons/scale-fg/market-stall.svg');
    expect(img.getAttribute('data-oneplan-sticker')).toBe('scale:market-stall');
    expect(img.getAttribute('alt')).toBe('市集摊位');
  });

  it('没有贴纸时直接回落 Lucide 图标（svg），不会白屏', () => {
    const { container } = render(<OneplanSticker sticker={null} fallbackIcon="users" />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('svg')).toBeTruthy();
  });

  it('贴纸文件 404（onError）时回落到 Lucide 图标', () => {
    const { container } = render(<OneplanSticker sticker={{ kind: 'icon', slug: 'missing-asset', icon: 'users' }} />);
    const img = container.querySelector('img')!;
    expect(img).toBeTruthy();
    fireEvent.error(img);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('svg')).toBeTruthy();
  });
});