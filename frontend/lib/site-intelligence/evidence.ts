import { toLocal, isValidGeometry } from './geometry';
import type { MapEvidenceResult, MapFeature } from './types';
const MAX_FEATURES = 300, MAX_POINTS = 256;
const TAGS = ['name', 'building', 'highway', 'leisure', 'landuse', 'place', 'entrance', 'access', 'foot', 'vehicle', 'barrier', 'layer', 'level', 'bridge', 'tunnel', 'indoor', 'area'];
const record = (v: unknown): Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
export function boundedRadius(radiusM: number): number { if (!Number.isFinite(radiusM) || radiusM < 1) throw new Error('Invalid radius'); return Math.min(750, Math.max(50, radiusM)); }
function inRange(feature: MapFeature, radius: number): boolean {
  // Bbox inclusion permits a road crossing the area with both endpoints outside.
  const xs = feature.geometry.points.map(p => p.x), ys = feature.geometry.points.map(p => p.y);
  return Math.min(...xs) <= radius && Math.max(...xs) >= -radius && Math.min(...ys) <= radius && Math.max(...ys) >= -radius;
}
/** Pure backend adapter. Raw Overpass is WGS84, never GCJ02. Relations are not filled as guessed polygons. */
export function parseOverpassEvidence(body: unknown, anchor: { lng: number; lat: number }, radiusM: number): MapEvidenceResult {
  const radius = boundedRadius(radiusM), root = record(body), features: MapFeature[] = [], warnings: string[] = [];
  if (!Array.isArray(root.elements)) return { status: 'failed', features, warnings: ['Malformed map payload'], complete: false };
  let omitted = 0;
  const ids = new Set<string>();
  const unsupportedMembers = new Set<number>(); let unknownAreaMembership = root.elements.length > 2000;
  // Never emit a multipolygon outer as a solid standalone building: it could contain courtyards.
  for (const raw of root.elements.slice(0, 2000)) {
    const rel = record(raw); if (rel.type !== 'relation') continue;
    const tags = record(rel.tags);
    if (Array.isArray(rel.members) && rel.members.length > 2000) unknownAreaMembership = true;
    if (Array.isArray(rel.members)) for (const member of rel.members.slice(0, 2000)) { const m = record(member); if (m.type === 'way' && Number.isSafeInteger(m.ref)) unsupportedMembers.add(Number(m.ref)); }
    else if (tags.type === 'multipolygon' || tags.building || tags.landuse || tags.leisure) unknownAreaMembership = true;
  }
  for (const raw of root.elements.slice(0, 2000)) {
    const el = record(raw), rawTags = record(el.tags), tags: Record<string, string> = {};
    for (const key of TAGS) if (typeof rawTags[key] === 'string') tags[key] = (rawTags[key] as string).slice(0, 200);
    if (el.type === 'relation') { omitted++; continue; }
    if ((el.type !== 'node' && el.type !== 'way') || !Number.isSafeInteger(el.id) || Number(el.id) <= 0) { omitted++; continue; }
    const id = `osm:${el.type}/${el.id}`;
    if (ids.has(id)) continue;
    let kind: MapFeature['kind'] | undefined;
    if (tags.entrance && tags.entrance !== 'no') kind = 'entrance';
    else if (tags.barrier && tags.barrier !== 'no') kind = 'barrier';
    else if (tags.building && tags.building !== 'no') kind = 'building';
    else if (tags.highway) kind = tags.area === 'yes' ? 'open-space' : 'road';
    else if (tags.leisure === 'park' || tags.leisure === 'garden' || tags.landuse === 'grass' || tags.place === 'square') kind = 'open-space';
    if (!kind) continue;
    const rawPoints = el.type === 'node' ? [{ lon: el.lon, lat: el.lat }] : el.geometry;
    if (!Array.isArray(rawPoints) || rawPoints.length > MAX_POINTS) { omitted++; continue; }
    try {
      const points = rawPoints.map(p => { const v = record(p); if (typeof v.lon !== 'number' || typeof v.lat !== 'number') throw new Error('Missing coordinate'); return toLocal(v.lon, v.lat, anchor, 'wgs84'); });
      const closed = points.length >= 4 && Math.hypot(points[0]!.x - points[points.length - 1]!.x, points[0]!.y - points[points.length - 1]!.y) < 0.01;
      const polygon = kind === 'building' || kind === 'open-space';
      if (polygon && (unsupportedMembers.has(Number(el.id)) || unknownAreaMembership)) { omitted++; continue; }
      if (polygon && !closed || points.length < (el.type === 'node' ? 1 : 2)) { omitted++; continue; }
      if (closed && polygon) points.pop();
      const feature: MapFeature = { id, kind, name: tags.name ?? '', geometry: { type: el.type === 'node' ? 'point' : polygon ? 'polygon' : 'line', points }, tags, evidence: { source: 'osm', sourceId: id, certainty: 'mapped', note: 'Mapped OSM geometry; not surveyed or event-use authorization. Access and indoor paths are unknown unless explicitly evidenced.' } };
      if (!isValidGeometry(feature.geometry)) { omitted++; continue; }
      if (Array.isArray(el.nodes) && el.nodes.length === rawPoints.length && el.nodes.every(n => Number.isSafeInteger(n) && Number(n) > 0)) feature.nodeIds = el.nodes.map(n => `osm:node/${n}`);
      if (el.type === 'node') feature.nodeIds = [id];
      if (!inRange(feature, radius)) continue;
      if (features.length >= MAX_FEATURES) { omitted++; continue; }
      features.push(feature); ids.add(id);
    } catch { omitted++; }
  }
  if (omitted || root.elements.length > 2000) warnings.push('Map geometry omitted: unsupported relations, invalid/oversized features or feature limit; coverage incomplete.');
  if (root.remark) warnings.push('Map service reported incomplete/query-limited data.');
  const complete = root.complete === true && !omitted && root.elements.length <= 2000 && !root.remark;
  if (!complete) warnings.push('Map coverage is not verified complete; missing entrances/buildings/access remain unknown.');
  return { status: complete ? 'ready' : 'partial', features, warnings, complete, scope: { anchor: { lng: anchor.lng, lat: anchor.lat }, radiusM: radius, crs: 'gcj-02' } };
}
export interface LoadMapOptions { anchor: { lng: number; lat: number }; radiusM: number; signal?: AbortSignal; fetchImpl?: typeof fetch; semanticEndpoint?: string; timeoutMs?: number }
/** Only same-origin sanctioned services; no direct Overpass calls or fallback mirror probing. */
export async function loadMapEvidence(options: LoadMapOptions): Promise<MapEvidenceResult> {
  const { anchor } = options; const radius = boundedRadius(options.radiusM);
  toLocal(anchor.lng, anchor.lat, anchor, 'gcj-02');
  if (options.semanticEndpoint && !/^\/api\/[a-z0-9-]+$/.test(options.semanticEndpoint)) throw new Error('Expected explicitly configured same-origin API endpoint');
  const controller = new AbortController();
  const cancel = () => controller.abort();
  options.signal?.addEventListener('abort', cancel, { once: true });
  if (options.signal?.aborted) controller.abort();
  const timer = setTimeout(cancel, Math.min(30000, Math.max(1, options.timeoutMs ?? 15000)));
  try {
    if (controller.signal.aborted) throw new Error('Aborted');
    const semantic = Boolean(options.semanticEndpoint);
    const params = new URLSearchParams({ lng: String(anchor.lng), lat: String(anchor.lat), ...(semantic ? { radius: String(radius) } : { span: String(radius) }) });
    const response = await (options.fetchImpl ?? fetch)(`${options.semanticEndpoint ?? '/api/road-network'}?${params}`, { signal: controller.signal });
    if (controller.signal.aborted) throw new Error('Aborted');
    if (!response.ok) return { status: 'failed', features: [], complete: false, warnings: [`Map service HTTP ${response.status}; no alternate endpoint attempted.`] };
    // Bound bytes before parsing to prevent unexpectedly enormous responses.
    const reader = response.body?.getReader(); let text = '';
    if (!reader) throw new Error('Missing response body');
    const decoder = new TextDecoder(); let bytes = 0;
    try { while (true) { const chunk = await reader.read(); if (chunk.done) break; bytes += chunk.value.byteLength; if (bytes > 2000000 || controller.signal.aborted) { await reader.cancel(); throw new Error('Map response limit or abort'); } text += decoder.decode(chunk.value, { stream: true }); } text += decoder.decode(); } finally { reader.releaseLock(); }
    if (controller.signal.aborted) throw new Error('Aborted');
    const payload: unknown = JSON.parse(text), root = record(payload);
    if (semantic) {
      if (root.schemaVersion !== 1 || root.crs !== 'wgs84') throw new Error('Unsupported semantic response schema/CRS');
      const result = parseOverpassEvidence(payload, anchor, radius);
      if (Array.isArray(root.warnings) && root.warnings.length) { result.warnings.push(...root.warnings.filter((s): s is string => typeof s === 'string').slice(0, 10).map(s => s.slice(0, 300))); result.complete = false; result.status = 'partial'; }
      const fetchedAt = new Date().toISOString(); result.fetchedAt = fetchedAt; result.scope = { anchor: { ...anchor }, radiusM: radius, crs: 'gcj-02' }; for (const f of result.features) f.evidence.observedAt = fetchedAt;
      return result;
    }
    const features: MapFeature[] = [];
    if (!Array.isArray(root.roads)) throw new Error('Malformed legacy road payload');
    for (const raw of root.roads.slice(0, MAX_FEATURES)) {
      const road = record(raw);
      if (typeof road.id !== 'string' || !/^osm:W[1-9][0-9]*$/.test(road.id) || !Array.isArray(road.points) || road.points.length < 2 || road.points.length > MAX_POINTS) continue;
      try {
        const points = road.points.map(p => { if (!Array.isArray(p) || typeof p[0] !== 'number' || typeof p[1] !== 'number') throw new Error('Invalid road coordinate'); return toLocal(p[0], p[1], anchor, 'gcj-02'); });
        const id = `osm:way/${road.id.slice(5)}`;
        const f: MapFeature = { id, kind: 'road', name: typeof road.name === 'string' ? road.name.slice(0, 200) : '', geometry: { type: 'line', points }, tags: { highway: typeof road.highway === 'string' ? road.highway.slice(0, 60) : '' }, evidence: { source: 'legacy-road-proxy', sourceId: road.id, certainty: 'mapped', note: 'Legacy proxy supplies GCJ02 road geometry only; access/layer/connectivity unavailable.' } };
        if (inRange(f, radius) && !features.some(v => v.id === id)) features.push(f);
      } catch { /* malformed road is not converted into guessed geometry */ }
    }
    const fetchedAt = new Date().toISOString(); for (const f of features) f.evidence.observedAt = fetchedAt;
    return { status: 'partial', features, complete: false, fetchedAt, scope: { anchor: { ...anchor }, radiusM: radius, crs: 'gcj-02' }, warnings: ['Only legacy road geometry available. Buildings/open spaces/real entrances/barriers/access and indoor paths remain unknown; semantic backend not connected.', ...(features.length ? [] : ['No usable roads returned; empty legacy response cannot distinguish no coverage from upstream failure.'])] };
  } catch (error) {
    return { status: options.signal?.aborted ? 'cancelled' : 'failed', features: [], complete: false, warnings: [controller.signal.aborted ? 'Map request aborted or timed out.' : `Map evidence unavailable: ${error instanceof Error ? error.message : 'unknown error'}`] };
  } finally { clearTimeout(timer); options.signal?.removeEventListener('abort', cancel); }
}
/** Local request guard only; does not modify global task scheduler. */
export function createEvidenceLoader() {
  let generation = 0, controller: AbortController | undefined, key = '';
  return {
    cancel() { generation++; controller?.abort(); },
    invalidate(nextKey: string) { key = nextKey; generation++; controller?.abort(); },
    async load(snapshotKey: string, options: LoadMapOptions): Promise<MapEvidenceResult> {
      controller?.abort(); controller = new AbortController(); key = snapshotKey; const current = ++generation;
      const local = controller; const cancel = () => local.abort(); options.signal?.addEventListener('abort', cancel, { once: true }); if (options.signal?.aborted) local.abort();
      try { const result = await loadMapEvidence({ ...options, signal: local.signal }); if (current !== generation || key !== snapshotKey) return { status: 'stale', features: [], warnings: ['Discarded stale project/geometry/request response.'], complete: false }; return result; }
      finally { options.signal?.removeEventListener('abort', cancel); }
    },
  };
}
