// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { VenuePhotosPanel } from './venue-photos-panel';

afterEach(cleanup);
const photo = { id: 'photo-one', name: '场地.jpg', url: 'blob:local-venue' };

describe('venue photo viewer', () => {
  it('opens directly from the thumbnail, traps focus, and restores focus on Escape', async () => {
    render(<VenuePhotosPanel images={[photo]} addImages={vi.fn()} removeImage={vi.fn()}/>);
    const thumbnail = screen.getByRole('button', { name: '放大 场地.jpg' });
    thumbnail.focus();
    fireEvent.click(thumbnail);
    const dialog = screen.getByRole('dialog', { name: '现场照片预览：场地.jpg' });
    const close = screen.getByRole('button', { name: '关闭照片预览' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(screen.getByRole('img', { name: '放大现场照片：场地.jpg' }).getAttribute('src')).toBe(photo.url);
    await waitFor(() => expect(document.activeElement).toBe(close));
    fireEvent.keyDown(close, { key: 'Tab' });
    expect(document.activeElement).toBe(close);
    fireEvent.keyDown(close, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(thumbnail);
  });

  it('passes only the selected image ID for deletion, leaving URL ownership in the provider', () => {
    const removeImage = vi.fn();
    render(<VenuePhotosPanel images={[photo]} addImages={vi.fn()} removeImage={removeImage}/>);
    fireEvent.click(screen.getByRole('button', { name: '移除 场地.jpg' }));
    expect(removeImage).toHaveBeenCalledExactlyOnceWith(photo.id);
  });

  it('keeps local photos through a hidden introduction round trip', async () => {
    const addImages = vi.fn(), removeImage = vi.fn();
    const view = (hidden: boolean) => <div hidden={hidden}><VenuePhotosPanel images={[photo]} addImages={addImages} removeImage={removeImage}/></div>;
    const rendered = render(view(false));
    rendered.rerender(view(true));
    expect(screen.queryByRole('img')).toBeNull();
    rendered.rerender(view(false));
    expect(screen.getByRole('img', { name: '现场照片：场地.jpg' }).getAttribute('src')).toBe(photo.url);
    fireEvent.click(screen.getByRole('button', { name: '放大 场地.jpg' }));
    expect(screen.getByText('仅在本机查看 · 图片尚未提交给模型')).toBeTruthy();
    expect(removeImage).not.toHaveBeenCalled();
  });

  it('places the enlarged image above the clipping material drawer but inside the editor', () => {
    const rendered = render(<div className="sc-workbench"><aside className="sc-library"><VenuePhotosPanel images={[photo]} addImages={vi.fn()} removeImage={vi.fn()}/></aside></div>);
    fireEvent.click(screen.getByRole('button', { name: '放大 场地.jpg' }));
    const lightbox = rendered.container.querySelector('.vp-lightbox')!;
    expect(lightbox.parentElement?.className).toBe('sc-workbench');
    expect(rendered.container.querySelector('.sc-library')!.contains(lightbox)).toBe(false);
  });
});
