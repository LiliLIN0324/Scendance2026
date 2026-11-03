import { useCallback, type MutableRefObject, type RefObject } from 'react';
import { notify } from '../lib/editor-notices';
import {
  downloadCanvasAsPng,
  downloadDataUrlAsPng,
  downloadSceneAsGlb,
  readLayoutFromFile,
} from '../lib/file-io';
import { confirmReplace, snapshotBeforeReplace } from '../lib/restore-point';
import { encodeShareUrl, isShareUrlReasonablySized } from '../lib/share';
import type { LayoutActions } from './use-layout-state';
import type { CameraPreset, RoomLayout } from '../lib/types';
import type * as ThreeNS from 'three';
import type { OrbitControls as OrbitControlsType } from 'three/examples/jsm/controls/OrbitControls.js';

export interface UseImportExportParams {
  layout: RoomLayout;
  actions: LayoutActions;
  view2D: boolean;
  canvasRef: RefObject<HTMLCanvasElement>;
  canvas2DRef: RefObject<HTMLCanvasElement | null>;
  rendererRef: MutableRefObject<ThreeNS.WebGLRenderer | null>;
  sceneRef: MutableRefObject<ThreeNS.Scene | null>;
  cameraRef: MutableRefObject<ThreeNS.PerspectiveCamera | null>;
  /** Restores the live camera framing after a preset capture. */
  controlsRef?: MutableRefObject<OrbitControlsType | null>;
  /** Frames the given preset before capture; the live camera is restored after. */
  applyPreset?: (preset: CameraPreset) => void;
  /** Runs after a successful JSON import (e.g. clear the selection). */
  onImported(): void;
}

export interface RenderExportOptions {
  /** 'current' keeps the live camera; a preset frame is applied only for the capture. */
  view: 'current' | CameraPreset;
  /** Resolution multiplier (1–3) over the canvas CSS size and device pixel ratio. */
  scale: number;
}

export interface UseImportExportResult {
  handleScreenshot(): void;
  /**
   * Renders a fresh frame at a higher pixel ratio (the WebGL buffer is read in
   * the same task, so no preserveDrawingBuffer is needed) and downloads it as a
   * PNG. Resolves to whether the download was dispatched.
   */
  exportRenderImage(options: RenderExportOptions): Promise<boolean>;
  /** 同一帧只编码一次：先给导出卡做预览，点确认后再下载这张，不重渲染。 */
  captureRenderImage(options: RenderExportOptions): Promise<string | null>;
  handleExportGlb(): Promise<void>;
  handleShareLink(): Promise<void>;
  /** Resolves true when the file replaced the current house. */
  handleImport(file: File): Promise<boolean>;
}

export function useImportExport({
  layout,
  actions,
  view2D,
  canvasRef,
  canvas2DRef,
  rendererRef,
  sceneRef,
  cameraRef,
  controlsRef,
  applyPreset,
  onImported,
}: UseImportExportParams): UseImportExportResult {
  const handleScreenshot = useCallback(() => {
    const canvas = view2D ? canvas2DRef.current : canvasRef.current;
    if (!canvas) return;
    const failed = () => { notify('画面导出失败，请稍后重试。', 'error'); };
    try {
      // The renderer runs without preserveDrawingBuffer, so render a fresh
      // frame synchronously — the buffer is valid within the same task.
      if (!view2D && rendererRef.current && sceneRef.current && cameraRef.current) {
        rendererRef.current.render(sceneRef.current, cameraRef.current);
      }
      void downloadCanvasAsPng(canvas, layout.name || 'room-layout').then((ok) => {
        if (!ok) failed();
      }, failed);
    } catch {
      failed();
    }
  }, [view2D, layout.name, canvasRef, canvas2DRef, rendererRef, sceneRef, cameraRef]);

  const captureRenderImage = useCallback(
    async ({ view, scale }: RenderExportOptions) => {
      if (view2D) {
        const flat = canvas2DRef.current;
        if (!flat) return null;
        try { return flat.toDataURL('image/png'); } catch { return null; }
      }
      const canvas = canvasRef.current;
      const renderer = rendererRef.current;
      const scene = sceneRef.current;
      const camera = cameraRef.current;
      if (!canvas || !renderer || !scene || !camera) return null;
      const factor = Math.min(3, Math.max(1, Math.round(scale)));
      const baseRatio = Math.min(window.devicePixelRatio || 1, 2);
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      if (width < 2 || height < 2) return null;
      const controls = controlsRef?.current ?? null;
      const savedPosition = camera.position.clone();
      const savedQuaternion = camera.quaternion.clone();
      const savedTarget = controls ? controls.target.clone() : null;
      try {
        if (view !== 'current') applyPreset?.(view);
        renderer.setPixelRatio(baseRatio * factor);
        renderer.setSize(width, height, false);
        renderer.render(scene, camera);
        return canvas.toDataURL('image/png');
      } catch {
        return null;
      } finally {
        camera.position.copy(savedPosition);
        camera.quaternion.copy(savedQuaternion);
        if (controls && savedTarget) {
          controls.target.copy(savedTarget);
          controls.update();
        }
        renderer.setPixelRatio(baseRatio);
        renderer.setSize(width, height, false);
        renderer.render(scene, camera);
      }
    },
    [view2D, canvasRef, canvas2DRef, rendererRef, sceneRef, cameraRef, controlsRef, applyPreset]
  );

  const exportRenderImage = useCallback(
    async (options: RenderExportOptions) => {
      const dataUrl = await captureRenderImage(options);
      if (!dataUrl) return false;
      const baseName = `${(layout.name || 'room-layout').replace(/\s+/g, '_')}-效果图`;
      return downloadDataUrlAsPng(dataUrl, baseName);
    },
    [captureRenderImage, layout.name]
  );

  const handleExportGlb = useCallback(async () => {
    const scene = sceneRef.current;
    if (!scene) return;
    try {
      await downloadSceneAsGlb(scene, layout.name || 'room-layout');
    } catch (exportError) {
      notify(exportError instanceof Error ? exportError.message : 'GLB 导出失败，请稍后重试。', 'error');
    }
  }, [sceneRef, layout.name]);

  const handleShareLink = useCallback(async () => {
    const origin = window.location.origin + window.location.pathname;
    const { url, strippedFloorPlan } = await encodeShareUrl(layout, origin);

    if (!isShareUrlReasonablySized(url)) {
      notify('这份布置太大，装不进分享链接。请改用导出 JSON 后发送文件。', 'error');
      return;
    }

    try {
      await navigator.clipboard.writeText(url);
      notify(strippedFloorPlan ? '分享链接已复制，为控制长度未包含平面图。' : '分享链接已复制。', 'success');
    } catch {
      // Clipboard refused (permissions, insecure context): hand the link over to copy by hand.
      notify('浏览器不允许写入剪贴板，请手动复制分享链接。', 'info', { copyText: url });
    }
  }, [layout]);

  const handleImport = useCallback(
    async (file: File) => {
      try {
        const next = await readLayoutFromFile(file);
        if (!confirmReplace(layout, `the imported “${next.name}”`)) return false;
        snapshotBeforeReplace(layout);
        actions.applyLayout(next);
        onImported();
        return true;
      } catch (importError) {
        const message =
          importError instanceof Error
            ? `Import failed: ${importError.message}`
            : 'Failed to import layout. Please check the file format.';
        notify(message, 'error');
        return false;
      }
    },
    [layout, actions, onImported]
  );

  return { handleScreenshot, exportRenderImage, captureRenderImage, handleExportGlb, handleShareLink, handleImport };
}
