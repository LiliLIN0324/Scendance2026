import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { libraryResources, resourceIndex } from '../supabase/functions/_shared/scene-resources.ts';
import { validateLibraryModel } from '../scripts/library-model.ts';

const root = new URL('../', import.meta.url);
const read = async (path: string) => JSON.parse(await readFile(new URL(path, root), 'utf8'));

describe('merged model library', () => {
  it('contains unique, Chinese-labelled assets with matching GLBs and previews', async () => {
    const catalogue = await read('assets/library/merged.json');
    const hashes = new Set();
    for (const model of catalogue.models) {
      expect(model.name).toMatch(/[\u4e00-\u9fff]/u);
      expect(catalogue.buckets.some((b: { key: string }) => b.key === model.bucket)).toBe(true);
      expect(hashes.has(model.sha256), model.slug).toBe(false);
      hashes.add(model.sha256);
      const bytes = await readFile(new URL(model.glb.replace('/showcase/', ''), root));
      expect(bytes.length, model.slug).toBe(model.bytes);
      expect(createHash('sha256').update(bytes).digest('hex'), model.slug).toBe(model.sha256);
      const preview = await readFile(new URL(model.thumb.replace('/showcase/', ''), root));
      expect(preview.toString('ascii', 8, 12)).toBe('WEBP');
      if (model.blockedReason) {
        await expect(validateLibraryModel(bytes)).rejects.toThrow('MODEL_TOO_COMPLEX');
      } else {
        const metadata = await validateLibraryModel(bytes);
        expect(model.width, model.slug).toBeCloseTo(metadata.sourceSize.width, 2);
        expect(model.depth, model.slug).toBeCloseTo(metadata.sourceSize.depth, 2);
        expect(model.height, model.slug).toBeCloseTo(metadata.sourceSize.height, 2);
      }
    }
    expect(hashes.size).toBe(catalogue.count);
    expect(catalogue.buckets.reduce((sum: number, bucket: { count: number }) => sum + bucket.count, 0)).toBe(catalogue.count);
  }, 30_000);

  it('preserves every original cloud ID and maps only byte-identical local files to it', async () => {
    const old = await read('assets/library/online.json');
    const merged = await read('assets/library/merged.json');
    const ids = await read('assets/library/asset-ids.json');
    for (const original of old.models) {
      const model = merged.models.find((m: { slug: string }) => m.slug === original.slug);
      expect(model, original.slug).toBeDefined();
      expect(model.assetId).toBe(original.assetId);
      expect(model.sha256).toBe(original.sha256);
      expect(ids[original.glb]).toBe(original.assetId);
      expect(ids[model.glb]).toBe(original.assetId);
    }
    for (const model of merged.models.filter((m: { sources: string[]; assetId?: string }) => !m.assetId)) {
      expect(ids[model.glb]).toBeUndefined();
    }
  });

  it('uses the same registered Chinese resources in the Agent and editor, retaining old references', async () => {
    const merged = await read('assets/library/merged.json');
    const original = await read('assets/library/online.json');
    expect(libraryResources).toHaveLength(528);
    for (const [index, old] of original.models.entries()) {
      expect(libraryResources[index]).toMatchObject({ resourceId: `library:${index}`, assetId: old.assetId });
    }
    expect(libraryResources.map(m => m.assetId)).toEqual(merged.models.filter((m: {blockedReason?: string}) => !m.blockedReason).map((m: {assetId: string}) => m.assetId));
    for (const resource of libraryResources) {
      expect(resource.name).toMatch(/[\u4e00-\u9fff]/u);
      expect(resource.category).toMatch(/[\u4e00-\u9fff]/u);
    }
    expect(JSON.stringify(resourceIndex(libraryResources))).not.toContain('https://');
  });

  it('accounts for all 279 supplied files and every repaired truncation', async () => {
    const source = await read('assets/library/model200.json');
    const merged = await read('assets/library/merged.json');
    expect(source.models).toHaveLength(279);
    expect(source.repairs).toHaveLength(24);
    for (const model of source.models) {
      const entry = merged.models.find((m: { sha256: string }) => m.sha256 === model.sha256);
      expect(entry, model.slug).toBeDefined();
      expect(entry.sources).toContain('model200');
    }
    expect(merged.models.filter((m: { blockedReason?: string }) => m.blockedReason)).toHaveLength(1);
  });
});
