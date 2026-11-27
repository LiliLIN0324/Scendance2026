import { localWriteCapabilityGuard, type LocalWriteCapability } from '@/lib/local-write-lease';
import { useCallback, useRef } from 'react';
import { notify } from '../lib/editor-notices';
import { downloadDataUrlAsPng, readLayoutFromFile } from '../lib/file-io';
import { downloadTextFile } from '../lib/plan-export/download';
import { ALBUM_SHOTS, albumBaseName, renderAlbumHtml } from '../lib/shot-list';
import { confirmReplace, snapshotBeforeReplace } from '../lib/restore-point';
import { encodeShareSnapshot, ShareSnapshotError } from '../../../lib/share-snapshot';
import type { LayoutActions } from './use-layout-state';
import type { CameraPreset, RoomLayout } from '../lib/types';

export interface UseImportExportParams {
  layout: RoomLayout;
  actions: LayoutActions;
  /** Optional isolated ordinary-write authority; once supplied removal or replacement fails closed. */
  localWriteCapability?: LocalWriteCapability | undefined;
  view2D: boolean;
  /**
   * 2026-11-19 用户：「把 captureRenderImage / exportRenderImage 换成 OutdoorPlan3D 的 captureImage」。
   * 可见画面已经是 OutdoorPlan3D（室内 Viewport 退役），取图必须问它要。
   * 2026-11-25 S1 收口：旧的「renderer/scene/camera/paintFrame 兜底」通路整段删除。
   */
  capture3D?: (options: RenderExportOptions) => Promise<string | null>;
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
  localWriteCapability,
  view2D,
  capture3D,
  onImported,
}: UseImportExportParams): UseImportExportResult {
  const latestLayout = useRef(layout);
  latestLayout.current = layout;
  const lease = useRef<{capability:LocalWriteCapability; revoked:boolean}|null>(null);
  if (!lease.current && localWriteCapability) lease.current = {capability:localWriteCapability,revoked:false};
  else if (lease.current && localWriteCapability !== lease.current.capability) lease.current.revoked = true;
  const assertImportWrite = () => {
    if (!lease.current) return;
    if (lease.current.revoked) throw new Error('本机编辑权已变化，导入暂未应用。');
    try { localWriteCapabilityGuard(lease.current.capability).assertStillHeld(); }
    catch { lease.current.revoked=true; throw new Error('本机编辑权已失效，导入暂未应用。'); }
  };
  const captureRenderImage = useCallback(
    async ({ view, scale, resolution }: RenderExportOptions) => {
      // 2026-11-25 S1 收口：室内渲染器通路（renderer/scene/camera/paintFrame/applyPreset）
      // 已随壳体退役，取图只剩可见画布 OutdoorPlan3D 一条；2D 平铺画布同样已无绑定。
      if (view2D || !capture3D) return null;
      return await capture3D({ view, scale, ...(resolution ? { resolution } : {}) });
    },
    [view2D, capture3D]
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
        if (lease.current && latestLayout.current !== layout) throw new Error('读取期间场地已变化，请重新核对后导入。');
        if (!confirmReplace(layout, `the imported “${next.name}”`)) return false;
        assertImportWrite();
        const capability = lease.current?.capability;
        if (!snapshotBeforeReplace(layout, lease.current ? assertImportWrite : undefined, capability)) throw new Error('当前方案的恢复点未能确认保存，导入暂未应用。');
        assertImportWrite();
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
