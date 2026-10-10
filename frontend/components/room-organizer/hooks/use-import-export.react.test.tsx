// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeLayout } from '../lib/__testfixtures__/fixtures';
import { notify } from '../lib/editor-notices';
import { downloadCanvasAsPng } from '../lib/file-io';
import { useImportExport } from './use-import-export';
import type { LayoutActions } from './use-layout-state';
import type * as ThreeNS from 'three';

vi.mock('../lib/editor-notices', () => ({ notify: vi.fn() }));
vi.mock('../lib/file-io', () => ({
  downloadCanvasAsPng: vi.fn(),
  downloadSceneAsGlb: vi.fn(),
  readLayoutFromFile: vi.fn(),
}));

function mountScreenshot(options: {
  view2D?: boolean;
  render?: ReturnType<typeof vi.fn>;
} = {}) {
  const canvas = document.createElement('canvas');
  const canvas2D = document.createElement('canvas');
  const render = options.render ?? vi.fn();
  const scene = {} as ThreeNS.Scene;
  const camera = {} as ThreeNS.PerspectiveCamera;
  const renderer = { render } as unknown as ThreeNS.WebGLRenderer;
  const { result } = renderHook(() => useImportExport({
    layout: makeLayout({ name: '测试场景' }),
    actions: {} as LayoutActions,
    view2D: options.view2D ?? false,
    canvasRef: { current: canvas },
    canvas2DRef: { current: canvas2D },
    rendererRef: { current: renderer },
    sceneRef: { current: scene },
    cameraRef: { current: camera },
    onImported: vi.fn(),
  }));
  return { result, canvas, canvas2D, render };
}

async function settleScreenshot(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function expectFriendlySingleError(rawMessage?: string): void {
  expect(vi.mocked(notify)).toHaveBeenCalledOnce();
  const [message, tone] = vi.mocked(notify).mock.calls[0]!;
  expect(tone).toBe('error');
  expect(message).toMatch(/[\u4e00-\u9fff]/);
  if (rawMessage) expect(message).not.toContain(rawMessage);
}

describe('useImportExport screenshot error channel', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it.each([false, true])('does not show a failure notice after a successful %s screenshot', async view2D => {
    vi.mocked(downloadCanvasAsPng).mockResolvedValue(true);
    const mounted = mountScreenshot({ view2D });

    act(() => mounted.result.current.handleScreenshot());
    await settleScreenshot();

    expect(downloadCanvasAsPng).toHaveBeenCalledWith(view2D ? mounted.canvas2D : mounted.canvas, '测试场景');
    expect(notify).not.toHaveBeenCalled();
    if (view2D) expect(mounted.render).not.toHaveBeenCalled();
    else expect(mounted.render).toHaveBeenCalledOnce();
  });

  it('shows one friendly Chinese notice when PNG encoding returns false', async () => {
    vi.mocked(downloadCanvasAsPng).mockResolvedValue(false);
    const mounted = mountScreenshot();

    act(() => mounted.result.current.handleScreenshot());
    await settleScreenshot();

    expectFriendlySingleError();
  });

  it.each([
    ['SecurityError', new DOMException('The operation is insecure', 'SecurityError')],
    ['private URL failure', new Error('download failed for blob:https://private.example/private-token')],
  ] as const)('turns a %s download rejection into one safe Chinese notice', async (_label, error) => {
    const rawMessage = error.message;
    vi.mocked(downloadCanvasAsPng).mockRejectedValue(error);
    const mounted = mountScreenshot();

    act(() => mounted.result.current.handleScreenshot());
    await settleScreenshot();

    expectFriendlySingleError(rawMessage);
  });

  it('turns a synchronous 3D render failure into one notice and does not download', () => {
    const error = new Error('renderer failed for blob:https://private.example/render-token');
    const mounted = mountScreenshot({ render: vi.fn(() => { throw error; }) });

    expect(() => mounted.result.current.handleScreenshot()).not.toThrow();

    expect(downloadCanvasAsPng).not.toHaveBeenCalled();
    expectFriendlySingleError(error.message);
  });
});
