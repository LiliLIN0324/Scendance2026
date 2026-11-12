# Site intelligence integration contract (implemented module; Chat/backend integration owned by main lane)

Owned directory only; no plan writes, model calls, proxy changes or external requests outside existing road service.

Public exports from `index.ts`:
- `buildSiteSnapshot({projectId, geometryRevision, plan, mapFeatures?, mapScope?, mapEvidence?, selectedIds?, viewport?, activeLevelId?, confirmations?})`: same ENU metres as SitePlanData, evidence/provenance and explicit unknowns, stable namespaced IDs, versioned refs and bounded spatial relations.
- `loadMapEvidence({anchor, radiusM, signal?, fetchImpl?, semanticEndpoint?})`: bounded, cancellable existing `/api/road-network` fallback. Legacy roads are GCJ-02; access/entrances/buildings remain unknown. Optional semantic endpoint must be same-origin and explicitly supplied only when available. Never fetch Overpass directly or try mirrors.
- `parseOverpassEvidence(body, anchor, radiusM)` pure WGS84 adapter for a sanctioned future backend; never equates an OSM building/POI footprint with authorized event boundary.
- `resolveReferences(snapshot, query)` candidate resolver, NOT an LLM. Ambiguous/missing never auto-select.
- `buildModelContext(snapshot, limits?)`, `validateModelReferences(input, issuedContext)` schema-checked IDs/revisions, `evidenceHighlights(snapshot, refs)` exact geometry for UI.
- `createEvidenceLoader()` owns AbortController, geometry version and request generation: cancel/project/snapshot change discards stale responses.

Required missing backend contract: GET `/api/site-context?lng=<GCJ>&lat=<GCJ>&radius=<metres max 750>` → `{schemaVersion:1, crs:"wgs84", elements:[OSM out geom node/way with stable type/id, tags incl building/highway/leisure/landuse/entrance/access/barrier/layer/bridge/tunnel, geometry or lon/lat, optional nodes], complete:boolean, warnings:string[]}`. Must convert GCJ bbox to WGS84 server-side, enforce bounded radius/count/bytes, timeout/no-store/abort, reuse existing safe proxy. No endpoint implemented by this module; absent endpoint is partial data, never invented map understanding. Relations/multipolygons unsupported by adapter are reported, not approximated.

Main integrator owns Chat/model, semantic-endpoint backend, preview/confirmation/apply/undo and actual UI highlights. No base-map image is read by this module. Indoor paths not evidenced remain unknown. Geometry relations are planning warnings, not evacuation/access certification.

## Integration sequence

```ts
import { buildSiteSnapshot, createEvidenceLoader, buildModelContext,
  resolveReferences, validateModelReferences, validateSnapshotReferences, evidenceHighlights } from './site-intelligence';
const loader = createEvidenceLoader();
// On project/anchor/geometry change or task cancellation:
loader.invalidate(`${projectId}:${geometryRevision}`);
const mapEvidence = await loader.load(`${projectId}:${geometryRevision}`, {
  anchor: plan.anchor!, radiusM: 350,
  // semanticEndpoint: '/api/site-context' // ONLY after endpoint deployed/capability confirmed
});
if (mapEvidence.status === 'stale' || mapEvidence.status === 'cancelled') return;
const snapshot = buildSiteSnapshot({ projectId, geometryRevision, plan, mapEvidence,
  confirmations: { boundary: userConfirmedBoundary, featureIds: confirmedObjectIds } });
const context = buildModelContext(snapshot); // IDs, exact <=32-point geometries/bounds, relations, uncertainty
// A model supplies a structured ReferenceQuery; no forced canvas selection is necessary.
const candidates = resolveReferences(snapshot, { kind: 'zone', name: '展览区' });
// Ambiguous/missing -> ask using candidate names/IDs, never pick first/nearest silently.
const checked = validateModelReferences(modelOutput, context); // modelOutput = { references: [{id,revision}] }
// Before proposal apply: rebuild current snapshot and validate again, plus main task epoch/confirmation gates.
const current = buildSiteSnapshot({ projectId, geometryRevision: currentGeometryRevision, plan: currentPlan, mapEvidence });
const fresh = checked.ok ? validateSnapshotReferences({ references: checked.references }, current) : undefined;
const highlights = fresh?.ok ? evidenceHighlights(current, fresh.references) : undefined;
```

Stable plan IDs are `planObjectId(projectId, kind, sourceId)`; map IDs are `osm:node/<id>` or `osm:way/<id>`. `selectedIds` and confirmation IDs use these full IDs (never labels). `highlight.sourceId` maps back to actual Plan UUID or legacy proxy source ID. A revision includes project, supplied geometry revision and content signature; even same-version geometry edits invalidate references. Snapshot is copied from mutable plan objects. The content signature is a stale-state guard, NOT a cryptographic signature. Geometry/version guards never replace user confirmation.

`coverage.complete` means bounded query coverage, NOT survey accuracy/access permission. `status=partial` is the normal legacy path. Preserve warnings/unknowns in Chat; do not say the map is understood or entrance-free. `environment` from the shared zone schema is surfaced as a tag, defaulting to unknown. Evidence retrieval time is not survey/update time. 2D overlap may require indoor/elevation confirmation rather than automatic rejection.

Limits: radius 50–750m; timeout 15s default/30s max; 2MB response; 300 fetched features/256 vertices per feature; 240 snapshot features/6000 total vertices; bounded relation work and 1200 relations; 60 model objects/80 relations/24k chars default. Truncation is explicit. Unsupported OSM multipolygons are omitted with incomplete-coverage warnings, never filled-in guessed footprints. No external fetches or live map claims were made in tests.

Test/typecheck (working directory `frontend`):
```
./node_modules/.bin/vitest run lib/site-intelligence/site-intelligence.test.ts
./node_modules/.bin/tsc --noEmit --incremental false --pretty false
```

Read audit: docs/43 and docs/45; `functions/api/road-network.ts` only returns id/highway/name/GCJ02 points; existing client does not carry topology/access/buildings. Existing ENU export uses cos(anchorLat)*111319.49 and north 111132.92; this module reuses those exact constants and the existing GCJ converter. Public reference checked: https://github.com/tyrasd/overpass-turbo/issues/440 and https://github.com/drolbr/overpass-blog/blob/master/loop_and_group.html (`out geom`, node/way/relation distinctions).

Validation: 18 production-function tests passing. Full frontend tsc run is a separate shared-worktree gate; main lane may be changing unrelated files concurrently. No commit/push/checkout/merge/tag performed.

## Review fix batch — breaking reference-validation contract

The independent review found 1 high / 4 medium issues; the former 18 tests did not cover them. Six regressions were first run RED (6 failed / 18 passed), then fixed (24 passed). This is a targeted fix batch, not a clean independent-review or end-to-end claim.

1. **Map frame gate**: `parseOverpassEvidence` now retains `scope` with GCJ02 anchor and radius. `buildSiteSnapshot` rejects evidence unless status is ready/partial, scope CRS/radius are valid, and scope anchor equals current plan anchor (1e-9 degree tolerance); rejected data gets no geometry, incomplete coverage and warnings. It does not relabel/reproject old ENU data. Bare `mapFeatures` also require matching `mapScope`. Reload on anchor change. No evidence from stale/cancelled/failed payloads can be reissued under a fresh snapshot revision.
2. **Courtyards**: unsupported relation members are indexed before feature parsing, and their area ways are excluded even if independently tagged building=yes. Missing/oversized member coverage conservatively excludes area features rather than filling courtyards. Multipolygons remain unsupported and partial.
3. **Polygon validity**: parser AND snapshot validate simple nondegenerate rings: finite coordinates, nonzero area, no duplicate vertices/zero-length/backtracking edges or nonadjacent edge intersections. Invalid footprints are omitted with incomplete-coverage warnings.
4. **Explicit booleans**: selected:false and confirmed:false are actual filters, not missing values; generic focus narrowing only occurs when these constraints are undefined.
5. **Issued-context gate**: `validateModelReferences(input, context)` now REQUIRES the exact live object returned by `buildModelContext` for the current turn. A private WeakMap binds the final emitted IDs and revision; the issued independent copy is deeply frozen so callers cannot trim or rewrite it after issuance; snapshots, forged/cloned contexts, caller-supplied allowlists and context mutation cannot extend that set. Do not pass snapshot to this function. Keep the issued object while sending its JSON to the model. Do not trim/rewrite its object IDs/revisions after issuance. Set maxObjects/maxRelations/maxChars in buildModelContext itself. A JSON-deserialized context is deliberately unissued. Build a new context per turn.

**Main integrator must change outdoor-map-context.ts:** retain the issued context rather than only snapshot; validate raw returned ID/revision references against that exact context first, then call new `validateSnapshotReferences({references: checked.references}, rebuiltCurrentSnapshot)` before highlight/apply. Do NOT reconstruct model revisions from current snapshot (that launders stale refs); preserve the original issued revisions. The adapter currently does further object trimming/ID+version transformation: remove that transformation or send the issued context unchanged with module limits. If extra fields are needed outside the model context, keep them separately; never silently validate a larger set than actually sent.

`validateSnapshotReferences` is ONLY a second current-state freshness/membership gate for already context-validated references. `evidenceHighlights` likewise checks current geometry but is not a substitute for turn visibility validation or confirmation. Existing caller passing snapshot into validateModelReferences should fail TypeScript until migrated.


## Main-lane integration checkpoint (2026-11-13)

The handoff's formerly missing endpoint is now implemented in `functions/api/site-context.ts`; production readiness still depends on deployment and live source availability. `outdoor-map-context.ts` explicitly enables `/api/site-context`, retains each exact issued context, sends its JSON unchanged, and validates raw returned IDs/revisions before a second current-snapshot check on apply. It never repairs a model revision to the current one. `compact:true` is an optional bounded serialization mode selected at issuance (not caller-side trimming); truncation stays explicit and both map and plan layers are represented when the budget permits. Existing defaults and all 24 module regressions are retained.

The initial 18-test and missing-endpoint notes above describe the author handoff, not final integration status. Final main-lane checks: 18 focused suites / 210 passing tests, including this module's 24; targeted real AgentProvider 13 passing / 412 not run; frontend local tsc and isolated Next build pass. Neither real-model interpretation nor public-map/UI acceptance has been claimed by these tests.
