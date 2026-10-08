// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeLayout, makeViewSettings } from '../lib/__testfixtures__/fixtures';
import { readImageAsDataUrl } from '../lib/file-io';
import { ReferenceImageControls } from './reference-image-controls';

vi.mock('../lib/file-io', () => ({ readImageAsDataUrl: vi.fn() }));
class ControlledImage {
  static instances: ControlledImage[] = [];
  naturalWidth = 0; naturalHeight = 0;
  onload: (() => void) | null = null; onerror: (() => void) | null = null;
  src = '';
  constructor() { ControlledImage.instances.push(this); }
  load() { this.naturalWidth = 100; this.naturalHeight = 50; this.onload?.(); }
}
function props() {
  return { layout: makeLayout({ id: 'A', floorPlanImage: 'data:original', floorPlanOpacity: 0.7 }),
    view: makeViewSettings(), ready: false, notice: '独立测试示意',
    onShow: vi.fn(), onOpacity: vi.fn(), onLegacyUpload: vi.fn(), onReview: vi.fn(), onReload: vi.fn() };
}
function choose(file?: File) {
  fireEvent.change(screen.getByLabelText('上传示意平面图'), { target: { files: file ? [file] : [] } });
}

describe('main canvas reference controls', () => {
  beforeEach(() => { vi.clearAllMocks(); ControlledImage.instances = []; vi.stubGlobal('Image', ControlledImage); vi.mocked(readImageAsDataUrl).mockResolvedValue('data:image/png;base64,NEW'); });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it('changes only display callbacks and preserves zero opacity without editing the layout', () => {
    const value = props(), saved = JSON.stringify(value.layout);
    value.view.referenceImageOpacity = 0.5;
    const { rerender } = render(<ReferenceImageControls {...value}/>);
    fireEvent.click(screen.getByLabelText('显示参考底图'));
    fireEvent.change(screen.getByLabelText('底图透明度'), { target: { value: '0' } });
    expect(value.onShow).toHaveBeenCalledWith(false); expect(value.onOpacity).toHaveBeenCalledWith(0);
    rerender(<ReferenceImageControls {...value} view={{ ...value.view, referenceImageOpacity: 0 }}/>);
    expect((screen.getByLabelText('底图透明度') as HTMLInputElement).value).toBe('0');
    expect(JSON.stringify(value.layout)).toBe(saved); expect(value.onLegacyUpload).not.toHaveBeenCalled();
  });

  it.each(['type', 'size'] as const)('ignores cancellation and rejects a bad file %s without reading or replacing the original', async invalid => {
    const value = props(); render(<ReferenceImageControls {...value}/>); choose();
    const file = new File(['test'], 'test.png', { type: invalid === 'type' ? 'application/pdf' : 'image/png' });
    if (invalid === 'size') Object.defineProperty(file, 'size', { value: 10 * 1024 * 1024 + 1 });
    choose(file);
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(readImageAsDataUrl).not.toHaveBeenCalled(); expect(value.onLegacyUpload).not.toHaveBeenCalled();
    expect(value.layout.floorPlanImage).toBe('data:original');
  });

  it('does not apply an unreadable decoded image', async () => {
    const value = props(); render(<ReferenceImageControls {...value}/>);
    choose(new File(['broken'], 'broken.png', { type: 'image/png' }));
    await waitFor(() => expect(ControlledImage.instances).toHaveLength(1));
    await act(async () => ControlledImage.instances[0].onerror?.());
    expect(screen.getByRole('alert').textContent).toContain('无法读取');
    expect(value.onLegacyUpload).not.toHaveBeenCalled(); expect(value.onShow).not.toHaveBeenCalled();
  });

  it.each(['read-layout-edit', 'decode-scope-switch'] as const)('rejects a late upload after %s', async transition => {
    let resolve!: (value: string) => void;
    vi.mocked(readImageAsDataUrl).mockReturnValueOnce(new Promise<string>(finish => { resolve = finish; }));
    const value = props(), { rerender } = render(<ReferenceImageControls {...value}/>);
    choose(new File(['pixels'], 'late.png', { type: 'image/png' }));
    if (transition === 'read-layout-edit') rerender(<ReferenceImageControls {...value} layout={{ ...value.layout, name: 'edited while reading' }}/>);
    await act(async () => resolve('data:image/png;base64,LATE'));
    expect(ControlledImage.instances).toHaveLength(1);
    if (transition === 'decode-scope-switch') rerender(<ReferenceImageControls {...value} layout={{ ...value.layout, id: 'B' }}/>);
    await act(async () => ControlledImage.instances[0].load());
    expect(value.onLegacyUpload).not.toHaveBeenCalled(); expect(value.onShow).not.toHaveBeenCalled();
    if (transition === 'read-layout-edit') expect(screen.getByRole('alert').textContent).toContain('场景已变化');
    else expect(screen.queryByRole('alert')).toBeNull();
  });
});
