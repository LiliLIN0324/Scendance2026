import { describe, expect, it } from 'vitest';
import {
  assetCacheKey,
  parsePeopleAssetManifest,
  resolvePeopleAssetLod,
  type PeopleAssetEntry,
} from './asset-manifest';

const validManifest = () => ({
  version: 1,
  assets: {
    '9b9bb4da-0000-4000-8000-000000000001': {
      bytes: 2_500_000,
      hash: 'sha256-abc',
      lods: [
        { level: 2, url: '/people/a.lod2.glb', bytes: 400_000 },
        { level: 0, url: '/people/a.glb', bytes: 2_500_000 },
      ],
    },
    '9b9bb4da-0000-4000-8000-000000000002': { bytes: 41_872_000, hash: 'sha256-def' },
  },
});

describe('parsePeopleAssetManifest（资产清单解析）', () => {
  it('合法清单：保留体积/hash，LOD 按 level 升序', () => {
    const result = parsePeopleAssetManifest(validManifest());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const entry = result.manifest.assets['9b9bb4da-0000-4000-8000-000000000001']!;
    expect(entry.bytes).toBe(2_500_000);
    expect(entry.hash).toBe('sha256-abc');
    expect(entry.lods?.map((lod) => lod.level)).toEqual([0, 2]);
    expect(result.manifest.assets['9b9bb4da-0000-4000-8000-000000000002']!.lods).toBeUndefined();
  });

  it('未知字段忽略（向前兼容），不因此拒绝', () => {
    const input = validManifest();
    const result = parsePeopleAssetManifest({
      ...input,
      generatedAt: '2026-11-16',
      assets: {
        ...input.assets,
        '9b9bb4da-0000-4000-8000-000000000003': {
          bytes: 1000,
          hash: 'h',
          futureField: { nested: true },
        },
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.manifest.assets['9b9bb4da-0000-4000-8000-000000000003']!.bytes).toBe(1000);
  });

  it('版本不是 1：拒绝并说明（不静默读新结构）', () => {
    const result = parsePeopleAssetManifest({ version: 2, assets: {} });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('版本');
  });

  it('缺 assets / 非对象输入：拒绝且不抛异常', () => {
    expect(parsePeopleAssetManifest(null).ok).toBe(false);
    expect(parsePeopleAssetManifest('x').ok).toBe(false);
    expect(parsePeopleAssetManifest([1, 2]).ok).toBe(false);
    const missing = parsePeopleAssetManifest({ version: 1 });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.error).toContain('assets');
  });

  it('bytes 非正整数：拒绝（0 字节不是合法资产）', () => {
    for (const bytes of [0, -1, 1.5, Number.NaN]) {
      const result = parsePeopleAssetManifest({ version: 1, assets: { a: { bytes, hash: 'h' } } });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain('bytes');
    }
  });

  it('缺 hash / 空 hash：拒绝（无 hash 无法做缓存失效）', () => {
    for (const hash of [undefined, '', '   ']) {
      const result = parsePeopleAssetManifest({ version: 1, assets: { a: { bytes: 100, hash } } });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain('hash');
    }
  });

  it('LOD 结构错误：重复 level / 缺 url / bytes 非法都拒绝', () => {
    const dup = parsePeopleAssetManifest({
      version: 1,
      assets: { a: { bytes: 1, hash: 'h', lods: [
        { level: 0, url: '/a', bytes: 1 },
        { level: 0, url: '/b', bytes: 1 },
      ] } },
    });
    expect(dup.ok).toBe(false);
    if (!dup.ok) expect(dup.error).toContain('重复');

    const noUrl = parsePeopleAssetManifest({
      version: 1,
      assets: { a: { bytes: 1, hash: 'h', lods: [{ level: 0, bytes: 1 }] } },
    });
    expect(noUrl.ok).toBe(false);

    const badBytes = parsePeopleAssetManifest({
      version: 1,
      assets: { a: { bytes: 1, hash: 'h', lods: [{ level: 0, url: '/a', bytes: 0 }] } },
    });
    expect(badBytes.ok).toBe(false);
  });
});

describe('resolvePeopleAssetLod（按档位取地址）', () => {
  const entry: PeopleAssetEntry = {
    bytes: 2_500_000,
    hash: 'h',
    lods: [
      { level: 0, url: '/a.glb', bytes: 2_500_000 },
      { level: 2, url: '/a.lod2.glb', bytes: 400_000 },
    ],
  };

  it('有精确档位时精确命中', () => {
    expect(resolvePeopleAssetLod(entry, 0)?.url).toBe('/a.glb');
    expect(resolvePeopleAssetLod(entry, 2)?.url).toBe('/a.lod2.glb');
  });

  it('请求档位不存在时退到「不粗于请求」的最细一档', () => {
    expect(resolvePeopleAssetLod(entry, 1)?.level).toBe(2);
  });

  it('请求比所有档位更粗时退到最粗一档，而不是不给模型', () => {
    expect(resolvePeopleAssetLod(entry, 5)?.level).toBe(2);
  });

  it('没有任何 LOD 返回 null（不虚构）', () => {
    expect(resolvePeopleAssetLod({}, 0)).toBeNull();
    expect(resolvePeopleAssetLod({ lods: [] }, 0)).toBeNull();
  });

  it('非法 level 不崩：NaN 按 0 处理', () => {
    expect(resolvePeopleAssetLod(entry, Number.NaN)?.url).toBe('/a.glb');
  });
});

describe('assetCacheKey（缓存键带 hash）', () => {
  it('正常返回 assetId:hash', () => {
    expect(assetCacheKey('a001', { hash: 'sha256-abc' })).toBe('a001:sha256-abc');
  });

  it('hash 为空或 assetId 为空：返回 null，调用方必须当不可缓存处理', () => {
    expect(assetCacheKey('a001', { hash: '' })).toBeNull();
    expect(assetCacheKey('  ', { hash: 'h' })).toBeNull();
  });

  it('hash 变化 ⇒ 键变化（换资产必失效）', () => {
    expect(assetCacheKey('a001', { hash: 'h1' })).not.toBe(assetCacheKey('a001', { hash: 'h2' }));
  });
});
