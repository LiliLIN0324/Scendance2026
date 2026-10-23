// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeLayout, makeViewSettings } from '../lib/__testfixtures__/fixtures';
import { ReferenceImageControls } from './reference-image-controls';

function props() {
  return { layout: makeLayout({ id: 'A', floorPlanImage: 'data:original', floorPlanOpacity: 0.7 }),
    view: makeViewSettings(), ready: false, notice: '独立测试示意',
    onShow: vi.fn(), onOpacity: vi.fn(), onReview: vi.fn(), onReload: vi.fn() };
}

describe('main canvas reference controls', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  afterEach(() => { cleanup(); });

  it('changes only display callbacks and preserves zero opacity without editing the layout', () => {
    const value = props(), saved = JSON.stringify(value.layout);
    value.view.referenceImageOpacity = 0.5;
    const { rerender } = render(<ReferenceImageControls {...value}/>);
    fireEvent.click(screen.getByLabelText('显示参考底图'));
    fireEvent.change(screen.getByLabelText('底图透明度'), { target: { value: '0' } });
    expect(value.onShow).toHaveBeenCalledWith(false); expect(value.onOpacity).toHaveBeenCalledWith(0);
    rerender(<ReferenceImageControls {...value} view={{ ...value.view, referenceImageOpacity: 0 }}/>);
    expect((screen.getByLabelText('底图透明度') as HTMLInputElement).value).toBe('0');
    expect(JSON.stringify(value.layout)).toBe(saved);
  });
});
