// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AssetDetailModal } from './asset-detail-modal';

afterEach(cleanup);

describe('AssetDetailModal', () => {
  it('shows the preview, full description and rows; place and close stay separate', () => {
    const onClose = vi.fn();
    const onPlace = vi.fn();
    render(<AssetDetailModal
      open
      title="户外折叠椅"
      image="https://cdn.example.test/chair.png"
      description="户外折叠椅 1：铝合金折叠框架，藏青色厚棉布坐垫靠背，座高 45 厘米"
      rows={[
        { label: '来源', value: 'Aholo Lux3D' },
        { label: '占地', value: '0.45 × 0.5 × 0.88 米' },
      ]}
      onClose={onClose}
      onPlace={onPlace}
    />);

    expect(screen.getByRole('dialog', { name: '户外折叠椅详情' })).toBeTruthy();
    expect(document.querySelector('img')?.getAttribute('src')).toBe('https://cdn.example.test/chair.png');
    expect(screen.getByText(/铝合金折叠框架/)).toBeTruthy();
    expect(screen.getByText('Aholo Lux3D')).toBeTruthy();
    expect(screen.getByText('0.45 × 0.5 × 0.88 米')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '放入场地' }));
    expect(onPlace).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '关闭' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on Escape and does not render when closed', () => {
    const onClose = vi.fn();
    const view = render(<AssetDetailModal open title="木椅" rows={[]} onClose={onClose}/>);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    view.rerender(<AssetDetailModal open={false} title="木椅" rows={[]} onClose={onClose}/>);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
