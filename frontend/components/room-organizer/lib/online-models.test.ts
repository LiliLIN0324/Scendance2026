import { describe, expect, it } from 'vitest';
import { ONLINE_BUCKET_LABELS, buildOnlineModelIndex, clearOnlineModelCache, filterOnlineModels,
  formatModelBytes, loadOnlineModels, normalizeOnlineModels, onlineBucketLabel,
  onlineModelThumb } from './online-models';

/** A catalogue row shaped the way `assets/library/online.json` writes it. */
function row(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    slug: 'seating-chaise-0001',
    name: 'Lounge Chaise (Airport Lounge)',
    bucket: 'seating',
    subcategory: '座椅',
    width: 0.78,
    depth: 0.9,
    height: 0.72,
    bytes: 71_752,
    triangles: 1_688,
    downloads: 9,
    thumb: 'https://cdn.3dassets.dev/assets/33803/v1/thumb.webp',
    glb: 'https://cdn.3dassets.dev/assets/33803/v1/model.glb',
    page: 'https://3dassets.dev/assets/lounge-chaise',
    ...overrides,
  };
}

describe('normalizeOnlineModels', () => {
  it('keeps a well-formed row and trims its text fields', () => {
    const [model] = normalizeOnlineModels([row({ name: '  Lounge Chaise  ', bucket: ' seating ' })]);
    expect(model).toEqual({
      slug: 'seating-chaise-0001',
      name: 'Lounge Chaise',
      bucket: 'seating',
      subcategory: '座椅',
      width: 0.78,
      depth: 0.9,
      height: 0.72,
      bytes: 71_752,
      triangles: 1_688,
      downloads: 9,
      thumb: 'https://cdn.3dassets.dev/assets/33803/v1/thumb.webp',
      glb: 'https://cdn.3dassets.dev/assets/33803/v1/model.glb',
      page: 'https://3dassets.dev/assets/lounge-chaise',
    });
  });

  it('drops the rows the workspace cannot place instead of failing the whole catalogue', () => {
    const rows: unknown[] = [
      row({ slug: 'keep-me' }),
      row({ slug: '   ' }),                                    // no identity
      row({ slug: 'no-name', name: '  ' }),
      row({ slug: 'no-file', glb: '' }),
      row({ slug: 'bad-scheme', glb: 'ftp://cdn.3dassets.dev/a.glb' }),
      row({ slug: 'plain-http', glb: 'http://cdn.3dassets.dev/a.glb' }),
      row({ slug: 'zero-width', width: 0 }),
      row({ slug: 'negative-height', height: -1 }),
      row({ slug: 'nan-depth', depth: Number.NaN }),
      null,
      'nope',
      42,
    ];
    expect(normalizeOnlineModels(rows).map(model => model.slug)).toEqual(['keep-me']);
  });

  it('drops a repeated slug so the grid cannot offer the same GLB twice', () => {
    const models = normalizeOnlineModels([row({ slug: 'twin' }), row({ slug: 'twin', name: 'Other' })]);
    expect(models).toHaveLength(1);
    expect(models[0]!.name).toBe('Lounge Chaise (Airport Lounge)');
  });

  it('clamps dimensions into the envelope the workspace number inputs accept', () => {
    const models = normalizeOnlineModels([
      row({ slug: 'huge', width: 100 }),
      row({ slug: 'tiny', depth: 0.001 }),
      row({ slug: 'precise', height: 1.23456 }),
    ]);
    expect(models[0]!.width).toBe(50);
    expect(models[1]!.depth).toBe(0.02);
    expect(models[2]!.height).toBe(1.235);
  });

  it('keeps a model whose thumbnail is unusable, with an empty thumb', () => {
    const [model] = normalizeOnlineModels([row({ thumb: 'javascript:alert(1)' })]);
    expect(model!.thumb).toBe('');
    expect(model!.glb).toContain('model.glb');
  });

  it('reads a missing counter as zero rather than NaN', () => {
    const [model] = normalizeOnlineModels([row({ bytes: -5, triangles: 'many', downloads: undefined })]);
    expect([model!.bytes, model!.triangles, model!.downloads]).toEqual([0, 0, 0]);
  });

  it('reads the `{ modelCount, models }` wrapper the catalogue ships in', () => {
    expect(normalizeOnlineModels({ modelCount: 1, models: [row({ slug: 'wrapped' })] }).map(model => model.slug))
      .toEqual(['wrapped']);
  });

  it('survives a payload that is not a list of models', () => {
    expect(normalizeOnlineModels({ modelCount: 3 })).toEqual([]);
    expect(normalizeOnlineModels({ models: 'not-an-array' })).toEqual([]);
    expect(normalizeOnlineModels(null)).toEqual([]);
    expect(normalizeOnlineModels(undefined)).toEqual([]);
  });
});

describe('buildOnlineModelIndex', () => {
  const models = normalizeOnlineModels([
    row({ slug: 'seat-a', bucket: 'seating' }),
    row({ slug: 'seat-b', bucket: 'seating' }),
    row({ slug: 'stage-a', bucket: 'stage' }),
    row({ slug: 'stage-b', bucket: 'stage' }),
    row({ slug: 'stage-c', bucket: 'stage' }),
    row({ slug: 'plant-a', bucket: 'plants', subcategory: '绿植' }),
  ]);
  const index = buildOnlineModelIndex(models);

  it('labels and counts every family, busiest first', () => {
    expect(index.buckets).toEqual([
      { key: 'stage', label: '舞台', count: 3 },
      { key: 'seating', label: '座椅', count: 2 },
      { key: 'plants', label: '绿植', count: 1 },
    ]);
  });

  it('passes the model list through untouched', () => {
    expect(index.models).toBe(models);
  });

  it('leaves out an unfamilied model rather than adding a blank chip', () => {
    const lone = buildOnlineModelIndex(normalizeOnlineModels([row({ slug: 'loose', bucket: '' })]));
    expect(lone.models).toHaveLength(1);
    expect(lone.buckets).toEqual([]);
  });
});

describe('onlineBucketLabel', () => {
  it('translates a known family and falls back to the raw key otherwise', () => {
    expect(onlineBucketLabel('seating')).toBe('座椅');
    expect(onlineBucketLabel('unmapped-family')).toBe('unmapped-family');
    expect(onlineBucketLabel('')).toBe('其他');
    expect(ONLINE_BUCKET_LABELS.stage).toBe('舞台');
  });
});

describe('filterOnlineModels', () => {
  const models = normalizeOnlineModels([
    row({ slug: 'seating-chaise-0001', name: 'Lounge Chaise', bucket: 'seating', subcategory: '座椅' }),
    row({ slug: 'stage-tower-0002', name: 'Lighting Tower', bucket: 'stage', subcategory: '舞台' }),
  ]);

  it('returns the whole list when nothing is typed or selected', () => {
    expect(filterOnlineModels(models, '', '')).toHaveLength(2);
    expect(filterOnlineModels(models, '   ', '')).toHaveLength(2);
  });

  it('matches the name without caring about case', () => {
    expect(filterOnlineModels(models, 'lounge', '').map(model => model.slug)).toEqual(['seating-chaise-0001']);
    expect(filterOnlineModels(models, 'LOUNGE', '').map(model => model.slug)).toEqual(['seating-chaise-0001']);
  });

  it('matches the Chinese subcategory and a pasted slug fragment', () => {
    expect(filterOnlineModels(models, '舞台', '').map(model => model.slug)).toEqual(['stage-tower-0002']);
    expect(filterOnlineModels(models, 'stage-tower', '').map(model => model.slug)).toEqual(['stage-tower-0002']);
  });

  it('narrows by family on its own, and combines with the query', () => {
    expect(filterOnlineModels(models, '', 'stage').map(model => model.slug)).toEqual(['stage-tower-0002']);
    expect(filterOnlineModels(models, 'tower', 'seating')).toHaveLength(0);
  });

  it('returns nothing when the query matches no field', () => {
    expect(filterOnlineModels(models, 'zzz', '')).toHaveLength(0);
  });
});

describe('formatModelBytes', () => {
  it('quotes bytes, KB and MB, and stays silent for an unknown size', () => {
    expect(formatModelBytes(0)).toBe('');
    expect(formatModelBytes(900)).toBe('900 B');
    expect(formatModelBytes(71_752)).toBe('70 KB');
    expect(formatModelBytes(3 * 1024 * 1024)).toBe('3.0 MB');
  });
});

describe('onlineModelThumb', () => {
  it('points at the thumbnail served beside a catalogue GLB', () => {
    expect(onlineModelThumb('https://cdn.3dassets.dev/assets/33803/v1/model.glb'))
      .toBe('https://cdn.3dassets.dev/assets/33803/v1/thumb.webp');
  });

  it('returns nothing for anything that is not a catalogue GLB', () => {
    expect(onlineModelThumb('/assets/models/table.glb')).toBe('');
    expect(onlineModelThumb('https://cdn.example.com/a.glb')).toBe('');
    expect(onlineModelThumb('https://cdn.3dassets.dev/assets/33803/v1/model.glb?v=2')).toBe('');
    expect(onlineModelThumb(undefined)).toBe('');
  });
});

/**
 * These read the catalogue actually shipped in the repository. Every other spec here
 * feeds hand-built rows, which is exactly how a wrapper object at the top of the real
 * file once slipped through and left the panel listing nothing.
 */
describe('loadOnlineModels', () => {
  it('loads the shipped catalogue into a usable index', async () => {
    clearOnlineModelCache();
    const index = await loadOnlineModels();
    expect(index.models.length).toBeGreaterThan(100);
    expect(index.buckets.length).toBeGreaterThan(1);
    for (const model of index.models) {
      expect(model.glb.startsWith('https://')).toBe(true);
      expect(model.name.length).toBeGreaterThan(0);
      expect(model.width).toBeGreaterThan(0);
      expect(model.depth).toBeGreaterThan(0);
      expect(model.height).toBeGreaterThan(0);
    }
  });

  it('counts every model under a family the rail can label', async () => {
    clearOnlineModelCache();
    const index = await loadOnlineModels();
    const counted = index.buckets.reduce((total, bucket) => total + bucket.count, 0);
    expect(counted).toBeLessThanOrEqual(index.models.length);
    expect(index.buckets.every(bucket => bucket.count > 0 && bucket.label.length > 0)).toBe(true);
  });

  it('serves later calls from the cache instead of re-reading the file', async () => {
    clearOnlineModelCache();
    const first = await loadOnlineModels();
    const second = await loadOnlineModels();
    expect(second).toBe(first);
  });
});
