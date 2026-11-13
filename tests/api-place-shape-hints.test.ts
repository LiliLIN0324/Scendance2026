import { expect, it, vi } from 'vitest';
import { handlePlaceShapeHints } from '../functions/api/place-shape-hints.ts';
it('库存提示只读、无配置正常空结果；过滤线路/自交/公交垃圾，不返回几何或凭证', async () => {
  const fetchImpl = vi.fn(async (_url: unknown, _init?: RequestInit) => Response.json([
    { name: '湖滨银泰·IN77', name_norm: 'in77', kind: 'area', polygon: [[120,30],[120.01,30],[120.01,30.01],[120,30.01]] },
    { name: '杭州大厦', kind: 'line', polygon: [[120,30],[120.01,30],[120.01,30.01]] },
    { name: '316路：总站 -> 武林广场西', kind: 'area', polygon: [[120,30],[120.01,30],[120.01,30.01],[120,30.01]] },
  ]));
  const request = new Request('https://example.test/api/place-shape-hints?q=in77%2Ckind.eq.line');
  const empty = await handlePlaceShapeHints(request, {}, fetchImpl as typeof fetch); expect(await empty.json()).toEqual({ hints: [] }); expect(fetchImpl).not.toHaveBeenCalled();
  const response = await handlePlaceShapeHints(request, { NEXT_PUBLIC_SUPABASE_ANON_KEY: 'public-fixture-only' }, fetchImpl as typeof fetch);
  const body = await response.json(); expect(body.hints).toHaveLength(1); expect(body.hints[0].name).toBe('湖滨银泰·IN77');
  expect(JSON.stringify(body)).not.toMatch(/polygon|public-fixture-only/);
  expect(response.headers.get('Cache-Control')).toBe('no-store');
  const url = new URL(String(fetchImpl.mock.calls[0]?.[0])); expect(url.searchParams.get('or')).not.toContain('kind.eq.line');
});
