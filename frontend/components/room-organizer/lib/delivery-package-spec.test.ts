import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  DELIVERY_ARTIFACTS,
  DELIVERY_MANIFEST_REQUIRED_FIELDS,
  DELIVERY_PACKAGE_FORMAT,
  DELIVERY_RETRY,
  DELIVERY_SCENE_FORMAT,
  DELIVERY_SCENE_FORMAT_VERSION,
  DELIVERY_VERSION_PATTERN,
  deliveryArtifactPath,
  deliveryPackageRoot,
  isDeliveryVersion,
  isRetryableDeliveryCode,
  safeFilePart,
} from './delivery-package-spec';

const here = dirname(fileURLToPath(import.meta.url));

describe('delivery package layout (v1)', () => {
  it('carries the four deliverables plus manifest and readme', () => {
    expect(DELIVERY_ARTIFACTS.map(spec => spec.kind)).toEqual(['hero', 'floor', 'materials', 'share', 'manifest', 'readme']);
    expect(DELIVERY_ARTIFACTS.find(spec => spec.kind === 'hero')?.count).toBe(3);
  });

  it('produces unique, deterministic entry paths for every artifact', () => {
    const paths = DELIVERY_ARTIFACTS.flatMap(spec =>
      Array.from({ length: spec.count }, (_, index) => deliveryArtifactPath(spec, index + 1, spec.kind === 'floor' ? '1F' : undefined)));
    expect(new Set(paths).size).toBe(paths.length);
    expect(paths).toEqual([
      '01-效果图/效果图-01.png', '01-效果图/效果图-02.png', '01-效果图/效果图-03.png',
      '02-平面图/平面-1F.dxf',
      '03-物料清单/物料清单.csv',
      '04-分享/分享链接.txt',
      'manifest.json',
      'README.txt',
    ]);
  });

  it('sanitizes project and floor names without silently dropping them', () => {
    expect(safeFilePart(' Hall D5 / 东厅 ', '项目')).toBe('Hall_D5_东厅');
    expect(deliveryPackageRoot('Hall D5/东厅', 'v1.0')).toBe('幕景_Hall_D5_东厅_v1.0');
    expect(deliveryPackageRoot('', 'v2.3')).toBe('幕景_项目_v2.3');
    expect(safeFilePart('  ', '项目')).toBe('项目');
    const floor = DELIVERY_ARTIFACTS.find(spec => spec.kind === 'floor')!;
    expect(deliveryArtifactPath(floor, 1, 'B1 夹层')).toBe('02-平面图/平面-B1_夹层.dxf');
  });

  it('refuses a version it cannot reproduce from the manifest', () => {
    expect(isDeliveryVersion('v1.0')).toBe(true);
    expect(isDeliveryVersion('v10.21')).toBe(true);
    expect(isDeliveryVersion('1.0')).toBe(false);
    expect(isDeliveryVersion('v1')).toBe(false);
    expect(DELIVERY_VERSION_PATTERN.test('v1.0-beta')).toBe(false);
    expect(() => deliveryPackageRoot('场景', '1.0')).toThrow(/v<主>.<次>/);
  });
});

describe('delivery manifest contract', () => {
  it('pins the fields B1/B2 must write', () => {
    expect(DELIVERY_MANIFEST_REQUIRED_FIELDS).toEqual([
      'format', 'packageVersion', 'deliveryVersion', 'snapshotId', 'layoutId', 'projectName',
      'generatedAt', 'sceneFormat', 'contentFingerprint', 'status', 'files', 'missing', 'share',
    ]);
    expect(DELIVERY_PACKAGE_FORMAT).toBe('scendance-delivery-package');
  });

  it('keeps the scene payload format in step with scene-delivery.ts', () => {
    const source = readFileSync(join(here, 'scene-delivery.ts'), 'utf8');
    expect(source).toContain(`format: '${DELIVERY_SCENE_FORMAT}'`);
    expect(source).toContain(`version: ${DELIVERY_SCENE_FORMAT_VERSION}, units: 'm'`);
  });
});

describe('delivery retry policy', () => {
  it('retries only transient failures, with one backoff per retry', () => {
    expect(DELIVERY_RETRY.maxAttempts).toBe(3);
    expect(DELIVERY_RETRY.backoffMs).toHaveLength(DELIVERY_RETRY.maxAttempts - 1);
    for (const code of ['network', 'asset-fetch', 'timeout', 'memory'] as const) expect(isRetryableDeliveryCode(code)).toBe(true);
    for (const code of ['no-floor', 'preset-unsupported', 'entrance-unsupported', 'share-over-budget', 'render-failed'] as const) {
      expect(isRetryableDeliveryCode(code)).toBe(false);
    }
  });

  it('resumes per artifact and never rewrites a generated share snapshot', () => {
    expect(DELIVERY_RETRY.resume).toBe('per-artifact');
    expect(DELIVERY_RETRY.shareSnapshot).toBe('immutable');
  });
});
