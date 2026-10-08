import libraryAssetIds from '../../assets/library/asset-ids.json';
import type { RoomLayout } from '../components/room-organizer/lib/types';

const publicAssetUrls = new Map(Object.entries(libraryAssetIds)
  .filter(([url]) => url.startsWith('https://'))
  .map(([url, assetId]) => [assetId, url]));

/** Export copies retain stable asset references, never archived loading authorisations. */
export function layoutForExport(layout: RoomLayout, stripHandoffs = false): RoomLayout {
  const exported = {
    ...layout,
    floors: layout.floors.map((floor) => ({
      ...floor,
      items: floor.items.map((item) => {
        const copy = { ...item };
        if (stripHandoffs) delete copy.handoff;
        if (item.assetId) {
          // A public source label alone does not make the current loading URL public.
          const url = (libraryAssetIds as Record<string, string>)[item.glbUrl ?? ''] === item.assetId
            ? item.glbUrl : publicAssetUrls.get(item.assetId);
          delete copy.glbUrl;
          if (url) copy.glbUrl = url;
        }
        return copy;
      }),
    })),
    ...(layout.designBook ? {
      designBook: {
        ...layout.designBook,
        variants: layout.designBook.variants.map((variant) => ({
          ...variant, layout: layoutForExport(variant.layout, stripHandoffs),
        })),
      },
    } : {}),
  };
  if (stripHandoffs) delete exported.eventOperations;
  if (stripHandoffs) delete exported.productionPlan;
  return exported;
}
