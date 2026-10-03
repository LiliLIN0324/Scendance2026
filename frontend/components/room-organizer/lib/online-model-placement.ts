import { createGlbCatalogItem, ensureGlbAsset } from '../three/glb-assets';
import type { OnlineModel } from './online-models';
import type { CatalogItem } from './types';
import type { BackendSession } from '@/lib/backend-session';

/** Click and drop both authorize and load the same catalogue asset before placement. */
export async function loadOnlineCatalogItem(model: OnlineModel, controller?: BackendSession): Promise<CatalogItem> {
  const scope = controller?.getSnapshot();
  const url = scope?.user && model.assetId && controller
    ? (await controller.authorizeAsset(model.assetId)).url : model.glb;
  await ensureGlbAsset(model.assetId ?? model.glb, url);
  const current = controller?.getSnapshot();
  if (current?.user?.id !== scope?.user?.id || current?.project?.id !== scope?.project?.id) {
    throw new Error('项目或登录状态已变化，请重新添加模型。');
  }
  return createGlbCatalogItem({ name: model.name, url,
    ...(model.assetId ? { assetId: model.assetId } : {}),
    width: model.width, depth: model.depth, height: model.height, source: 'public_library' });
}
