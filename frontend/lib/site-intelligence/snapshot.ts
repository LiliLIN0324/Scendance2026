import type { MapFeature, Relation, SiteFeature, SiteSnapshot, SnapshotInput, Geometry } from './types';
import { bounds, boundsIntersect, containsGeometry, geometryDistance, isValidGeometry } from './geometry';
/** Content signature catches geometry mutation even when caller forgets to bump its revision. Not a security digest. */
function signature(value: unknown): string { const text = JSON.stringify(value); let a = 2166136261, b = 5381; for (let i = 0; i < text.length; i++) { a = Math.imul(a ^ text.charCodeAt(i), 16777619); b = Math.imul(b, 33) ^ text.charCodeAt(i); } return `${(a >>> 0).toString(36)}${(b >>> 0).toString(36)}`; }
export function planObjectId(projectId: string, kind: string, id: string): string { return `plan:${encodeURIComponent(projectId)}:${kind}:${id}`; }
function goodGeometry(g: Geometry): boolean { return isValidGeometry(g) && g.points.length >= (g.type === 'polygon' ? 3 : g.type === 'line' ? 2 : 1) && g.points.length <= 256 && g.points.every(p => Number.isFinite(p.x) && Number.isFinite(p.y) && Math.abs(p.x) <= 10000 && Math.abs(p.y) <= 10000); }
export function buildSiteSnapshot(input: SnapshotInput): SiteSnapshot {
  const { plan, projectId } = input;
  if (!projectId.trim()) throw new Error('projectId required');
  const warnings = [...(input.mapEvidence?.warnings ?? [])];
  const raw: (MapFeature & { levelId?: string; widthM?: number })[] = [];
  const add = (kind: MapFeature['kind'], id: string, name: string, geometry: Geometry, extra: { levelId?: string | undefined; widthM?: number | undefined; tags?: Record<string, string> } = {}) => {
    const key = planObjectId(projectId, kind, id);
    const confirmed = input.confirmations?.featureIds?.includes(key) || kind === 'boundary' && input.confirmations?.boundary;
    raw.push({ id: key, kind, name, geometry, tags: extra.tags ?? {}, evidence: { source: 'user-plan', sourceId: id, certainty: confirmed ? 'user-confirmed' : 'unknown', note: confirmed ? 'Confirmed planning intent, not an independent physical survey.' : 'User plan object exists; physical access/authorization not confirmed.' }, ...(extra.levelId ? { levelId: extra.levelId } : {}), ...(extra.widthM ? { widthM: extra.widthM } : {}) });
  };
  if (plan.boundary.length >= 3) add('boundary', 'boundary', '活动场地范围', { type: 'polygon', points: plan.boundary });
  for (const z of plan.zones) add('zone', z.id, z.name, { type: 'polygon', points: z.polygon }, { levelId: z.levelId, tags: { semantic: z.semantic, environment: z.environment ?? 'unknown', ...(z.event ? { event: z.event } : {}) } });
  for (const f of plan.facilities) {
    const angle = f.rotationDeg * Math.PI / 180, c = Math.cos(angle), s = Math.sin(angle);
    const points = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, y]) => { const dx = x! * f.size.width / 2, dy = y! * f.size.depth / 2; return { x: f.position.x + dx * c - dy * s, y: f.position.y + dx * s + dy * c }; });
    add('facility', f.id, f.name, { type: 'polygon', points }, { levelId: f.levelId, tags: { templateId: f.templateId, ...(f.zoneId ? { zoneId: planObjectId(projectId, 'zone', f.zoneId) } : {}) } });
  }
  for (const r of plan.routes) add('route', r.id, r.name, { type: 'line', points: r.points }, { levelId: r.levelId, widthM: r.widthM, tags: { kind: r.kind, ...(r.startNodeId ? { startNodeId: planObjectId(projectId, 'entrance', r.startNodeId) } : {}), ...(r.endNodeId ? { endNodeId: planObjectId(projectId, 'entrance', r.endNodeId) } : {}) } });
  for (const n of plan.nodes) add('entrance', n.id, n.name, { type: 'point', points: [n.position] }, { levelId: n.levelId, tags: { kind: n.kind } });
  for (const w of plan.workers) add('worker', w.id, w.role, { type: 'point', points: [w.position] }, { levelId: w.levelId, tags: { count: String(w.count), ...(w.zoneId ? { zoneId: planObjectId(projectId, 'zone', w.zoneId) } : {}) } });
  const evidence = input.mapEvidence, scope = evidence ? evidence.scope : input.mapScope;
  const usableStatus = !evidence || evidence.status === 'ready' || evidence.status === 'partial';
  const aligned = Boolean(plan.anchor && plan.anchor.crs === 'gcj-02' && scope?.crs === 'gcj-02' && scope.anchor && Number.isFinite(scope.anchor.lng) && Number.isFinite(scope.anchor.lat) && Number.isFinite(scope.radiusM) && scope.radiusM >= 1 && scope.radiusM <= 750 && Math.abs(scope.anchor.lng - plan.anchor.lng) <= 1e-9 && Math.abs(scope.anchor.lat - plan.anchor.lat) <= 1e-9);
  const mapAccepted = usableStatus && aligned;
  if (mapAccepted) raw.push(...(evidence?.features ?? input.mapFeatures ?? []));
  else if (evidence || input.mapFeatures?.length) warnings.push('Map evidence rejected: unusable status or missing/mismatched anchor, scope or CRS. Reload for current plan anchor.');
  if (!plan.anchor) warnings.push('No plan anchor: base-map features excluded; plan-local geometry cannot be geographically aligned.');
  const defaultLevelId = plan.levels?.[0]?.id;
  const selected = new Set(input.selectedIds ?? []);
  const active = raw.filter(f => !input.activeLevelId || !f.levelId && !defaultLevelId || (f.levelId ?? defaultLevelId) === input.activeLevelId || f.evidence.source !== 'user-plan' || f.kind === 'boundary');
  // Prioritize explicit conversational/selection focus, then plan and safety evidence, with truthful truncation.
  active.sort((a, b) => Number(selected.has(b.id)) - Number(selected.has(a.id)) || Number(input.confirmations?.featureIds?.includes(b.id) ?? false) - Number(input.confirmations?.featureIds?.includes(a.id) ?? false));
  const features: SiteFeature[] = []; const seen = new Set<string>(); let vertices = 0, omitted = raw.length - active.length;
  for (const f of active) {
    if (seen.has(f.id)) { warnings.push(`Duplicate object id omitted: ${f.id}`); omitted++; continue; }
    if (!goodGeometry(f.geometry) || features.length >= 240 || vertices + f.geometry.points.length > 6000) { omitted++; continue; }
    const geometry = { type: f.geometry.type, points: f.geometry.points.map(p => ({ ...p })) };
    vertices += geometry.points.length; seen.add(f.id);
    const copy: SiteFeature = { ...f, geometry, evidence: { ...f.evidence }, tags: { ...f.tags }, ...(f.nodeIds ? { nodeIds: [...f.nodeIds] } : {}), selected: selected.has(f.id), visible: !input.viewport || boundsIntersect(bounds(geometry), input.viewport), highlight: { layer: f.evidence.source === 'user-plan' ? 'plan' : 'map', sourceId: f.evidence.sourceId, geometry } };
    features.push(copy);
  }
  const relations: Relation[] = []; let cost = 0, relationOmitted = false;
  const push = (type: Relation['type'], a: SiteFeature, b: SiteFeature, note: string, certainty: Relation['certainty'] = 'inferred') => {
    if (relations.length >= 1200) { relationOmitted = true; return; }
    relations.push({ type, from: a.id, to: b.id, certainty, evidenceIds: [a.id, b.id], note });
  };
  for (let i = 0; i < features.length; i++) for (let j = i + 1; j < features.length; j++) {
    const a = features[i]!, b = features[j]!;
    const ab = bounds(a.geometry), bb = bounds(b.geometry);
    // Broad phase includes route widths and entrance clearance.
    const radius = Math.max(3, (a.widthM ?? 0) / 2, (b.widthM ?? 0) / 2);
    if (!boundsIntersect({ minX: ab.minX - radius, minY: ab.minY - radius, maxX: ab.maxX + radius, maxY: ab.maxY + radius }, bb)) continue;
    cost += a.geometry.points.length * b.geometry.points.length;
    if (cost > 2000000) { relationOmitted = true; continue; }
    const distance = geometryDistance(a.geometry, b.geometry);
    if (containsGeometry(a.geometry, b.geometry)) push('contains', a, b, 'Geometrically contained; this does not confer permission or assign zone membership.');
    if (containsGeometry(b.geometry, a.geometry)) push('contains', b, a, 'Geometrically contained; this does not confer permission or assign zone membership.');
    if (distance < 1e-7) push('overlaps', a, b, '2D footprint intersection/touch; indoor/elevation separation may require confirmation.');
    else if (distance <= 3) push('adjacent', a, b, `Nearest geometry distance ${distance.toFixed(2)}m; not proof of a traversable path.`);
    const entrance = a.kind === 'entrance' ? a : b.kind === 'entrance' ? b : undefined;
    const other = entrance === a ? b : a;
    if (entrance && other.kind === 'facility' && distance <= 1.5) push('entrance-blocked', other, entrance, 'Facility occupies or lies within 1.5m of entrance. Clearance is a planning warning, not a certified egress rule.');
    const barrier = a.kind === 'barrier' ? a : b.kind === 'barrier' ? b : undefined;
    const obstacle = barrier === a ? b : a;
    if (barrier && ['facility', 'route', 'entrance'].includes(obstacle.kind) && distance <= (obstacle.widthM ?? 0) / 2 + 0.1) push('barrier-conflict', obstacle, barrier, 'Plan intersects mapped barrier; gate access and physical feasibility require verification.');
    const route = a.kind === 'route' ? a : b.kind === 'route' ? b : undefined;
    const occupying = route === a ? b : a;
    if (route && ['facility', 'building'].includes(occupying.kind) && distance <= (route.widthM ?? 0) / 2) push('route-blocked', occupying, route, route.widthM ? 'Footprint intersects planned route corridor.' : 'Footprint crosses route centreline; corridor width unknown.');
    const network = (f: SiteFeature) => ['road', 'route', 'entrance'].includes(f.kind);
    if (network(a) && network(b) && distance <= 1) {
      const sharedNode = a.nodeIds?.some(id => b.nodeIds?.includes(id));
      const planLink = a.tags.startNodeId === b.id || a.tags.endNodeId === b.id || b.tags.startNodeId === a.id || b.tags.endNodeId === a.id;
      const incompatible = a.tags.layer !== b.tags.layer || a.tags.level !== b.tags.level || a.tags.bridge === 'yes' || b.tags.bridge === 'yes' || a.tags.tunnel === 'yes' || b.tags.tunnel === 'yes';
      const restricted = [a, b].some(f => ['no', 'private'].includes(f.tags.access ?? '') || f.tags.foot === 'no');
      if (!incompatible && !restricted && (sharedNode || planLink)) push('connected', a, b, 'Shared mapped topology or explicit plan endpoint reference. Physical access is still not verified.', sharedNode ? 'mapped' : 'inferred');
      else push('connection-candidate', a, b, 'Proximity only or uncertain/restricted/grade-separated access; do not treat as traversable.');
    }
  }
  if (omitted) warnings.push(`${omitted} objects outside active plan layer, invalid, duplicated or over context limits; coverage incomplete.`);
  if (relationOmitted) warnings.push('Spatial relation budget exhausted; unreported conflicts cannot be treated as safe.');
  const unknowns = ['Event-use authorization is not implied by map footprints.', 'Indoor doors, passageways and elevation are unknown unless mapped or user-confirmed.', 'Missing map objects/access tags do not prove absence or public access.'];
  if (!input.confirmations?.boundary) unknowns.push('Activity boundary requires user confirmation; a POI/building outline is not authorization.');
  if (plan.routes.some(r => r.widthM === undefined)) unknowns.push('Some planned routes have unknown width.');
  const revision = `${encodeURIComponent(projectId)}:${input.geometryRevision}:${signature({ anchor: plan.anchor, raw, activeLevelId: input.activeLevelId, confirmations: input.confirmations })}`;
  return { schemaVersion: 1, projectId, geometryRevision: String(input.geometryRevision), revision, crs: 'local-enu-gcj02', anchor: plan.anchor ? { ...plan.anchor } : undefined, features, relations, warnings, truncated: omitted > 0 || relationOmitted, confirmedIds: features.filter(f => f.evidence.certainty === 'user-confirmed').map(f => f.id), coverage: { ...(mapAccepted && scope ? { scope } : {}), ...(input.mapEvidence?.fetchedAt ? { fetchedAt: input.mapEvidence.fetchedAt } : {}), mapStatus: !mapAccepted && (evidence || input.mapFeatures?.length) ? 'failed' : evidence?.status ?? (input.mapFeatures ? 'partial' : 'not-loaded'), complete: mapAccepted && Boolean(evidence?.complete) && omitted === 0 && !relationOmitted, unknowns } };
}
