import { z } from 'zod';

export const ISO_MANIFEST_URL = process.env.NEXT_PUBLIC_ISO_MANIFEST_URL || 'https://scendance-xihu-iso.pages.dev/latest.json';

const manifest = z.object({
  schemaVersion: z.literal(1),
  version: z.string().min(1),
  overview: z.string().min(1),
  viewer: z.string().min(1),
  editor: z.object({
    assets: z.array(z.string().min(1)).min(1).max(32),
    origin: z.object({ lng: z.number().min(-180).max(180), lat: z.number().min(-90).max(90) }),
    waterY: z.number(),
  }).optional(),
});

export type MapRelease = z.infer<typeof manifest>;

export async function loadMapRelease(source: string, signal: AbortSignal): Promise<MapRelease> {
  const url = new URL(source, window.location.href);
  const response = await fetch(url, { cache: 'no-cache', credentials: 'omit', signal });
  if (!response.ok) throw new Error('地图版本暂不可用');
  const release = manifest.parse(await response.json());
  const base = new URL(response.url);
  function asset(path: string): string {
    const assetUrl = new URL(path, base);
    if (!/^https?:$/.test(assetUrl.protocol) || assetUrl.origin !== url.origin) {
      throw new Error('地图资源须与版本清单同源');
    }
    return assetUrl.href;
  }
  return {
    ...release, overview: asset(release.overview), viewer: asset(release.viewer),
    editor: release.editor && { ...release.editor, assets: release.editor.assets.map(asset) },
  };
}
