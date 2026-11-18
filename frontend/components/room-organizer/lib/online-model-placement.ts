import { createGlbCatalogItem, ensureGlbAsset } from '../three/glb-assets';
import { catalogGroupKey } from './catalog-taxonomy';
import type { OnlineModel } from './online-models';
import type { CatalogItem, FurnitureCategory } from './types';
import type { BackendSession } from '@/lib/backend-session';
import { publicAssetLocalUrl } from '@/lib/public-asset-recovery';

/** Click and drop load shipped public files directly; cloud-only assets still require authorization. */
export async function loadOnlineCatalogItem(model: OnlineModel, controller?: BackendSession): Promise<CatalogItem> {
  const scope = controller?.getSnapshot();
  // The shipped registry proves public identity. Its UUID is provenance, not a
  // requirement that this deployment's cloud database also contains the asset.
  const localUrl = publicAssetLocalUrl(model.assetId);
  const url = localUrl ?? (scope?.user && model.assetId && controller
    ? (await controller.authorizeAsset(model.assetId)).url : model.glb);
  await ensureGlbAsset(model.assetId ?? model.glb, url);
  const current = controller?.getSnapshot();
  if (current?.user?.id !== scope?.user?.id || current?.project?.id !== scope?.project?.id) {
    throw new Error('项目或登录状态已变化，请重新添加模型。');
  }
  return createGlbCatalogItem({ name: model.name, url,
    ...(model.assetId ? { assetId: model.assetId } : {}),
    width: model.width, depth: model.depth, height: model.height, source: 'public_library',
    category: catalogGroupKey(model.bucket) as FurnitureCategory,
  });
}
