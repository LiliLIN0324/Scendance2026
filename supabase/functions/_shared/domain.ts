import { z } from 'zod';
import { structuralViolations } from './structural-geometry.ts';
import presetManifest from './preset-manifest.json' with { type: 'json' };

export const presetKeys = ['gym', 'popup', 'bar', 'cafe', 'conference', 'lawn', 'market', 'museum', 'office', 'studio'] as const;
export { presetManifest };

export class ApiError extends Error {
  constructor(public code: string, public status = 400, public details?: unknown) {
    super(code);
  }
}

export const uuid = z.uuid();
export const sizeSchema = z.strictObject({
  width: z.number().positive().max(200),
  depth: z.number().positive().max(200),
  height: z.number().positive().max(30),
});
export const pointSchema = z.strictObject({ x: z.number().min(-200).max(400), z: z.number().min(-200).max(400) });
export const colorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/).transform(s => s.toLowerCase());
export const materialIds = ['chair', 'table', 'reception', 'backdrop', 'display', 'partition', 'carpet', 'decoration'] as const;
export const catalog = [
  { id: 'chair', name: '椅子', size: { width: 0.5, depth: 0.5, height: 0.85 } },
  { id: 'table', name: '桌子', size: { width: 1.2, depth: 0.6, height: 0.75 } },
  { id: 'reception', name: '签到台', size: { width: 1.8, depth: 0.6, height: 1 } },
  { id: 'backdrop', name: '背景板', size: { width: 3, depth: 0.15, height: 2.4 } },
  { id: 'display', name: '展架', size: { width: 0.8, depth: 0.4, height: 1.8 } },
  { id: 'partition', name: '隔断', size: { width: 1.2, depth: 0.1, height: 1.8 } },
  { id: 'carpet', name: '地毯', size: { width: 2, depth: 3, height: 0.01 } },
  { id: 'decoration', name: '装饰道具', size: { width: 0.4, depth: 0.4, height: 0.6 } },
] as const;
export const objectSchema = z.strictObject({
  id: uuid,
  materialId: z.enum([...materialIds, 'asset']),
  assetId: uuid.optional(),
  presetNode: z.number().int().nonnegative().max(499).optional(),
  position: pointSchema,
  rotation: z.number().min(-360).max(360),
  size: sizeSchema,
  color: colorSchema,
  locked: z.boolean(),
  notes: z.string().max(500).default(''),
  elevation: z.number().min(-100).max(30).optional(),
  wallId: uuid.optional(),
}).superRefine((o, ctx) => {
  const references = Number(!!o.assetId) + Number(o.presetNode !== undefined);
  if (references !== (o.materialId === 'asset' ? 1 : 0)) ctx.addIssue({ code: 'custom', message: '资产物料必须且只能携带一个 assetId 或已知预设节点' });
  if ((o.elevation ?? 0) < 0 && o.presetNode === undefined) ctx.addIssue({ code: 'custom', message: '普通物件高度不能低于地面' });
});
export const venueSchema = z.strictObject({
  ...sizeSchema.shape,
  shape: z.enum(['rectangle', 'polygon']),
  polygon: z.array(pointSchema).min(3).max(32).optional(),
  entrances: z.array(z.strictObject({ id: uuid, position: pointSchema, width: z.number().positive().max(10) })).max(12),
  floorplanAssetId: uuid.optional(),
}).superRefine((v, ctx) => {
  if (v.shape === 'polygon' && !v.polygon) ctx.addIssue({ code: 'custom', message: '多边形场地缺少顶点' });
  if (v.shape === 'rectangle' && v.polygon) ctx.addIssue({ code: 'custom', message: '矩形场地不能携带多边形' });
  if (v.polygon) {
    const p = v.polygon;
    const area = p.reduce((s, a, i) => { const b = p[(i + 1) % p.length]; return s + a.x * b.z - b.x * a.z; }, 0);
    if (Math.abs(area) < 0.01 || new Set(p.map(a => `${a.x},${a.z}`)).size !== p.length || p.some(a => a.x < 0 || a.z < 0 || a.x > v.width || a.z > v.depth)) {
      ctx.addIssue({ code: 'custom', message: '场地顶点或面积无效' });
    }
    for (let i = 0; i < p.length; i++) for (let j = i + 2; j < p.length; j++) {
      if (i === 0 && j === p.length - 1) continue;
      if (segmentsIntersect(p[i], p[(i + 1) % p.length], p[j], p[(j + 1) % p.length])) ctx.addIssue({ code: 'custom', message: '场地多边形不能自相交' });
    }
  }
  for (const entrance of v.entrances) {
    const poly = v.polygon ?? [{ x: 0, z: 0 }, { x: v.width, z: 0 }, { x: v.width, z: v.depth }, { x: 0, z: v.depth }];
    if (!poly.some((a, i) => onSegment(entrance.position, a, poly[(i + 1) % poly.length]))) ctx.addIssue({ code: 'custom', message: '出入口必须位于场地边界' });
  }
});
export const evidenceStatusSchema = z.enum(['detected', 'inferred', 'confirmed']);
export const sourceSchema = z.strictObject({
  assetId: uuid, kind: z.enum(['floorplan', 'photo']), name: z.string().min(1).max(120),
  width: z.number().int().positive().max(4096), height: z.number().int().positive().max(4096),
});
export const dimensionSchema = z.strictObject({
  id: uuid, kind: z.enum(['width', 'depth', 'height', 'wall', 'distance']),
  valueMeters: z.number().positive().max(400), status: evidenceStatusSchema,
  targetId: uuid.optional(), targetEndId:uuid.optional(), measure:z.enum(['width','depth','height','length']).optional(), sourceAssetId: uuid.optional(),
  start: pointSchema.optional(), end: pointSchema.optional(), label: z.string().max(200),
});
export const structureSchema = z.strictObject({
  walls: z.array(z.strictObject({id:uuid,start:pointSchema,end:pointSchema,thickness:z.number().min(0.02).max(2),height:z.number().positive().max(30),kind:z.enum(['exterior','interior']),status:evidenceStatusSchema,evidence:z.array(z.strictObject({sourceAssetId:uuid,start:z.strictObject({x:z.number().min(0).max(1),z:z.number().min(0).max(1)}),end:z.strictObject({x:z.number().min(0).max(1),z:z.number().min(0).max(1)})})).max(12).optional()})).max(128),
  openings: z.array(z.strictObject({id:uuid,wallId:uuid,kind:z.enum(['door','window']),offset:z.number().min(0).max(400),width:z.number().positive().max(20),height:z.number().positive().max(30),sillHeight:z.number().min(0).max(30),status:evidenceStatusSchema})).max(128),
  columns: z.array(z.strictObject({id:uuid,position:pointSchema,size:sizeSchema,rotation:z.number().min(-360).max(360),status:evidenceStatusSchema})).max(64),
}).superRefine((s,ctx)=>{
  const ids=[...s.walls,...s.openings,...s.columns].map(x=>x.id);
  if(new Set(ids).size!==ids.length) ctx.addIssue({code:'custom',message:'结构 ID 不能重复'});
  for(const wall of s.walls) if(Math.hypot(wall.end.x-wall.start.x,wall.end.z-wall.start.z)<0.02) ctx.addIssue({code:'custom',message:'墙段长度必须大于两厘米'});
  for(const opening of s.openings) {
    const wall=s.walls.find(w=>w.id===opening.wallId);
    if(!wall || opening.offset+opening.width>Math.hypot(wall.end.x-wall.start.x,wall.end.z-wall.start.z)+0.001 || opening.sillHeight+opening.height>wall.height+0.001) ctx.addIssue({code:'custom',message:'门窗必须完全位于所属墙内'});
  }
});
export const designSchema=z.strictObject({
  concept:z.string().max(2000),palette:z.array(colorSchema).max(8),
  highlights:z.array(z.strictObject({title:z.string().max(120),description:z.string().max(1000),objectIds:z.array(uuid).max(50)})).max(20),
  requirements:z.array(z.strictObject({text:z.string().max(500),status:z.enum(['satisfied','partial','unmet']),reason:z.string().max(1000),objectIds:z.array(uuid).max(50)})).max(40),
});
const sceneCommon={venue:venueSchema,objects:z.array(objectSchema).max(500),scenePreset:z.enum(presetKeys).optional(),camera:z.enum(['overview','top','customer']),lighting:z.enum(['neutral','warm','cool'])};
export const sceneV1Schema=z.strictObject({schemaVersion:z.literal(1),...sceneCommon});
export const sceneV2Schema=z.strictObject({schemaVersion:z.literal(2),...sceneCommon,structure:structureSchema,sources:z.array(sourceSchema).max(12).default([]),dimensions:z.array(dimensionSchema).max(128).default([]),design:designSchema.optional(),finishes:z.strictObject({floorColor:colorSchema.optional(),floorPattern:z.enum(['solid','wood','tile','carpet','concrete']).optional(),wallColors:z.record(uuid,colorSchema).optional()}).optional()});
export const sceneSchema=z.discriminatedUnion('schemaVersion',[sceneV1Schema,sceneV2Schema]).superRefine((s,ctx)=>{
  if (!s.scenePreset && s.objects.length > 50) ctx.addIssue({code:'custom',message:'普通场景最多50件物件'});
  for (const o of s.objects) if (o.presetNode !== undefined && (!s.scenePreset || !presetManifest[s.scenePreset][o.presetNode])) ctx.addIssue({code:'custom',message:'预设节点不存在'});
  if(new Set(s.objects.map(o=>o.id)).size!==s.objects.length) ctx.addIssue({code:'custom',message:'实例 ID 不能重复'});
  if(s.schemaVersion===2) {
    const entityIds=[...s.objects,...s.structure.walls,...s.structure.openings,...s.structure.columns].map(x=>x.id);
    if(new Set(entityIds).size!==entityIds.length)ctx.addIssue({code:'custom',message:'物件、墙体、门窗和柱子的 ID 不能互相重复'});
    if(new Set(s.sources.map(x=>x.assetId)).size!==s.sources.length) ctx.addIssue({code:'custom',message:'来源图片不能重复'});
    if(new Set(s.dimensions.map(x=>x.id)).size!==s.dimensions.length) ctx.addIssue({code:'custom',message:'尺寸 ID 不能重复'});
    for(const d of s.dimensions){
      if(d.sourceAssetId&&!s.sources.some(x=>x.assetId===d.sourceAssetId))ctx.addIssue({code:'custom',message:'尺寸来源图片不存在'});
      if(d.sourceAssetId&&[d.start,d.end].some(p=>p&&(p.x<0||p.x>1||p.z<0||p.z>1)))ctx.addIssue({code:'custom',message:'图片标定点须为0到1的归一化坐标'});
    }
    for(const w of s.structure.walls)for(const e of w.evidence??[])if(!s.sources.some(x=>x.assetId===e.sourceAssetId&&x.kind==='floorplan'))ctx.addIssue({code:'custom',message:'墙线证据必须关联平面图来源'});
    for(const o of s.objects) if(o.wallId && !s.structure.walls.some(w=>w.id===o.wallId)) ctx.addIssue({code:'custom',message:'挂墙物件所属墙不存在'});
    for(const h of [...(s.design?.highlights??[]),...(s.design?.requirements??[])]) if(h.objectIds.some(id=>!s.objects.some(o=>o.id===id)))ctx.addIssue({code:'custom',message:'设计引用了不存在的物件'});
  }
});
export type Scene = z.infer<typeof sceneSchema>;
export type SceneV2 = z.infer<typeof sceneV2Schema>;
export type SourceImage = z.infer<typeof sourceSchema>;
export type DimensionConstraint = z.infer<typeof dimensionSchema>;
export type SceneObject = z.infer<typeof objectSchema>;
export type Point = z.infer<typeof pointSchema>;

function cross(a: Point, b: Point, c: Point) { return (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x); }
function onSegment(p: Point, a: Point, b: Point) {
  return Math.abs(cross(a, b, p)) < 1e-8 && p.x >= Math.min(a.x, b.x) - 1e-8 && p.x <= Math.max(a.x, b.x) + 1e-8 && p.z >= Math.min(a.z, b.z) - 1e-8 && p.z <= Math.max(a.z, b.z) + 1e-8;
}
function segmentsIntersect(a: Point, b: Point, c: Point, d: Point) {
  return cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0 || onSegment(a, c, d) || onSegment(b, c, d) || onSegment(c, a, b) || onSegment(d, a, b);
}
function inside(p: Point, poly: Point[]) {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if (onSegment(p, a, b)) return true;
    if ((a.z > p.z) !== (b.z > p.z) && p.x < (b.x - a.x) * (p.z - a.z) / (b.z - a.z) + a.x) hit = !hit;
  }
  return hit;
}
export function corners(o: SceneObject): Point[] {
  const a = o.rotation * Math.PI / 180;
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, z]) => ({
    x: o.position.x + x * o.size.width / 2 * Math.cos(a) - z * o.size.depth / 2 * Math.sin(a),
    z: o.position.z + x * o.size.width / 2 * Math.sin(a) + z * o.size.depth / 2 * Math.cos(a),
  }));
}
export function sceneWarnings(scene: Scene) {
  const warnings: { code: string; ids: string[] }[] = [];
  if (scene.schemaVersion === 2) {
    // Use the same boundary and wall-mount rules as placement and server saves.
    for (const id of new Set(structuralViolations(scene).filter(v => v.code === 'OUT_OF_BOUNDS').map(v => v.objectId))) {
      warnings.push({ code: 'OUT_OF_BOUNDS', ids: [id] });
    }
  }
  const v = scene.venue;
  const poly = v.polygon ?? [{ x: 0, z: 0 }, { x: v.width, z: 0 }, { x: v.width, z: v.depth }, { x: 0, z: v.depth }];
  const footprints = scene.objects.map(corners);
  for (const [i, o] of scene.objects.entries()) {
    const p = footprints[i];
    if (scene.schemaVersion === 1) {
      const samples = p.flatMap((a, j) => { const b = p[(j + 1) % 4]; return [a, { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 }]; });
      // Proper intersections also catch narrow concave notches between sampled points.
      const crossesBoundary = p.some((a, j) => poly.some((b, k) => cross(a, p[(j + 1) % 4], b) * cross(a, p[(j + 1) % 4], poly[(k + 1) % poly.length]) < -1e-8 && cross(b, poly[(k + 1) % poly.length], a) * cross(b, poly[(k + 1) % poly.length], p[(j + 1) % 4]) < -1e-8));
      if ((o.elevation ?? 0) + o.size.height > v.height || samples.some(p => !inside(p, poly)) || crossesBoundary) warnings.push({ code: 'OUT_OF_BOUNDS', ids: [o.id] });
    }
    for (let j = 0; j < i; j++) {
      const other = scene.objects[j];
      if (o.materialId === 'carpet' || other.materialId === 'carpet') continue;
      const bottom = o.elevation ?? 0, otherBottom = other.elevation ?? 0;
      if (bottom + o.size.height <= otherBottom + 1e-8 || otherBottom + other.size.height <= bottom + 1e-8) continue;
      const q = footprints[j];
      const axes = [...p, ...q].map((a, k, all) => { const b = all[k < 4 ? (k + 1) % 4 : 4 + (k + 1) % 4]; return { x: -(b.z - a.z), z: b.x - a.x }; });
      const separated = axes.some(axis => {
        const pa = p.map(a => a.x * axis.x + a.z * axis.z), pb = q.map(a => a.x * axis.x + a.z * axis.z);
        return Math.max(...pa) <= Math.min(...pb) + 1e-8 || Math.max(...pb) <= Math.min(...pa) + 1e-8;
      });
      if (!separated) warnings.push({ code: 'OVERLAP', ids: [o.id, scene.objects[j].id] });
    }
  }
  return warnings;
}

export const leaseSchema = z.strictObject({ sessionId: uuid, generation: z.number().int().positive(), expectedRevision: z.number().int().nonnegative() });
export const proposalRequestSchema = z.strictObject({
  ...leaseSchema.shape, projectId: uuid, requestId: uuid, localRevision: z.number().int().nonnegative(),
  scene: sceneSchema, instruction: z.string().trim().min(1).max(3000),
  mode: z.enum(['layout', 'modify']), selectedIds: z.array(uuid).max(50),
});
export type ProposalRequest = z.infer<typeof proposalRequestSchema>;

export function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => JSON.stringify(k) + ':' + canonical(v)).join(',') + '}';
  return JSON.stringify(value);
}
export async function sha256(value: string | Uint8Array) {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  const hash = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes));
  return Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('');
}
export const sceneHash = (scene: Scene) => sha256(canonical(scene));
export function randomToken() {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, '0')).join('');
}
