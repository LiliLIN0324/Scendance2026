import type { SitePlanData } from '../../../supabase/functions/_shared/site-plan';
export type Point = { x: number; y: number };
export type Geometry = { type: 'point' | 'line' | 'polygon'; points: Point[] };
export type Bounds = { minX: number; minY: number; maxX: number; maxY: number };
export type FeatureKind = 'building' | 'road' | 'open-space' | 'entrance' | 'barrier' | 'boundary' | 'zone' | 'facility' | 'route' | 'worker';
export type Certainty = 'mapped' | 'user-confirmed' | 'inferred' | 'unknown';
export interface Evidence { source: 'osm' | 'legacy-road-proxy' | 'user-plan'; sourceId: string; certainty: Certainty; note: string; observedAt?: string }
export interface MapFeature { id: string; kind: FeatureKind; name: string; geometry: Geometry; evidence: Evidence; tags: Record<string, string>; nodeIds?: string[] }
export interface SiteFeature extends MapFeature { visible: boolean; selected: boolean; levelId?: string; widthM?: number; highlight: { layer: 'map' | 'plan'; sourceId: string; geometry: Geometry } }
export interface Relation { type: 'contains' | 'overlaps' | 'adjacent' | 'connected' | 'connection-candidate' | 'entrance-blocked' | 'barrier-conflict' | 'route-blocked'; from: string; to: string; certainty: Certainty; evidenceIds: string[]; note: string; observedAt?: string }
export interface SiteSnapshot { schemaVersion: 1; projectId: string; geometryRevision: string; revision: string; crs: 'local-enu-gcj02'; anchor: SitePlanData['anchor']; features: SiteFeature[]; relations: Relation[]; warnings: string[]; truncated: boolean; coverage: { mapStatus: MapEvidenceResult['status'] | 'not-loaded'; complete: boolean; unknowns: string[]; scope?: MapEvidenceResult['scope']; fetchedAt?: string }; confirmedIds: string[] }
export interface SnapshotInput { projectId: string; geometryRevision: string | number; plan: SitePlanData; mapFeatures?: MapFeature[]; mapScope?: MapEvidenceResult['scope']; mapEvidence?: MapEvidenceResult; selectedIds?: string[]; viewport?: Bounds; activeLevelId?: string; confirmations?: { boundary?: boolean; featureIds?: string[] } }
export interface MapEvidenceResult { status: 'ready' | 'partial' | 'failed' | 'cancelled' | 'stale'; features: MapFeature[]; warnings: string[]; complete: boolean; fetchedAt?: string; scope?: { anchor: { lng: number; lat: number }; radiusM: number; crs: 'gcj-02' } }
export interface ObjectReference { id: string; revision: string }
