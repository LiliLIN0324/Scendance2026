// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
const LOCAL_LAYOUT_KEY = 'scendance-editor-local-v1';
import { INITIAL_LAYOUT } from '../room-organizer/lib/initial-layout';
import { REVIEW_RETURN_STORAGE_KEY } from './review-return';
import { ReviewSharePage } from './review-share-page';
import { REVIEW_SHARE_PIN_STORAGE_KEY } from './share-pins';
import type { RoomLayout } from '../room-organizer/lib/types';

vi.mock('./review-plan-sheet', () => ({
  ReviewPlanSheet: ({
    onAnchor,
    onCommitPin,
  }: {
    onAnchor(anchor: { itemId: string | null; x: number; z: number }): void;
    onCommitPin(text: string): void;
  }) => (
    <div className="rsp-plan-stage">
      <canvas aria-label="平面预览 mock" />
      <button type="button" onClick={() => onAnchor({ itemId: null, x: 0, z: 0 })}>mock-plan-click</button>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onCommitPin('主舞台偏左');
        }}
      >
        <input aria-label="议题" />
        <button type="submit">钉上</button>
      </form>
    </div>
  ),
  itemNames: (items: readonly { id: string; name: string }[]) => items,
}));

/** Uncompressed `#layout=` fragment. jsdom has no Blob.stream(), so the test skips deflate. */
function layoutHash(layout: RoomLayout): string {
  const bytes = new TextEncoder().encode(JSON.stringify(layout));
  let binary = '';
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  const encoded = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  return `#layout=${encoded}`;
}

afterEach(() => {
  cleanup();
  localStorage.clear();
  window.history.replaceState(null, '', '/review/');
});

async function openSample(): Promise<void> {
  window.history.replaceState(null, '', '/review/?demo=1');
  render(<ReviewSharePage />);
  await screen.findByRole('heading', { name: INITIAL_LAYOUT.name });
}

describe('review share page', () => {
  it('shows the sample plan, drops a pin on the canvas, and keeps it after remount', async () => {
    await openSample();
    expect(screen.getByText(/示例场地/)).toBeTruthy();
    expect(screen.getByText(/共创桌/)).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/晴光|模式轨|执行页|到场清单/);
    expect(document.querySelector('.sc-mode-rail, .sc-agent-panel, #agent-panel, .sc-workbench')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'mock-plan-click' }));
    fireEvent.change(screen.getByRole('textbox', { name: '议题' }), { target: { value: '主舞台偏左' } });
    fireEvent.click(screen.getByRole('button', { name: '钉上' }));
    expect(await screen.findByText('主舞台偏左')).toBeTruthy();
    expect(localStorage.getItem(REVIEW_SHARE_PIN_STORAGE_KEY)).toContain('主舞台偏左');

    cleanup();
    window.history.replaceState(null, '', '/review/?demo=1');
    render(<ReviewSharePage />);
    expect(await screen.findByText('主舞台偏左')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '完成评审' }));
    expect(await screen.findByRole('button', { name: '已完成评审' })).toBeTruthy();
    expect(screen.getByText(/红环/)).toBeTruthy();
    expect(localStorage.getItem(REVIEW_RETURN_STORAGE_KEY)).toContain('sample:initial');
  });

  it('opens a shared snapshot and a saved local plan', async () => {
    window.history.replaceState(null, '', `/review/${layoutHash({ ...INITIAL_LAYOUT, name: '发布会主场' })}`);
    render(<ReviewSharePage />);
    expect(await screen.findByRole('heading', { name: '发布会主场' })).toBeTruthy();
    expect(screen.getByText(/分享链接里的方案快照/)).toBeTruthy();
    cleanup();

    localStorage.setItem(LOCAL_LAYOUT_KEY, JSON.stringify({ ...INITIAL_LAYOUT, name: '本机共创' }));
    window.history.replaceState(null, '', '/review/');
    render(<ReviewSharePage />);
    expect(await screen.findByRole('heading', { name: '本机共创' })).toBeTruthy();
    expect(screen.getByText(/当前保存的布置/)).toBeTruthy();
  });

  it('switches floors and refuses a broken share hash', async () => {
    const loft = {
      ...INITIAL_LAYOUT.floors[0]!,
      id: 'loft',
      name: '二层看台',
      items: [{ ...INITIAL_LAYOUT.floors[0]!.items[0]!, id: 'a0100000-0000-4000-8000-000000000099', name: '看台桌' }],
    };
    window.history.replaceState(null, '', `/review/${layoutHash({
      ...INITIAL_LAYOUT,
      name: '两层发布会',
      floors: [INITIAL_LAYOUT.floors[0]!, loft],
    })}`);
    render(<ReviewSharePage />);
    await screen.findByRole('heading', { name: '两层发布会' });
    fireEvent.click(screen.getByRole('button', { name: '二层看台' }));
    expect(await screen.findByText('看台桌')).toBeTruthy();
    cleanup();

    window.history.replaceState(null, '', '/review/#layout=!!!');
    render(<ReviewSharePage />);
    expect((await screen.findByRole('alert')).textContent).toMatch(/读不出来/);
    expect(document.querySelector('.rsp-plan-stage canvas')).toBeNull();
  });
});
