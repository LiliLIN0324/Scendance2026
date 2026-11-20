import { describe, expect, it } from 'vitest';
import { firstModelSlug } from './asset-namespace';
import {
  GENERATED_DRAG_FALLBACK, generatedCardFootprint, generatedPlacementSlug, mergeCloudGeneratedCards,
  type GeneratedMaterialCard,
} from './generated-material-cards';
import type { CloudAsset } from '@/lib/assets-api';

const local: GeneratedMaterialCard[] = [
  { id: 'shipped-chinese-wood-armchair', name: '中式木扶手椅', shipped: true },
  { id: 'shipped-white-round-table', name: '白色圆桌', shipped: true },
];

function asset(patch: Partial<CloudAsset> & Pick<CloudAsset, 'id' | 'name' | 'source' | 'format'>): CloudAsset {
  return { byte_size: 1024, ...patch };
}

describe('mergeCloudGeneratedCards', () => {
  it('未登录时只留本机和随包', () => {
    expect(mergeCloudGeneratedCards(local, null)).toEqual(local);
  });

  it('登录后补上账户里的用户生成 GLB，公共库和点云不进这格', () => {
    const chair = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const merged = mergeCloudGeneratedCards(local, [
      asset({ id: chair, name: '户外折叠椅 1', source: 'aholo', format: 'glb', byte_size: 10_380_902, metadata: { previewUrl: 'https://cdn.example.test/chair.png' } }),
      asset({ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', name: '公共石凳', source: 'polyhaven', format: 'glb' }),
      asset({ id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', name: '宴会厅点云', source: 'aholo', format: 'spz' }),
    ]);
    expect(merged.map(card => card.name)).toEqual(['中式木扶手椅', '白色圆桌', '户外折叠椅 1']);
    expect(merged[2]).toMatchObject({ id: chair, cloud: true, image: 'https://cdn.example.test/chair.png', shipped: false });
  });

  it('同一资产号本机和云端都有时只留一格，并继续走本机摆放', () => {
    const merged = mergeCloudGeneratedCards(local, [
      asset({ id: 'shipped-chinese-wood-armchair', name: '中式木扶手椅', source: 'aholo', format: 'GLB' }),
      asset({ id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', name: '  户外折叠椅 1  ', source: 'hunyuan', format: 'glb' }),
    ]);
    expect(merged.filter(card => card.id === 'shipped-chinese-wood-armchair')).toHaveLength(1);
    expect(merged.find(card => card.id === 'shipped-chinese-wood-armchair')?.cloud).toBeUndefined();
    expect(merged.at(-1)).toMatchObject({ name: '户外折叠椅 1', cloud: true });
  });

  it('历史生成记录的长提示词名字在显示层收口，其它来源的名字不动', () => {
    const generated = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const uploaded = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const prompt = '户外折叠椅 1：铝合金折叠框架，藏青色厚棉布坐垫靠背，座高 45 厘米';
    const merged = mergeCloudGeneratedCards([], [
      asset({ id: generated, name: prompt, source: 'aholo', format: 'glb' }),
      asset({ id: uploaded, name: '我的超长模型文件名版本二〇二六年十一月', source: 'upload', format: 'glb' }),
    ]);
    expect(merged.find(card => card.id === generated)?.name).toBe('户外折叠椅');
    expect(merged.find(card => card.id === uploaded)?.name).toBe('我的超长模型文件名版本二〇二六年十一月');
  });

  it('没有预览图也保留名字，并带上云端记下的占地', () => {
    const chair = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const merged = mergeCloudGeneratedCards([], [
      asset({
        id: chair, name: '折叠椅', source: 'hunyuan', format: 'glb',
        metadata: { sourceSize: { width: 0.55, depth: 0.48, height: 0.9 } },
      }),
    ]);
    expect(merged).toMatchObject([{
      id: chair, name: '折叠椅', shipped: false, cloud: true, width: 0.55, depth: 0.48,
    }]);
    expect(merged[0]?.image).toBeUndefined();
  });

  it('详情保留完整生成描述：旧记录取 backfill.originalName，新记录取 originalPrompt', () => {
    const legacy = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const current = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const legacyPrompt = '户外折叠椅 1：铝合金折叠框架，藏青色厚棉布坐垫靠背，座高 45 厘米';
    const currentPrompt = '白色圆桌：直径 80 厘米，哑光桌面';
    const merged = mergeCloudGeneratedCards([], [
      asset({ id: legacy, name: '户外折叠椅', source: 'aholo', format: 'glb', metadata: { backfill: { originalName: legacyPrompt } } }),
      asset({ id: current, name: '白色圆桌', source: 'hunyuan', format: 'glb', metadata: { originalPrompt: currentPrompt }, license: { type: 'provider-terms' } }),
    ]);
    expect(merged.find(card => card.id === legacy)?.description).toBe(legacyPrompt);
    expect(merged.find(card => card.id === current)?.description).toBe(currentPrompt);
    expect(merged.find(card => card.id === current)?.license).toEqual({ type: 'provider-terms' });
  });
});

describe('generatedPlacementSlug', () => {
  const chair = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

  it('云端 UUID 换成 generated:library-，随包 id 保持原样', () => {
    expect(generatedPlacementSlug(chair)).toBe(`generated:library-${chair}`);
    expect(firstModelSlug(generatedPlacementSlug(chair))).toBe(`generated:library-${chair}`);
    expect(firstModelSlug(chair)).toBeUndefined();
    expect(generatedPlacementSlug('shipped-chinese-wood-armchair')).toBe('shipped-chinese-wood-armchair');
  });

  it('没有占地时拖放用 0.5 米占位，有记录就用记录', () => {
    expect(generatedCardFootprint({})).toEqual(GENERATED_DRAG_FALLBACK);
    expect(generatedCardFootprint({ width: 0.55, depth: 0.48 })).toEqual({ width: 0.55, depth: 0.48 });
  });
});
