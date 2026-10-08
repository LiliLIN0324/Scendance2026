import { useEffect, useMemo, useState } from 'react';
import { resolveReferenceImage, type ReferenceImageLayer } from '@/lib/reference-image';
import { listStoredSources, readSourceForm, subscribeSourceChanges, type StoredSource } from '@/lib/source-storage';
import type { RoomLayout } from '../lib/types';

export function useReferenceImage(layout: RoomLayout): { layer: ReferenceImageLayer | undefined; notice: string; ready: boolean; reload(): void } {
  const scope = layout.id ?? 'local';
  const [attempt, setAttempt] = useState(0);
  const [stored, setStored] = useState<{ scope: string; sources: StoredSource[]; form: unknown; error?: string }>();
  const [decoded, setDecoded] = useState<{ scope: string; blob: Blob; url?: string; error?: string }>();
  useEffect(() => subscribeSourceChanges(scope, () => setAttempt(value => value + 1)), [scope]);
  useEffect(() => {
    let active = true;
    setStored(undefined);
    if (!layout.backendSceneV2) return;
    void Promise.all([listStoredSources(scope), readSourceForm(scope)]).then(([sources, form]) => {
      if (active) setStored({ scope, sources, form });
    }).catch(() => { if (active) setStored({ scope, sources: [], form: undefined, error: '本机图纸资料读取失败，请重试读取。' }); });
    return () => { active = false; };
  }, [scope, attempt, !!layout.backendSceneV2]);
  const result = useMemo(() => stored?.scope === scope && !stored.error ? resolveReferenceImage(layout, stored.sources, stored.form) : undefined, [layout, scope, stored]);
  const source = result?.status === 'ready' ? result.source : undefined;
  useEffect(() => {
    setDecoded(undefined);
    if (!source?.blob) return;
    const blob = source.blob, url = URL.createObjectURL(blob), image = new Image();
    let active = true;
    image.onload = () => {
      if (!active) return;
      if (image.naturalWidth !== source.width || image.naturalHeight !== source.height || !image.naturalWidth || !image.naturalHeight) {
        setDecoded({ scope, blob, error: '图片实际尺寸与对应依据不一致，请重新选择并核对图纸。' });
      } else setDecoded({ scope, blob, url });
    };
    image.onerror = () => { if (active) setDecoded({ scope, blob, error: '图纸图片无法读取，请重新选择有效图片。' }); };
    image.src = url;
    return () => { active = false; image.onload = null; image.onerror = null; URL.revokeObjectURL(url); };
  }, [scope, source?.id, source?.blob, source?.width, source?.height]);
  const matching = decoded?.scope === scope && decoded.blob === source?.blob;
  const layer = result?.status === 'ready' && source && result.imageToWorld && matching && decoded.url
    ? { url: decoded.url, pixelWidth: source.width, pixelHeight: source.height, imageToWorld: result.imageToWorld } : undefined;
  return {
    layer,
    ready: !!layer,
    notice: !layout.backendSceneV2 ? '旧底图按场地范围示意显示，尺寸与位置仍需核对。'
      : !stored || stored.scope !== scope ? '正在读取当前项目的参考图纸…'
      : stored.error ?? (matching && decoded.error ? decoded.error : result?.status === 'ready' && !layer ? '正在读取图纸图片…' : result?.notice ?? '尚未核对图纸与当前场地的对应。'),
    reload: () => setAttempt(value => value + 1),
  };
}
