import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  catalogDragFromText,
  catalogFacilityTemplateId,
  clearPlanCatalogDrag,
  consumePlanCatalogDrag,
  getPlanCatalogDrag,
  PLAN_CATALOG_TEXT_PREFIX,
  planCatalogDragFor,
  readPlanCatalogDrag,
  serializePlanCatalogDrag,
  setPlanCatalogDrag,
} from './plan-catalog-drag';

afterEach(() => {
  consumePlanCatalogDrag();
  vi.useRealTimers();
});

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

  it('store 只保留最后拖起的一件；dragend 先于 drop 时下一拍才清空', () => {
    vi.useFakeTimers();
    const first = planCatalogDragFor({ slug: 'a', name: 'A', width: 1, depth: 1 });
    const second = planCatalogDragFor({ slug: 'b', name: 'B', width: 2, depth: 2 });
    setPlanCatalogDrag(first);
    setPlanCatalogDrag(second);
    expect(getPlanCatalogDrag()).toEqual(second);
    clearPlanCatalogDrag();
    expect(getPlanCatalogDrag()).toEqual(second);
    const json = serializePlanCatalogDrag(second);
    expect(readPlanCatalogDrag('', `${PLAN_CATALOG_TEXT_PREFIX}${json}`)).toEqual(second);
    expect(catalogDragFromText('oneplan:icon:tent')).toBeNull();
    vi.runAllTimers();
    expect(getPlanCatalogDrag()).toBeNull();
  });

  it('drop 取走载荷后，迟到的 dragend 清空不会抹掉下一件', () => {
    vi.useFakeTimers();
    const first = planCatalogDragFor({ slug: 'a', name: 'A', width: 1, depth: 1 });
    const second = planCatalogDragFor({ slug: 'b', name: 'B', width: 2, depth: 2 });
    setPlanCatalogDrag(first);
    clearPlanCatalogDrag();
    consumePlanCatalogDrag();
    setPlanCatalogDrag(second);
    vi.runAllTimers();
    expect(getPlanCatalogDrag()).toEqual(second);
  });
});
