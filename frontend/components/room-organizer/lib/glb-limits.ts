/** One GLB ceiling shared by the downloader and the local importer, so the two paths cannot drift. */
export const GLB_MAX_FILE_BYTES = 10 * 1024 * 1024;
export const LOCAL_HANFU_WALK_ID = '9b9bb4da-3f30-4cfa-8e15-483038000001';
/**
 * 试走角色：绑骨 + Idle/Walk 的模型本身就比 10 MB 上限大得多。
 * 放宽到 48 MB 的两条路：本机资产代理（开发机）与云端资产库（lib/cloud-assets.ts）。
 * 新增角色时把资产号加到这里，并把 GLB 传到 R2 的 people/ 下。
 */
export const LOCAL_WALK_ASSET_IDS: readonly string[] = [
  LOCAL_HANFU_WALK_ID,
  '7a9f1e21-8c34-4d51-a001-b00000000001',
  '7a9f1e21-8c34-4d51-a002-b00000000002',
  '7a9f1e21-8c34-4d51-a003-b00000000003',
  '7a9f1e21-8c34-4d51-a004-b00000000004',
  '7a9f1e21-8c34-4d51-a005-b00000000005',
  '7a9f1e21-8c34-4d51-a006-b00000000006',
];
export const LOCAL_WALK_MAX_FILE_BYTES = 48 * 1024 * 1024;
