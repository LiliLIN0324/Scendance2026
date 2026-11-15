import { describe, expect, it } from 'vitest';
import {
  CLOUD_ASSETS_BASE,
  cloudAssetUrl,
  cloudPeopleUrl,
  cloudScanUrl,
  cloudScanLodUrl,
} from './cloud-assets';

describe('cloud-assets URL 分流', () => {
  it('人物模型落在 people/<assetId>.glb', () => {
    expect(cloudPeopleUrl('7a9f1e21-8c34-4d52-a109-b00000000009')).toBe(
      `${CLOUD_ASSETS_BASE}/people/7a9f1e21-8c34-4d52-a109-b00000000009.glb`,
    );
  });

  it('扫描件按后缀落 scans/<assetId>.<kind>', () => {
    expect(cloudScanUrl('abc-123', 'spz')).toBe(`${CLOUD_ASSETS_BASE}/scans/abc-123.spz`);
    expect(cloudScanUrl('abc-123', 'ply')).toBe(`${CLOUD_ASSETS_BASE}/scans/abc-123.ply`);
  });

  it('cloudAssetUrl 把 glb 分流到 people，其余到 scans', () => {
    expect(cloudAssetUrl('abc-123', 'glb')).toBe(cloudPeopleUrl('abc-123'));
    expect(cloudAssetUrl('abc-123', 'spz')).toBe(cloudScanUrl('abc-123', 'spz'));
  });

  it('扫描 LOD 元数据落 scans/<id>/lod-meta.json', () => {
    expect(cloudScanLodUrl('abc-123')).toBe(`${CLOUD_ASSETS_BASE}/scans/abc-123/lod-meta.json`);
  });

  it('基址不带尾斜杠', () => {
    expect(CLOUD_ASSETS_BASE.endsWith('/')).toBe(false);
  });
});
