// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { MaterialThumb, clearMaterialThumbCache, warmMaterialThumbs } from './material-thumb';

afterEach(() => { cleanup(); clearMaterialThumbCache(); });

/** 用替身换掉 new Image()：记录请求过哪些地址，可选地立刻回一个 onload。 */
function stubImage(loadImmediately = true): { sources: string[]; restore(): void } {
  const sources: string[] = [];
  const Original = window.Image;
  class FakeImage {
    decoding = '';
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    set src(value: string) {
      sources.push(value);
      if (loadImmediately) this.onload?.();
    }
  }
  // @ts-expect-error 只在本用例里换掉构造器
  window.Image = FakeImage;
  return { sources, restore: () => { window.Image = Original; } };
}

describe('MaterialThumb 缩略图缓存', () => {
  it('同一张图第二次挂载直接是已载入，不再先立占位', () => {
    const src = '/showcase/assets/library/thumb/reused.webp';
    const first = render(<MaterialThumb src={src}/>);
    expect(first.container.querySelector('.sc-material-thumb-loading')).toBeTruthy();
    fireEvent.load(first.container.querySelector('img')!);
    expect(first.container.querySelector('img')!.className).toContain('is-loaded');
    expect(first.container.querySelector('.sc-material-thumb-loading')).toBeNull();
    first.unmount();

    const second = render(<MaterialThumb src={src}/>);
    expect(second.container.querySelector('.sc-material-thumb-loading')).toBeNull();
    expect(second.container.querySelector('img')!.className).toContain('is-loaded');
  });

  it('换成另一张图按未载入重来，不沿用上一张的结果', () => {
    const view = render(<MaterialThumb src="/t/one.webp"/>);
    fireEvent.load(view.container.querySelector('img')!);
    view.rerender(<MaterialThumb src="/t/two.webp"/>);
    expect(view.container.querySelector('.sc-material-thumb-loading')).toBeTruthy();
    expect(view.container.querySelector('img')!.className).not.toContain('is-loaded');
  });

  it('载入失败的图记下结果，重开面板不再反复重试同一张', () => {
    const src = '/t/broken.webp';
    const first = render(<MaterialThumb src={src}/>);
    fireEvent.error(first.container.querySelector('img')!);
    expect(first.container.textContent).toContain('预览未载入');
    first.unmount();

    const second = render(<MaterialThumb src={src}/>);
    expect(second.container.textContent).toContain('预览未载入');
    expect(second.container.querySelector('img')).toBeNull();
  });

  it('预热过的图挂载即已载入，重复预热不再多发请求', () => {
    const stub = stubImage();
    try {
      warmMaterialThumbs(['/t/a.webp', '/t/b.webp', '/t/a.webp']);
      warmMaterialThumbs(['/t/a.webp', '/t/b.webp']);
      expect(stub.sources).toEqual(['/t/a.webp', '/t/b.webp']);
    } finally { stub.restore(); }

    const view = render(<MaterialThumb src="/t/a.webp"/>);
    expect(view.container.querySelector('.sc-material-thumb-loading')).toBeNull();
    expect(view.container.querySelector('img')!.className).toContain('is-loaded');
  });
});
