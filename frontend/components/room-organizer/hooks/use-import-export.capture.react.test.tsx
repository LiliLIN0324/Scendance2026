// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeLayout } from '../lib/__testfixtures__/fixtures';
import { useImportExport, type UseImportExportResult } from './use-import-export';

/**
 * 2026-11-19 用户：「把 captureRenderImage / exportRenderImage 换成 OutdoorPlan3D 的 captureImage」。
 * 可见画面只有 OutdoorPlan3D（室内 Viewport 退役隐藏），抓帧必须先问它要；
 * 这里把这条优先级钉住，避免以后又退回隐藏渲染器、导出成空白图。
 */
const layout = makeLayout();
const actions = { applyLayout: vi.fn() } as never;

function mountCapture(options: {
  capture3D?: (input: { view: unknown; scale: number }) => Promise<string | null>;
  view2D?: boolean;
  flat?: string;
}) {
  let api: UseImportExportResult | null = null;
  function Probe() {
    api = useImportExport({
      layout,
      actions,
      view2D: options.view2D ?? false,
      canvasRef: useRef(null) as never,
      canvas2DRef: useRef(options.flat ? ({ toDataURL: () => options.flat } as unknown as HTMLCanvasElement) : null) as never,
      rendererRef: useRef(null) as never,
      sceneRef: useRef(null) as never,
      cameraRef: useRef(null) as never,
      ...(options.capture3D ? { capture3D: options.capture3D as never } : {}),
      onImported: vi.fn(),
    });
    return null;
  }
  render(<Probe />);
  return () => api!;
}

afterEach(cleanup);

describe('captureRenderImage 取图来源', () => {
  it('3D 成图先问可见画布（OutdoorPlan3D），不再走室内渲染器', async () => {
    const shot = 'data:image/png;base64,OUTDOOR';
    const capture3D = vi.fn(async () => shot);
    const api = mountCapture({ capture3D });
    let result: string | null = null;
    await act(async () => { result = await api().captureRenderImage({ view: 'current', scale: 1 }); });
    expect(capture3D).toHaveBeenCalledOnce();
    expect(capture3D).toHaveBeenCalledWith(expect.objectContaining({ view: 'current', scale: 1 }));
    expect(result).toBe(shot);
  });

  it('可见画布拿不到时返回 null，而不是让旧渲染器偷偷出图', async () => {
    const capture3D = vi.fn(async () => null);
    const api = mountCapture({ capture3D });
    let result: string | null = 'x';
    await act(async () => { result = await api().captureRenderImage({ view: 'current', scale: 1 }); });
    // 没有 renderer/scene/camera（室内管线已退役），回退路径也只能是 null。
    expect(result).toBeNull();
  });

  it('2D 平铺图仍走 2D 画布，不惊动 3D 抓帧', async () => {
    const flat = 'data:image/png;base64,FLAT';
    const capture3D = vi.fn(async () => 'data:image/png;base64,OUTDOOR');
    const api = mountCapture({ view2D: true, flat, capture3D });
    let result: string | null = null;
    await act(async () => { result = await api().captureRenderImage({ view: 'current', scale: 1 }); });
    expect(capture3D).not.toHaveBeenCalled();
    expect(result).toBe(flat);
  });
});
