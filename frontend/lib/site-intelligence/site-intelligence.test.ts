import { describe, it, expect, vi } from 'vitest';
import { sitePlanDataSchema } from '../../../supabase/functions/_shared/site-plan';
import { buildSiteSnapshot, planObjectId, toLocal, toGeographic, gcj02ToWgs84, containsGeometry, parseOverpassEvidence, loadMapEvidence, createEvidenceLoader, resolveReferences, validateModelReferences, evidenceHighlights, buildModelContext } from './index';
import type { Geometry, MapFeature } from './types';
const anchor = { lng: 120.16, lat: 30.25, crs: 'gcj-02' as const, source: 'lookup' as const };
const square = (x: number, y: number, w: number): Geometry => ({ type: 'polygon', points: [{ x, y }, { x: x + w, y }, { x: x + w, y: y + w }, { x, y: y + w }] });
const uuid = (n: number) => `11111111-1111-4111-8111-${String(n).padStart(12, '0')}`;
function plan() { return sitePlanDataSchema.parse({ schemaVersion: 1, anchor, boundary: square(-20, -20, 100).points, zones: [{ id: uuid(1), semantic: 'stage', name: '展览区', polygon: square(0, 0, 20).points }, { id: uuid(2), semantic: 'audience', name: '展览区', polygon: square(25, 0, 20).points }], facilities: [{ id: uuid(3), templateId: 'stage', name: '舞台', position: { x: 5, y: 0 }, rotationDeg: 0, size: { width: 4, depth: 4 } }], routes: [{ id: uuid(4), kind: 'pedestrian', name: '主流线', points: [{ x: -10, y: 0 }, { x: 20, y: 0 }], widthM: 3 }], nodes: [], workers: [] }); }
function map(kind: MapFeature['kind'], id: string, geometry: Geometry, tags = {}): MapFeature { return { id, kind, geometry, name: id, tags, evidence: { source: 'osm', sourceId: id, certainty: 'mapped', note: 'fixture' } }; }
function osmPoint(x: number, y: number) { const p = toGeographic({ x, y }, anchor), wgs = gcj02ToWgs84(p.lng, p.lat); return { lon: wgs.lng, lat: wgs.lat }; }
describe('site intelligence coordinates and structured evidence', () => {
  it('converts WGS84 to same GCJ ENU and round trips metric axes', () => { const p = osmPoint(100, -30); const local = toLocal(p.lon, p.lat, anchor, 'wgs84'); expect(local.x).toBeCloseTo(100, 2); expect(local.y).toBeCloseTo(-30, 2); expect(() => toLocal(NaN, 30, anchor, 'gcj-02')).toThrow(); });
  it('keeps stable real OSM IDs, real entrances/access/barriers and closed building geometries', () => {
    const body = { complete: true, elements: [{ type: 'way', id: 1, tags: { building: 'yes' }, geometry: [...square(0, 0, 15).points, { x: 0, y: 0 }].map(p => osmPoint(p.x, p.y)) }, { type: 'node', id: 2, tags: { entrance: 'main', access: 'private' }, ...osmPoint(5, 0) }, { type: 'way', id: 3, tags: { barrier: 'fence' }, geometry: [osmPoint(0, -10), osmPoint(0, 10)] }, { type: 'way', id: 4, tags: { highway: 'footway', foot: 'yes' }, nodes: [2, 5], geometry: [osmPoint(5, 0), osmPoint(5, -15)] }] };
    const r = parseOverpassEvidence(body, anchor, 100); expect(r.complete).toBe(true); expect(r.features.map(f => f.kind)).toEqual(['building', 'entrance', 'barrier', 'road']); expect(r.features[1]!.tags.access).toBe('private'); expect(r.features[3]!.nodeIds).toContain('osm:node/2'); expect(r.features[0]!.geometry.points).toHaveLength(4);
  });
  it('does not invent multipolygon outlines, open building rings, missing coordinates or indoor routes', () => { const r = parseOverpassEvidence({ complete: true, elements: [{ type: 'relation', id: 1 }, { type: 'way', id: 2, tags: { building: 'yes' }, geometry: [osmPoint(0, 0), osmPoint(5, 0), osmPoint(0, 5)] }, { type: 'node', id: 3, tags: { entrance: 'yes' } }] }, anchor, 100); expect(r.features).toEqual([]); expect(r.complete).toBe(false); expect(r.warnings.length).toBeGreaterThan(0); });
  it('bounds spatial scope and refuses huge unsupported geometry rather than altering footprint', () => { const r = parseOverpassEvidence({ complete: true, elements: [{ type: 'node', id: 1, tags: { entrance: 'yes' }, ...osmPoint(4000, 0) }, { type: 'way', id: 2, tags: { highway: 'footway' }, geometry: Array.from({ length: 300 }, () => osmPoint(0, 0)) }] }, anchor, 50000); expect(r.features).toEqual([]); expect(r.complete).toBe(false); });
});
describe('joint plan/map snapshot and relations', () => {
  it('maps plan zones/facility footprints and reports doorway, route and barrier conflicts', () => { const p = plan(); const s = buildSiteSnapshot({ projectId: 'p', geometryRevision: 1, plan: p, mapScope: { anchor, radiusM: 100, crs: 'gcj-02' }, mapFeatures: [map('entrance', 'osm:node/2', { type: 'point', points: [{ x: 5, y: 0 }] }), map('building', 'osm:way/1', square(0, 0, 10)), map('barrier', 'osm:way/3', { type: 'line', points: [{ x: 5, y: -5 }, { x: 5, y: 5 }] })] }); expect(s.features.some(f => f.kind === 'zone')).toBe(true); expect(s.relations.map(r => r.type)).toEqual(expect.arrayContaining(['entrance-blocked', 'route-blocked', 'barrier-conflict', 'contains'])); expect(s.coverage.unknowns.join(' ')).toContain('Indoor'); expect(s.confirmedIds).toEqual([]); });
  it('handles concave containment without claiming a line through an exterior notch is contained', () => { const outer: Geometry = { type: 'polygon', points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 7, y: 10 }, { x: 7, y: 3 }, { x: 3, y: 3 }, { x: 3, y: 10 }, { x: 0, y: 10 }] }; expect(containsGeometry(outer, { type: 'line', points: [{ x: 1, y: 8 }, { x: 9, y: 8 }] })).toBe(false); });
  it('does not turn crossing roads or restricted/grade separated topology into real connections', () => { const road = map('road', 'osm:way/1', { type: 'line', points: [{ x: -5, y: 0 }, { x: 5, y: 0 }] }, { bridge: 'yes' }); road.nodeIds = ['osm:node/9']; const gate = map('entrance', 'osm:node/9', { type: 'point', points: [{ x: 0, y: 0 }] }); gate.nodeIds = ['osm:node/9']; const s = buildSiteSnapshot({ projectId: 'p', geometryRevision: 1, plan: plan(), mapScope: { anchor, radiusM: 100, crs: 'gcj-02' }, mapFeatures: [road, gate] }); expect(s.relations.some(r => r.from === road.id && r.to === gate.id && r.type === 'connected')).toBe(false); expect(s.relations.some(r => r.from === road.id && r.to === gate.id && r.type === 'connection-candidate')).toBe(true); });
  it('only accepts map geometry with anchor and isolates project IDs', () => { const p = plan(); delete p.anchor; const s = buildSiteSnapshot({ projectId: 'a', geometryRevision: 1, plan: p, mapScope: { anchor, radiusM: 100, crs: 'gcj-02' }, mapFeatures: [map('building', 'osm:way/1', square(0, 0, 5))] }); expect(s.features.every(f => f.evidence.source === 'user-plan')).toBe(true); expect(planObjectId('a', 'zone', uuid(1))).not.toBe(planObjectId('b', 'zone', uuid(1))); });
});
describe('pure conversational references and bounded model context', () => {
  it('offers ID candidates without selection, asks ambiguity and can resolve confirmed conversational focus', () => { const p = plan(), s = buildSiteSnapshot({ projectId: 'p', geometryRevision: 1, plan: p }); expect(resolveReferences(s, { name: '展览区' }).status).toBe('ambiguous'); expect(resolveReferences(s, { name: '不存在' }).status).toBe('missing'); const id = planObjectId('p', 'zone', uuid(2)); const focused = buildSiteSnapshot({ projectId: 'p', geometryRevision: 1, plan: p, confirmations: { featureIds: [id] } }); expect(resolveReferences(focused, { kind: 'zone' }).candidates[0]?.reference.id).toBe(id); expect(resolveReferences(focused, { kind: 'zone' }).status).toBe('resolved'); });
  it('refuses stale, hallucinated, cross-project, malformed and duplicate model references', () => { const s = buildSiteSnapshot({ projectId: 'p', geometryRevision: 1, plan: plan() }), ref = { id: s.features[0]!.id, revision: s.revision }; expect(validateModelReferences({ references: [ref] }, buildModelContext(s)).ok).toBe(true); expect(validateModelReferences({ references: [{ ...ref, revision: 'old' }] }, buildModelContext(s)).ok).toBe(false); expect(validateModelReferences({ references: [{ ...ref, id: 'hallucination' }] }, buildModelContext(s)).ok).toBe(false); expect(validateModelReferences({ references: [ref, ref] }, buildModelContext(s)).ok).toBe(false); expect(validateModelReferences({ references: [ref], apply: true }, buildModelContext(s)).ok).toBe(false); const p = plan(); p.facilities[0]!.position.x++; const changed = buildSiteSnapshot({ projectId: 'p', geometryRevision: 1, plan: p }); expect(evidenceHighlights(changed, [ref]).ok).toBe(false); });
  it('bounds context and only emits relation IDs present in model objects; highlights exact source geometry', () => { const s = buildSiteSnapshot({ projectId: 'p', geometryRevision: 1, plan: plan() }); const c = buildModelContext(s, { maxObjects: 3, maxChars: 5000 }); expect(JSON.stringify(c).length).toBeLessThanOrEqual(5000); const ids = new Set(c.objects.map(o => o.reference.id)); expect(c.relations.every(r => ids.has(r.from) && ids.has(r.to))).toBe(true); expect(c.truncated).toBe(true); const ref = { id: s.features[0]!.id, revision: s.revision }; const result = evidenceHighlights(s, [ref]); expect(result.ok).toBe(true); if (result.ok) expect(result.highlights[0]!.geometry).toEqual(s.features[0]!.geometry); });
});
describe('safe bounded network and asynchronous invalidation', () => {
  it('times out abort-aware transport with an honest failure', async () => {
    const r = await loadMapEvidence({ anchor, radiusM: 100, timeoutMs: 3, fetchImpl: async (_url, init) => new Promise<Response>((_resolve, reject) => { init?.signal?.addEventListener('abort', () => reject(new Error('abort')), { once: true }); }) });
    expect(r.status).toBe('failed'); expect(r.warnings.join()).toContain('timed out');
  });
  it('isolates visible scope and rotated footprints without mutating plan', () => {
    const p = plan(); p.facilities[0]!.rotationDeg = 90; p.facilities[0]!.size = { width: 8, depth: 2 };
    const s = buildSiteSnapshot({ projectId: 'p', geometryRevision: 1, plan: p, viewport: { minX: 0, minY: -10, maxX: 10, maxY: 10 } });
    const f = s.features.find(f => f.kind === 'facility')!; expect(Math.max(...f.geometry.points.map(p => p.y)) - Math.min(...f.geometry.points.map(p => p.y))).toBeCloseTo(8);
    expect(resolveReferences(s, { kind: 'zone', visibleOnly: true }).status).toBe('resolved');
    p.facilities[0]!.position.x = 100; expect(Math.max(...f.geometry.points.map(p => p.x))).toBeCloseTo(6);
  });

  it('uses only existing road proxy, correct GCJ conversion and honest partial coverage', async () => { const p = toGeographic({ x: 10, y: 0 }, anchor); const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ roads: [{ id: 'osm:W99', highway: 'footway', name: '路', points: [[anchor.lng, anchor.lat], [p.lng, p.lat]] }] }))); const r = await loadMapEvidence({ anchor, radiusM: 9000, fetchImpl }); expect(fetchImpl.mock.calls).toHaveLength(1); expect(String((fetchImpl.mock.calls[0] as unknown[])[0])).toContain('span=750'); expect(r.status).toBe('partial'); expect(r.features[0]!.id).toBe('osm:way/99'); expect(r.features[0]!.geometry.points[1]!.x).toBeCloseTo(10); expect(r.features[0]!.tags.access).toBeUndefined(); });
  it('validates semantic endpoint schema and never falls back on HTTP failure', async () => { const fetchImpl = vi.fn(async () => new Response('', { status: 503 })); const r = await loadMapEvidence({ anchor, radiusM: 100, semanticEndpoint: '/api/site-context', fetchImpl }); expect(r.status).toBe('failed'); expect(fetchImpl).toHaveBeenCalledTimes(1); await expect(loadMapEvidence({ anchor, radiusM: 100, semanticEndpoint: 'https://arbitrary.example' })).rejects.toThrow(); });
  it('rejects wrong CRS semantic wire and accepts versioned WGS evidence', async () => { const load = (crs: string) => loadMapEvidence({ anchor, radiusM: 100, semanticEndpoint: '/api/site-context', fetchImpl: async () => new Response(JSON.stringify({ schemaVersion: 1, crs, complete: true, elements: [{ type: 'node', id: 1, tags: { entrance: 'main' }, ...osmPoint(0, 0) }] })) }); expect((await load('gcj-02')).status).toBe('failed'); expect((await load('wgs84')).features).toHaveLength(1); });
  it('honors pre-cancel and drops stale result when project/geometry changes even if transport ignores abort', async () => { const aborted = new AbortController(); aborted.abort(); const f = vi.fn(); expect((await loadMapEvidence({ anchor, radiusM: 100, signal: aborted.signal, fetchImpl: f })).status).toBe('cancelled'); expect(f).not.toHaveBeenCalled(); let finish!: (r: Response) => void; const loader = createEvidenceLoader(); const request = loader.load('p:1', { anchor, radiusM: 100, fetchImpl: () => new Promise<Response>(resolve => { finish = resolve; }) }); loader.invalidate('q:2'); finish(new Response('{"roads":[]}')); expect((await request).status).toBe('stale'); });
  it('reports oversized body and malformed legacy roads without creating fake features', async () => { const r = await loadMapEvidence({ anchor, radiusM: 100, fetchImpl: async () => new Response('x'.repeat(2000001)) }); expect(r.status).toBe('failed'); const empty = await loadMapEvidence({ anchor, radiusM: 100, fetchImpl: async () => new Response('{"roads":[]}') }); expect(empty.complete).toBe(false); expect(empty.warnings.join()).toContain('upstream failure'); });
});

describe('independent review regressions (red before fixes)', () => {
  it('rejects evidence aligned to an old anchor and unusable status rather than minting fresh references', () => {
    const evidence = parseOverpassEvidence({ complete: true, elements: [{ type: 'node', id: 99, tags: { entrance: 'main' }, ...osmPoint(0, 0) }] }, anchor, 100);
    expect(evidence.scope?.anchor).toEqual({ lng: anchor.lng, lat: anchor.lat });
    const p = plan(); p.anchor!.lng += 0.01;
    const changed = buildSiteSnapshot({ projectId: 'p', geometryRevision: 2, plan: p, mapEvidence: evidence });
    expect(changed.features.some(f => f.id === 'osm:node/99')).toBe(false); expect(changed.coverage.complete).toBe(false); expect(changed.warnings.join()).toMatch(/anchor|scope|CRS/);
    for (const status of ['stale', 'cancelled', 'failed'] as const) { const s = buildSiteSnapshot({ projectId: 'p', geometryRevision: 3, plan: plan(), mapEvidence: { ...evidence, status } }); expect(s.features.some(f => f.id === 'osm:node/99')).toBe(false); expect(s.coverage.complete).toBe(false); }
    const wrong = buildSiteSnapshot({ projectId: 'p', geometryRevision: 3, plan: plan(), mapEvidence: { ...evidence, scope: { anchor, radiusM: 100, crs: 'wgs84' as 'gcj-02' } } }); expect(wrong.features.some(f => f.id === 'osm:node/99')).toBe(false);
  });
  it('excludes outer ways belonging to unsupported multipolygons with courtyards', () => {
    const r = parseOverpassEvidence({ complete: true, elements: [{ type: 'way', id: 1, tags: { building: 'yes' }, geometry: [...square(0, 0, 20).points, { x: 0, y: 0 }].map(p => osmPoint(p.x, p.y)) }, { type: 'relation', id: 9, tags: { type: 'multipolygon', building: 'yes' }, members: [{ type: 'way', ref: 1, role: 'outer' }, { type: 'way', ref: 2, role: 'inner' }] }] }, anchor, 100);
    expect(r.features.some(f => f.id === 'osm:way/1')).toBe(false); expect(r.complete).toBe(false); expect(r.warnings.length).toBeGreaterThan(0);
  });
  it.each([
    [{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }, { x: 10, y: 0 }],
    [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 10, y: 0 }],
  ])('rejects invalid building rings in both parsers and snapshots', (...points) => {
    const ring = points as {x:number;y:number}[];
    const r = parseOverpassEvidence({ complete: true, elements: [{ type: 'way', id: 1, tags: { building: 'yes' }, geometry: [...ring, ring[0]!].map(p => osmPoint(p.x, p.y)) }] }, anchor, 100);
    expect(r.features).toHaveLength(0); expect(r.complete).toBe(false); expect(r.warnings.length).toBeGreaterThan(0);
    const s = buildSiteSnapshot({ projectId: 'p', geometryRevision: 1, plan: plan(), mapEvidence: { status: 'ready', complete: true, warnings: [], scope: { anchor, radiusM: 100, crs: 'gcj-02' }, features: [map('building', 'osm:way/1', { type: 'polygon', points: ring })] } });
    expect(s.features.some(f => f.id === 'osm:way/1')).toBe(false); expect(s.coverage.complete).toBe(false); expect(s.warnings.length).toBeGreaterThan(0);
  });
  it('respects explicit selected false instead of prioritizing the selected zone', () => {
    const z1 = planObjectId('p', 'zone', uuid(1)), z2 = planObjectId('p', 'zone', uuid(2));
    const s = buildSiteSnapshot({ projectId: 'p', geometryRevision: 1, plan: plan(), selectedIds: [z1] });
    const result = resolveReferences(s, { kind: 'zone', selected: false }); expect(result.status).toBe('resolved'); expect(result.candidates[0]?.reference.id).toBe(z2);
  });
  it('rejects model references to objects omitted from this turn context', () => {
    const s = buildSiteSnapshot({ projectId: 'p', geometryRevision: 1, plan: plan() });
    const context = buildModelContext(s, { maxObjects: 1 }); const ref = { id: planObjectId('p', 'zone', uuid(1)), revision: s.revision };
    expect(context.objects.some(o => o.reference.id === ref.id)).toBe(false);
    // The old API only accepts snapshots: that is the bypass under review.
    expect(validateModelReferences({ references: [ref] }, s as unknown as ReturnType<typeof buildModelContext>).ok).toBe(false);
    expect(validateModelReferences({ references: [ref] }, context).ok).toBe(false);
    expect(validateModelReferences({ references: [context.objects[0]!.reference] }, context).ok).toBe(true);
    const spoof = { ...context, objects: [...context.objects, { ...context.objects[0]!, reference: ref }] };
    expect(validateModelReferences({ references: [ref] }, spoof).ok).toBe(false);
    expect(() => context.objects.push({ ...context.objects[0]!, reference: ref })).toThrow();
    expect(() => context.objects.pop()).toThrow();
    expect(validateModelReferences({ references: [ref] }, context).ok).toBe(false);
  });
});
