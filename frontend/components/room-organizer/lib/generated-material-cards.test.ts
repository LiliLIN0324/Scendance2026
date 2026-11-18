import { describe, expect, it } from 'vitest';
import { mergeCloudGeneratedCards, type GeneratedMaterialCard } from './generated-material-cards';
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
});
