import { describe, expect, it } from 'vitest';
import { firstModelSlug, isLibraryModelSlug, looksLikeBackendAssetId } from './asset-namespace';

const UUID = '50000000-0000-4000-8000-000000000001';

describe('asset namespace（C1 严格分离）', () => {
  it('UUID 只认后端 id，不当 slug', () => {
    expect(looksLikeBackendAssetId(UUID)).toBe(true);
    expect(looksLikeBackendAssetId(UUID.toUpperCase())).toBe(true);
    expect(looksLikeBackendAssetId('lib:sofa-01')).toBe(false);
    expect(looksLikeBackendAssetId('')).toBe(false);
    expect(isLibraryModelSlug(UUID)).toBe(false);
    expect(isLibraryModelSlug(UUID.toUpperCase())).toBe(false);
  });

  it('slug 接受物料库常见写法，拒绝空串与超长', () => {
    expect(isLibraryModelSlug('chair-01')).toBe(true);
    expect(isLibraryModelSlug('generated:library-x')).toBe(true);
    expect(isLibraryModelSlug('   ')).toBe(false);
    expect(isLibraryModelSlug(undefined)).toBe(false);
    expect(isLibraryModelSlug('x'.repeat(161))).toBe(false);
  });

  it('firstModelSlug 跳过 UUID 与空值，取第一个合法项并 trim', () => {
    expect(firstModelSlug(undefined, UUID, '  sofa-01  ', 'table-02')).toBe('sofa-01');
    expect(firstModelSlug(UUID, '')).toBeUndefined();
  });
});
