import assetIds from '../../assets/library/asset-ids.json';
import { isGlbUrl } from '../components/room-organizer/lib/glb-url';
import { ensureGlbAsset, getGlbAssetState } from '../components/room-organizer/three/glb-assets';

const localModels = new Map(Object.entries(assetIds)
  .filter(([url]) => url.startsWith('/showcase/assets/library/model/') && url.endsWith('.glb'))
  .map(([url, id]) => [id, url]));
const uuidPath = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
const recovering = new Map<string, { promise: Promise<void>; state: ReturnType<typeof getGlbAssetState> }>();

function canonicalPublicId(assetId?: string): string | undefined {
  const id = assetId && uuidPath.test(assetId) ? assetId.toLowerCase() : undefined;
  return id && localModels.has(id) ? id : undefined;
}

/** Public identity comes from the shipped registry, never a source label or URL resemblance. */
export function publicAssetLocalUrl(assetId?: string): string | undefined {
  const id = canonicalPublicId(assetId);
  return id ? localModels.get(id) : undefined;
}

async function isSamePublicFile(assetId: string, url: string, localUrl: string, storageOrigin: string | undefined): Promise<boolean> {
  if ((assetIds as Record<string, string>)[url] === assetId) return true;
  if (!storageOrigin) return false;
  try {
    const original = new URL(url), trusted = new URL(storageOrigin);
    if (!isGlbUrl(`${trusted.origin}/model.glb`) || trusted.username || trusted.password ||
        original.origin !== trusted.origin || !original.searchParams.get('token')) return false;
    const prefix = '/storage/v1/object/sign/scene-assets/';
    if (!original.pathname.startsWith(prefix)) return false;
    const path = original.pathname.slice(prefix.length).split('/');
    if (path.length !== 3 || !uuidPath.test(path[0]) || path[1] !== assetId) return false;
    // Read the byte identity only for a signed-path proof; normal successful loads stay lazy.
    const manifest = await import('../../assets/library/merged.json');
    const model = manifest.default.models.find(row => 'assetId' in row && row.assetId === assetId && row.glb === localUrl);
    return !!model && /^[a-f0-9]{64}$/.test(model.sha256) && path[2] === `${model.sha256}.glb`;
  } catch {
    return false;
  }
}

/** Keep successful custom loads; recover only a proven public file after an explicit download refusal. */
export async function ensureRecoverableGlbAsset(
  key: string, assetId: string | undefined, url: string | undefined,
  storageOrigin = process.env.NEXT_PUBLIC_SUPABASE_URL,
): Promise<void> {
  if (getGlbAssetState(key).status === 'ready') return;
  const publicId = canonicalPublicId(assetId);
  const localUrl = publicId ? localModels.get(publicId) : undefined;
  const preferred = url ?? localUrl;
  if (!preferred) throw new Error('模型尚未加载，请连接项目后重试。');
  try {
    await ensureGlbAsset(key, preferred);
  } catch (error) {
    if (!publicId || !localUrl || preferred === localUrl || !(error instanceof Error) ||
        !/^模型下载失败（HTTP (401|403)）。$/.test(error.message)) throw error;
    const failedState = getGlbAssetState(key);
    if (!await isSamePublicFile(publicId, preferred, localUrl, storageOrigin)) throw error;
    const shared = recovering.get(key);
    if (shared && getGlbAssetState(key) === shared.state) return shared.promise;
    // A newer request or cache clear during the lazy proof must not restart this old request.
    if (failedState.status !== 'error' || getGlbAssetState(key) !== failedState) throw error;
    const promise = ensureGlbAsset(key, localUrl);
    const recovery = { promise, state: getGlbAssetState(key) };
    recovering.set(key, recovery);
    try { await promise; }
    finally { if (recovering.get(key) === recovery) recovering.delete(key); }
  }
}
