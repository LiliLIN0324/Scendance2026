import { afterEach, describe, expect, it } from 'vitest';
import {
  catalogFacilityTemplateId,
  clearPlanCatalogDrag,
  getPlanCatalogDrag,
  planCatalogDragFor,
  planCatalogDragForScenePreset,
  setPlanCatalogDrag,
} from './plan-catalog-drag';

afterEach(() => clearPlanCatalogDrag());

describe('plan-catalog-drag', () => {
  it('有贴纸时沿用卡片图标模板，2D 落位不是白框', () => {
    const payload = planCatalogDragFor({
      slug: 'live-music-venue-and-festival-stage-generator-trailer-354a33e9',
      name: '发电机拖车',
      width: 3.34,
      depth: 3.08,
      stickerSlug: 'generator',
    });
    expect(payload.templateId).toBe('oneplan:icon:generator');
    expect(payload.width).toBe(3.34);
  });

  it('长 slug 无图标时用短哈希，templateId 不超过契约 64 字符', () => {
    const slug = 'live-music-venue-and-festival-stage-generator-trailer-354a33e9';
    const payload = planCatalogDragFor({ slug, name: '发电机拖车', width: 3.34, depth: 3.08 });
    expect(payload.templateId).toBe(catalogFacilityTemplateId(slug));
    expect(payload.templateId.length).toBeLessThanOrEqual(64);
    expect(payload.templateId).not.toBe(catalogFacilityTemplateId(`${slug}-other`));
  });

  it('store 只保留最后拖起的一件，松手/取消后清空', () => {
    const first = planCatalogDragFor({ slug: 'a', name: 'A', width: 1, depth: 1 });
    const second = planCatalogDragFor({ slug: 'b', name: 'B', width: 2, depth: 2 });
    setPlanCatalogDrag(first);
    setPlanCatalogDrag(second);
    expect(getPlanCatalogDrag()).toEqual(second);
    clearPlanCatalogDrag();
    expect(getPlanCatalogDrag()).toBeNull();
  });

  it('场景预设沿用同一份落位载荷，templateId 可反解回预设 key', () => {
    const payload = planCatalogDragForScenePreset('popup');
    expect(payload).toEqual({
      slug: 'scene-preset:popup',
      name: '青序 · 香氛快闪',
      width: 12,
      depth: 8,
      templateId: 'scene-preset:popup',
    });
    expect(payload.templateId.length).toBeLessThanOrEqual(64);
  });
});
