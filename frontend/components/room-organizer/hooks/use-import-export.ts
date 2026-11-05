import { useCallback, type MutableRefObject, type RefObject } from 'react';
import { notify } from '../lib/editor-notices';
import { downloadDataUrlAsPng, readLayoutFromFile } from '../lib/file-io';
import { downloadTextFile } from '../lib/plan-export/download';
import { ALBUM_SHOTS, albumBaseName, renderAlbumHtml } from '../lib/shot-list';
import { confirmReplace, snapshotBeforeReplace } from '../lib/restore-point';
import { encodeShareSnapshot, ShareSnapshotError } from '../../../lib/share-snapshot';
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
  /**
   * 与实时画面同一条渲染路径：开着 3DGS 环境预览时先铺点云再叠布置，
   * 关掉时退回普通渲染。导出必须走它，否则成图里没有真实场地。
   */
  paintFrame?: (renderer: ThreeNS.WebGLRenderer, scene: ThreeNS.Scene, camera: ThreeNS.Camera) => void;
  /** Runs after a successful JSON import (e.g. clear the selection). */
  onImported(): void;
}

export interface RenderExportOptions {
  /** 'current' keeps the live camera; a preset frame is applied only for the capture. */
  view: 'current' | CameraPreset;
  /** Resolution multiplier (1–3) over the 1920×1080 delivery frame. */
  scale: number;
  /** 成图尺寸；缺省 1920×1080 × scale（交付尺寸，不再跟着画布大小走）。 */
  resolution?: { width: number; height: number };
}

export interface ShareViewerLink {
  url: string;
  name: string;
  objects: number;
  /** Objects whose signed model URL could not travel in the link. */
  droppedAssets: number;
}

export interface RenderAlbumResult {
  ok: boolean;
  count: number;
}

export interface UseImportExportResult {
  /**
   * Renders a fresh frame at a higher pixel ratio (the WebGL buffer is read in
   * the same task, so no preserveDrawingBuffer is needed) and downloads it as a
   * PNG. Resolves to whether the download was dispatched.
   */
  exportRenderImage(options: RenderExportOptions): Promise<boolean>;
  /** 同一帧只编码一次：先给导出卡做预览，点确认后再下载这张，不重渲染。 */
  captureRenderImage(options: RenderExportOptions): Promise<string | null>;
  /**
   * 顺序抓取机位册的全部机位：每张单独命名下载，再出一份内联图册 HTML。
   * 顺序执行，避免同时抬高 pixelRatio 把显存打满。
   */
  exportRenderAlbum(options: { scale: number }): Promise<RenderAlbumResult>;
  /**
   * Encodes the live layout into a self-contained read-only viewer link and
   * copies it. The payload lives in the URL hash, so the link works offline
   * and needs no backend. Returns null when the link could not be produced.
   */
  handleShareLink(): Promise<ShareViewerLink | null>;
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
  paintFrame,
  onImported,
}: UseImportExportParams): UseImportExportResult {
  const captureRenderImage = useCallback(
    async ({ view, scale, resolution }: RenderExportOptions) => {
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
      // 交付尺寸固定从 1920×1080 起算，不再跟着画布 CSS 大小走：
      // 同一个方案不管谁的窗口多大，导出都是同一张构图。
      const targetWidth = resolution?.width ?? 1920 * factor;
      const targetHeight = resolution?.height ?? 1080 * factor;
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      if (width < 2 || height < 2) return null;
      const paint = paintFrame ?? ((target: ThreeNS.WebGLRenderer, paintScene: ThreeNS.Scene, paintCamera: ThreeNS.Camera) => target.render(paintScene, paintCamera));
      const controls = controlsRef?.current ?? null;
      const savedPosition = camera.position.clone();
      const savedQuaternion = camera.quaternion.clone();
      const savedAspect = camera.aspect;
      const savedPixelRatio = renderer.getPixelRatio();
      const savedTarget = controls ? controls.target.clone() : null;
      try {
        if (view !== 'current') applyPreset?.(view);
        // 16:9 的竖向 FOV 保持不动，只放宽横向，画面不拉伸。
        camera.aspect = targetWidth / targetHeight;
        camera.updateProjectionMatrix();
        // 1:1 像素比 + 目标尺寸，toDataURL 出来的就是这一张的原始像素。
        renderer.setPixelRatio(1);
        renderer.setSize(targetWidth, targetHeight, false);
        paint(renderer, scene, camera);
        return canvas.toDataURL('image/png');
      } catch {
        return null;
      } finally {
        camera.position.copy(savedPosition);
        camera.quaternion.copy(savedQuaternion);
        camera.aspect = savedAspect;
        camera.updateProjectionMatrix();
        if (controls && savedTarget) {
          controls.target.copy(savedTarget);
          controls.update();
        }
        renderer.setPixelRatio(savedPixelRatio);
        renderer.setSize(width, height, false);
        paint(renderer, scene, camera);
      }
    },
    [view2D, canvasRef, canvas2DRef, rendererRef, sceneRef, cameraRef, controlsRef, applyPreset, paintFrame]
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

  const exportRenderAlbum = useCallback(async ({ scale }: { scale: number }): Promise<RenderAlbumResult> => {
    const base = albumBaseName(layout.name);
    const shots: { label: string; dataUrl: string }[] = [];
    for (const shot of ALBUM_SHOTS) {
      const dataUrl = await captureRenderImage({ view: shot.id, scale });
      if (!dataUrl) return { ok: false, count: shots.length };
      shots.push({ label: shot.label, dataUrl });
      downloadDataUrlAsPng(dataUrl, `${base}_${shot.filePart}`);
      // 连续下载之间留一拍，让浏览器把上一张真正落下。
      await new Promise(resolve => setTimeout(resolve, 60));
    }
    downloadTextFile(`${base}册.html`, 'text/html;charset=utf-8', renderAlbumHtml({
      projectName: layout.name,
      generatedAt: new Date().toISOString(),
      shots,
    }));
    return { ok: true, count: shots.length };
  }, [captureRenderImage, layout.name]);

  const handleShareLink = useCallback(async (): Promise<ShareViewerLink | null> => {
    try {
      const { url, snapshot, droppedAssets } = await encodeShareSnapshot(layout, `${window.location.origin}/view`);
      const link = { url, name: snapshot.name, objects: snapshot.scene.objects, droppedAssets };
      try {
        await navigator.clipboard.writeText(url);
        notify(droppedAssets > 0
          ? `只读 3D 链接已复制；${droppedAssets} 个外部模型未能带走，查看器会显示占位。`
          : '只读 3D 链接已复制，打开即可在浏览器里查看方案。', 'success');
      } catch {
        // Clipboard refused (permissions, insecure context): hand the link over to copy by hand.
        notify('浏览器不允许写入剪贴板，请手动复制只读 3D 链接。', 'info', { copyText: url });
      }
      return link;
    } catch (shareError) {
      if (shareError instanceof ShareSnapshotError) {
        notify(shareError.message, 'error');
      } else {
        notify('生成只读 3D 链接失败，请稍后重试。', 'error');
      }
      return null;
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

  return { exportRenderImage, captureRenderImage, exportRenderAlbum, handleShareLink, handleImport };
}
