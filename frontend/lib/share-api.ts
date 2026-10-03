import { z } from 'zod';
import { createSceneClient, SceneApiError } from '../../client/scene-client';
import { colorSchema, sceneSchema, sizeSchema, uuid } from '../../supabase/functions/_shared/domain';
import { getBackendConfig, type BackendConfig } from './backend-session';

const timestamp = z.string().refine(value => Number.isFinite(Date.parse(value)));
const resourceUrl = z.string().refine(value => {
  try {
    const url = new URL(value);
    return !url.username && !url.password && !url.hash &&
      (url.protocol === 'https:' || url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname));
  } catch { return false; }
});
export const shareSummarySchema = z.object({
  shareId: uuid, publicationId: uuid, revision: z.number().int().nonnegative(),
  createdAt: timestamp, revokedAt: timestamp.nullable(),
});
export type ShareSummary = z.infer<typeof shareSummarySchema>;
export const publicationSchema = shareSummarySchema.omit({ revokedAt: true }).extend({
  url: z.string(), token: z.string().regex(/^[a-f0-9]{64}$/),
}).refine(value => {
  try {
    const url = new URL(value.url);
    return resourceUrl.safeParse(`${url.origin}${url.pathname}`).success && !url.username && !url.password &&
      !url.search && url.pathname.endsWith('/view/') && url.hash === `#${value.token}`;
  } catch { return false; }
});
export type Publication = z.infer<typeof publicationSchema>;

const snapshotSchema = z.object({
  publicationId: uuid, name: z.string().min(1).max(120), revision: z.number().int().nonnegative(), createdAt: timestamp,
  scene: sceneSchema.transform(scene => {
    const { floorplanAssetId: _privateFloorplan, ...venue } = scene.venue;
    return { ...scene, venue, objects: scene.objects.map(object => ({ ...object, notes: '' })) };
  }),
  materials: z.array(z.object({
    materialId: z.string(), assetId: uuid.nullable(), name: z.string(), size: sizeSchema,
    color: colorSchema, notice: z.string(), quantity: z.number().int().positive(),
  })).max(50),
  assets: z.array(z.object({
    id: uuid, name: z.string(), url: resourceUrl, expiresIn: z.number().positive().max(300),
    source: z.string(), sourceUrl: resourceUrl.nullable(),
    license: z.object({ id: z.string().optional(), type: z.string().optional(), url: resourceUrl.optional(), attribution: z.string().optional() }).nullable(),
  })).max(50),
});
export type SharedSnapshot = z.infer<typeof snapshotSchema>;

export function shareTokenFromHash(hash: string): string | null {
  const token = hash.startsWith('#') ? hash.slice(1) : hash;
  return /^[a-f0-9]{64}$/.test(token) ? token : null;
}

export async function readShare(token: string, config: BackendConfig = getBackendConfig()): Promise<SharedSnapshot> {
  if (shareTokenFromHash(token) !== token) throw new SceneApiError('SHARE_NOT_FOUND', 404, null);
  if (!config.configured) throw new SceneApiError('CONFIGURATION_MISSING', 0, null);
  const response = await createSceneClient(config.apiUrl, async () => null).readShare(token);
  const result = snapshotSchema.safeParse(response);
  if (!result.success) throw new SceneApiError('INVALID_RESPONSE', 502, null);
  return result.data;
}

export function shareErrorMessage(error: unknown): string {
  const code = error instanceof SceneApiError ? error.code : '';
  const messages: Record<string, string> = {
    SHARE_NOT_FOUND: '分享链接不存在或已撤销，请联系方案发布者。',
    UNAUTHENTICATED: '登录已失效，请重新登录后管理分享。',
    FORBIDDEN: '只有项目创建者或工作室所有者可以管理分享。',
    REVISION_CONFLICT: '云端版本已变化，请重新打开项目并核对后发布。',
    CONFIGURATION_MISSING: '分享服务尚未配置，请联系方案发布者。',
    SERVICE_NOT_CONFIGURED: '分享服务尚未配置，请联系管理员。',
    INVALID_RESPONSE: '分享数据格式无效，请稍后重试或联系方案发布者。',
    ORIGIN_FORBIDDEN: '此网页地址尚未获准访问分享服务，请联系管理员。',
  };
  return messages[code] ?? '暂时无法连接分享服务，请重试。';
}
