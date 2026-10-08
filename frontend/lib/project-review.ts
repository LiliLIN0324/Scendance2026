import { z } from 'zod';
import type { CreativeBrief } from '../components/room-organizer/lib/creative-brief';
import type { DeliverySnapshot } from '../components/room-organizer/lib/scene-delivery';
import { isRoomLayout } from '../components/room-organizer/lib/schema';
import { layoutToSvg } from '../components/room-organizer/lib/plan-export/svg';
import type { FloorLayout, FurnitureItem, RoomLayout } from '../components/room-organizer/lib/types';
import type { BackupBrief, BackupBriefSnapshot } from './local-project-backup';

const timestamp = z.iso.datetime({ offset: true });
const text = z.string().min(1).max(4000);
const dataKind = z.enum(['unspecified', 'rehearsal', 'real']);
const tokenSchema = z.strictObject({ scope: text, revision: text });
const noteSchema = z.strictObject({
  kind: z.enum(['team-check', 'client-feedback', 'client-confirmation', 'pending']),
  text, sourceLabel: text, recordedAt: timestamp,
  dataKind, target: z.enum(['current', 'adopted']), objectIds: z.array(text).max(500).default([]),
});
const adoptionSchema = z.strictObject({
  snapshotId: text, source: tokenSchema,
  variantId: text, basis: text, sourceLabel: text, recordedAt: timestamp, dataKind,
  decision: z.enum(['team-selection', 'client-confirmation']),
});
const optionsSchema = z.strictObject({
  snapshot: z.strictObject({ id: text, generatedAt: timestamp }),
  source: tokenSchema,
  dataState: z.enum(['saved', 'unsaved-draft']), dataKind,
  disclosure: z.strictObject({ brief: z.boolean(), design: z.boolean() }),
  notes: z.array(noteSchema).max(100).default([]),
  adoption: adoptionSchema.optional(),
});

/** An opaque caller revision, advanced for edits, restore, scope and identity changes. No account ID is exported. */
export type ProjectReviewSource = z.infer<typeof tokenSchema>;
export type ProjectReviewNote = z.infer<typeof noteSchema>;
export type ProjectReviewAdoption = z.infer<typeof adoptionSchema>;
export interface ProjectReviewInput {
  layout: RoomLayout;
  briefSnapshot: BackupBriefSnapshot;
  snapshot: DeliverySnapshot;
  source: ProjectReviewSource;
  dataState: 'saved' | 'unsaved-draft';
  dataKind: 'unspecified' | 'rehearsal' | 'real';
  /** Explicit permission from the preparer to include these client-facing text fields. */
  disclosure: { brief: boolean; design: boolean };
  notes?: ProjectReviewNote[];
  adoption?: ProjectReviewAdoption;
}

type ReviewItem = Pick<FurnitureItem, 'id' | 'name' | 'type' | 'materialId' | 'source' |
  'width' | 'depth' | 'height' | 'color' | 'position' | 'rotation' | 'elevation' |
  'mirrored' | 'sofaShape' | 'stairsShape' | 'stairsLeadIn' | 'sillHeight'> & {
  assetVersionId: string | null;
  role: 'material' | 'fixed-structure';
};
type ReviewFloor = Pick<FloorLayout, 'id' | 'name' | 'height' | 'floorColor' | 'floorPattern' |
  'wallPattern' | 'wallColors' | 'hiddenWalls' | 'interiorWalls' | 'zones'> & { items: ReviewItem[] };
type ReviewDesign = NonNullable<NonNullable<RoomLayout['backendSceneV2']>['design']> & {
  missingObjectIds: string[];
};
interface ReviewLayout {
  name: string; width: number; depth: number; floors: ReviewFloor[];
  scenePreset: RoomLayout['scenePreset'] | null;
  roof: RoomLayout['roof'] | null;
  terrain: RoomLayout['terrain'] | null;
  entrance: RoomLayout['entrance'] | null;
  venue: { shape: string; height: number; polygon: { x: number; z: number }[];
    entrances: { id: string; position: { x: number; z: number }; width: number }[] };
  structure: { walls: { id: string; start: { x: number; z: number }; end: { x: number; z: number };
    thickness: number; height: number; kind: string; status: string }[];
    openings: { id: string; wallId: string; kind: string; offset: number; width: number;
      height: number; sillHeight: number; status: string }[];
    columns: { id: string; position: { x: number; z: number }; size: { width: number; depth: number; height: number };
      rotation: number; status: string }[] } | null;
  design: ReviewDesign | null;
  limitations: { objectIds: string[]; reason: string }[];
}
export interface ProjectReviewImage {
  snapshotId: string;
  source: ProjectReviewSource;
  capturedAt: string;
  kind: 'editor-capture' | 'provided-review-image';
  sourceLabel: string;
  caption: string;
  dataUrl: string;
  /** Caller has checked contents/permission; this is not inferred from an image URL. */
  approvedForCustomer: true;
  target: 'current' | 'adopted';
}
export type ProjectReviewCapture = Omit<ProjectReviewImage, 'approvedForCustomer'>;
export interface ProjectReviewSnapshot {
  format: 'scendance-project-review'; version: 1;
  snapshot: DeliverySnapshot; source: ProjectReviewSource;
  dataState: ProjectReviewInput['dataState']; dataKind: ProjectReviewInput['dataKind'];
  disclosure: ProjectReviewInput['disclosure'];
  brief: BackupBrief | { status: 'withheld' };
  current: { variantId: string | null; variantName: string | null; layout: ReviewLayout };
  adopted: { record: ProjectReviewAdoption; layout: ReviewLayout } | null;
  notes: (ProjectReviewNote & { missingObjectIds: string[] })[];
  images: ProjectReviewImage[];
}

function freeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

/** Do not execute getters or toJSON from runtime inputs, including fields omitted by the white list. */
function assertData(value: unknown, ancestors = new Set<object>(), depth = 0): void {
  if (depth > 128) throw new Error('评审资料嵌套过深。');
  if (value === undefined || value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (typeof value !== 'object' || !value) throw new Error('评审资料必须是普通数据，不能包含函数或自定义序列化。');
  const array = Array.isArray(value);
  const prototype = Object.getPrototypeOf(value);
  if ((array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) ||
      ancestors.has(value) || Object.getOwnPropertySymbols(value).length) throw new Error('评审资料包含非普通对象或循环引用。');
  ancestors.add(value);
  for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
    if (array && key === 'length') continue;
    if (!descriptor.enumerable || !('value' in descriptor)) throw new Error('评审资料不能包含取值器或隐藏字段。');
    assertData(descriptor.value, ancestors, depth + 1);
  }
  ancestors.delete(value);
}

/** Pick customer-review geometry, never spread a RoomLayout or a complete Scene into the file. */
function reviewLayout(layout: RoomLayout, discloseDesign: boolean): ReviewLayout {
  if (!isRoomLayout(layout)) throw new Error('布局字段无效，不能冻结评审快照；原项目未改变。');
  const floors = layout.floors.map(floor => ({
    id: floor.id, name: floor.name, height: floor.height, floorColor: floor.floorColor,
    floorPattern: floor.floorPattern, wallPattern: floor.wallPattern,
    wallColors: floor.wallColors ? Object.fromEntries(['north', 'south', 'east', 'west']
      .filter(key => floor.wallColors![key as keyof NonNullable<FloorLayout['wallColors']>] !== undefined)
      .map(key => [key, floor.wallColors![key as keyof NonNullable<FloorLayout['wallColors']>]])) : undefined,
    hiddenWalls: floor.hiddenWalls ? [...floor.hiddenWalls] : undefined,
    interiorWalls: floor.interiorWalls?.map(w => ({
      id: w.id, x1: w.x1, z1: w.z1, x2: w.x2, z2: w.z2,
      thickness: w.thickness, height: w.height,
      kind: z.enum(['exterior', 'interior']).optional().parse(w.kind),
      status: z.enum(['detected', 'inferred', 'confirmed']).optional().parse(w.status), color: w.color,
    })),
    zones: floor.zones?.map(v => ({ id: v.id, name: v.name, color: v.color, x: v.x, z: v.z, w: v.w, d: v.d })),
    items: floor.items.map(item => ({
      id: item.id, name: item.name, type: item.type, materialId: item.materialId, source: item.source,
      width: item.width, depth: item.depth, height: item.height, color: item.color,
      position: item.position ? { x: item.position.x, z: item.position.z } : undefined,
      rotation: item.rotation, elevation: item.elevation,
      mirrored: item.mirrored, sofaShape: item.sofaShape, stairsShape: item.stairsShape,
      stairsLeadIn: item.stairsLeadIn, sillHeight: item.sillHeight, assetVersionId: item.assetId ?? null,
      role: item.venueEntranceId || item.structuralOpeningId || item.structuralColumnId
        ? 'fixed-structure' as const : 'material' as const,
    })),
  }));
  const ids = floors.flatMap(floor => floor.items.map(item => item.id));
  if (new Set(ids).size !== ids.length || new Set(floors.map(f => f.id)).size !== floors.length) {
    throw new Error('布局包含重复物件或楼层编号，无法保证评审关联。');
  }
  const venue = layout.backendVenue ?? layout.backendSceneV2?.venue;
  const structure = layout.backendSceneV2?.structure;
  const design = discloseDesign ? layout.backendSceneV2?.design : undefined;
  const limitations: ReviewLayout['limitations'] = [];
  const add = (reason: string, objectIds: string[] = []) => { limitations.push({ reason, objectIds }); };
  // ponytail: a review must not import the Three.js delivery pipeline or depend on model/network readiness.
  if (layout.scenePreset || layout.floors.some(f => f.items.some(i => i.glbNode))) {
    add('完整场馆或模板模型节点不在当前独立模型交付范围内；节点不据此视为固定设施，可继续文字与静态画面评审。');
  }
  if (layout.floors.length > 1) add('多层布局不在当前 Scene JSON 交付范围内。');
  if (layout.entrance || (layout.roof && layout.roof.style !== 'none') ||
      (layout.terrain && (layout.terrain.frontY !== 0 || layout.terrain.backY !== 0)) ||
      (!layout.backendSceneV2 && layout.floors.some(f => f.interiorWalls?.length))) {
    add('本地建筑扩展不在当前 Scene JSON 交付范围内；平面示意不表达完整建筑造型。');
  }
  if (!layout.backendSceneV2 && (layout.floorPlanImage || venue?.floorplanAssetId || venue?.shape === 'polygon')) {
    add('当前场地底图或多边形不能转换为 Scene JSON；原图不自动打包。');
  }
  for (const item of layout.floors.flatMap(f => f.items)) {
    if (!item.assetId && !item.glbNode && (item.glbUrl || item.type === 'glb-asset')) {
      add('模型没有稳定归档编号，不能据此交付模型文件；本包不包含其加载地址。', [item.id]);
    }
    if (item.assetId) add('已记录模型版本编号，但模型授权、载入与文件交付尚未在本包核验。', [item.id]);
    if (!item.position) add('物件尚未记录摆放位置，平面示意中不显示。', [item.id]);
  }
  return JSON.parse(JSON.stringify({
    name: layout.name, width: layout.width, depth: layout.height, floors,
    scenePreset: layout.scenePreset ?? null,
    roof: layout.roof ? { style: layout.roof.style, color: layout.roof.color,
      dormers: layout.roof.dormers?.map(d => ({ id: d.id, side: d.side, width: d.width, offset: d.offset,
        height: d.height, setback: d.setback, window: d.window, balcony: d.balcony, color: d.color,
        openings: d.openings?.map(o => ({ kind: o.kind, from: o.from, to: o.to })) })) } : null,
    terrain: layout.terrain ? { frontY: layout.terrain.frontY, backY: layout.terrain.backY } : null,
    entrance: layout.entrance ? { width: layout.entrance.width, depth: layout.entrance.depth,
      offset: layout.entrance.offset, height: layout.entrance.height, door: layout.entrance.door } : null,
    venue: { shape: venue?.shape ?? 'rectangle', height: venue?.height ?? layout.floors[0].height ?? 3,
      polygon: venue?.polygon?.map(p => ({ x: p.x, z: p.z })) ?? [],
      entrances: venue?.entrances.map(e => ({ id: e.id, position: { x: e.position.x, z: e.position.z }, width: e.width })) ?? [] },
    structure: structure ? {
      walls: structure.walls.map(w => ({ id: w.id, start: { x: w.start.x, z: w.start.z }, end: { x: w.end.x, z: w.end.z }, thickness: w.thickness,
        height: w.height, kind: w.kind, status: w.status })),
      openings: structure.openings.map(o => ({ id: o.id, wallId: o.wallId, kind: o.kind, offset: o.offset,
        width: o.width, height: o.height, sillHeight: o.sillHeight, status: o.status })),
      columns: structure.columns.map(c => ({ id: c.id, position: { x: c.position.x, z: c.position.z },
        size: { width: c.size.width, depth: c.size.depth, height: c.size.height }, rotation: c.rotation, status: c.status })),
    } : null,
    design: design ? { concept: design.concept, palette: [...design.palette],
      highlights: design.highlights.map(h => ({ title: h.title, description: h.description, objectIds: [...h.objectIds] })),
      requirements: design.requirements.map(r => ({ text: r.text, reason: r.reason, status: r.status, objectIds: [...r.objectIds] })),
      missingObjectIds: [...new Set([...design.highlights, ...design.requirements].flatMap(r => r.objectIds).filter(id => !ids.includes(id)))],
    } : null,
    limitations,
  })) as ReviewLayout;
}

function reviewBrief(brief: CreativeBrief): CreativeBrief {
  const value = {
    event: brief.event, guests: brief.guests, description: brief.description, mustHave: brief.mustHave,
    allowIdeas: brief.allowIdeas, hasFloorplan: brief.hasFloorplan, venueConditions: brief.venueConditions,
    style: brief.style, palette: brief.palette, atmosphere: brief.atmosphere,
  };
  if (typeof value.event !== 'string' || !Number.isFinite(value.guests) ||
      typeof value.description !== 'string' || typeof value.mustHave !== 'string' ||
      typeof value.allowIdeas !== 'boolean' ||
      (value.hasFloorplan !== undefined && typeof value.hasFloorplan !== 'boolean') ||
      [value.venueConditions, value.style, value.palette, value.atmosphere].some(v => v !== undefined && typeof v !== 'string')) {
    throw new Error('需求字段无效，不能冻结评审快照。');
  }
  return JSON.parse(JSON.stringify(value)) as CreativeBrief;
}

/** Synchronous, detached, immutable white-list snapshot. No save, model call, or resource loading. */
export function createProjectReviewSnapshot(input: ProjectReviewInput): ProjectReviewSnapshot {
  assertData(input);
  const { layout, briefSnapshot, ...rawOptions } = input;
  const options = optionsSchema.parse(rawOptions);
  if ([...options.notes, ...(options.adoption ? [options.adoption] : [])].some(record =>
    Date.parse(record.recordedAt) > Date.parse(options.snapshot.generatedAt))) throw new Error('评审记录晚于冻结时间，请重新冻结。');
  if (briefSnapshot.state !== 'ready') throw new Error('需求读取或保存尚未完成，不能冻结评审快照。');
  if (options.source.scope !== (layout.id ?? 'local') || briefSnapshot.scope !== options.source.scope) {
    throw new Error('需求、布局与评审项目不一致，不能冻结快照。');
  }
  if (layout.eventOperations?.dataKind && layout.eventOperations.dataKind !== 'unspecified' &&
      options.dataKind !== layout.eventOperations.dataKind) throw new Error('评审资料类型与原活动标识不一致。');
  const current = reviewLayout(layout, options.disclosure.design);
  const variant = options.adoption ? layout.designBook?.variants.find(v => v.id === options.adoption!.variantId) : undefined;
  if (options.adoption && !variant) throw new Error('采用版本不在本次方案记录中，不能关联到当前布局。');
  if (options.adoption && (options.adoption.snapshotId !== options.snapshot.id ||
      options.adoption.source.scope !== options.source.scope || options.adoption.source.revision !== options.source.revision)) {
    throw new Error('采用记录不属于本次内容快照，不能沿用旧版本确认。');
  }
  if (options.adoption?.decision === 'client-confirmation' && !options.notes.some(note =>
    note.kind === 'client-confirmation' && note.target === 'adopted' && note.dataKind === options.adoption!.dataKind)) {
    throw new Error('客户确认的采用记录需要对应的客户意见；编辑器应用不能代替客户确认。');
  }
  const adopted = variant && options.adoption ? { record: options.adoption,
    layout: reviewLayout(variant.id === layout.designBook?.activeId ? layout : variant.layout, options.disclosure.design) } : null;
  const notes = options.notes.map(note => {
    const target = note.target === 'current' ? current : adopted?.layout;
    if (!target) throw new Error('意见引用的采用版本未记录。');
    const ids = target.floors.flatMap(f => f.items.map(i => i.id));
    return { ...note, missingObjectIds: note.objectIds.filter(id => !ids.includes(id)) };
  });
  if (briefSnapshot.brief.status !== 'present' && briefSnapshot.brief.status !== 'absent') throw new Error('需求状态无效。');
  // Validate known brief fields even when the preparer chooses not to disclose them.
  const brief: BackupBrief = briefSnapshot.brief.status === 'present'
    ? { status: 'present', value: reviewBrief(briefSnapshot.brief.value) } : { status: 'absent' };
  const active = layout.designBook?.variants.find(v => v.id === layout.designBook?.activeId);
  return freeze({
    format: 'scendance-project-review', version: 1,
    snapshot: options.snapshot, source: options.source, dataState: options.dataState, dataKind: options.dataKind,
    disclosure: options.disclosure, brief: options.disclosure.brief ? brief : { status: 'withheld' },
    current: { variantId: active?.id ?? null, variantName: active?.name ?? null, layout: current },
    adopted, notes, images: [],
  });
}

/** Revision is caller-owned; includes changes omitted from customer export, not merely a cloud revision. */
export function projectReviewIsStale(snapshot: ProjectReviewSnapshot, source: ProjectReviewSource): boolean {
  const current = tokenSchema.parse(source);
  return current.scope !== snapshot.source.scope || current.revision !== snapshot.source.revision;
}

export const MAX_PROJECT_REVIEW_IMAGE_BYTES = 4 * 1024 * 1024;
const imageSchema = z.strictObject({
  snapshotId: text, source: tokenSchema, capturedAt: timestamp,
  kind: z.enum(['editor-capture', 'provided-review-image']), sourceLabel: text, caption: text,
  dataUrl: z.string().max(Math.ceil(MAX_PROJECT_REVIEW_IMAGE_BYTES / 3) * 4 + 64),
  approvedForCustomer: z.literal(true), target: z.enum(['current', 'adopted']),
});
function checkImageDataUrl(url: string): void {
  const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(url);
  if (!match || match[2].length % 4 !== 0 || match[2].length * 3 / 4 > MAX_PROJECT_REVIEW_IMAGE_BYTES + 2) {
    throw new Error('评审画面只接受 4 MiB 以内的内嵌 PNG、JPEG 或 WebP，不能使用外部地址或 SVG。');
  }
  const bytes = atob(match[2]);
  const valid = match[1] === 'png' ? bytes.startsWith('\x89PNG\r\n\x1a\n')
    : match[1] === 'jpeg' ? bytes.startsWith('\xff\xd8\xff') && bytes.endsWith('\xff\xd9')
      : bytes.startsWith('RIFF') && bytes.slice(8, 12) === 'WEBP';
  if (!valid) throw new Error('评审画面的文件标识与图片类型不符。');
}

/** Attach only deliberately shared raster images from this frozen revision; keep the original snapshot unchanged. */
function checkedImages(snapshot: ProjectReviewSnapshot, images: ProjectReviewImage[]): ProjectReviewImage[] {
  assertData(images);
  const parsed = z.array(imageSchema).max(6).parse(images);
  let totalBytes = 0;
  for (const image of parsed) {
    if (image.snapshotId !== snapshot.snapshot.id || projectReviewIsStale(snapshot, image.source)) {
      throw new Error('评审画面与文字快照不一致，未附加画面。');
    }
    if (Date.parse(image.capturedAt) < Date.parse(snapshot.snapshot.generatedAt)) throw new Error('画面早于本次冻结，不能证明属于同一快照。');
    if (image.target === 'adopted' && !snapshot.adopted) throw new Error('画面引用的采用版本未记录。');
    checkImageDataUrl(image.dataUrl);
    totalBytes += image.dataUrl.length;
  }
  if (totalBytes > 12 * 1024 * 1024) throw new Error('评审画面总量过大，请减少画面或降低图片尺寸。');
  return parsed;
}

export function attachProjectReviewImages(
  snapshot: ProjectReviewSnapshot, images: ProjectReviewImage[], currentSource: ProjectReviewSource,
): ProjectReviewSnapshot {
  assertData(snapshot);
  if (projectReviewIsStale(snapshot, currentSource)) throw new Error('评审快照已过期，请重新冻结后捕获画面。');
  return freeze({ ...snapshot, images: checkedImages(snapshot, images) });
}

/** Validate pixels/provenance for local inspection; this does not grant sharing approval or attach an image. */
export function validateProjectReviewCapture(snapshot: ProjectReviewSnapshot, capture: ProjectReviewCapture): ProjectReviewCapture {
  return validateProjectReviewCaptures(snapshot, [capture])[0];
}

/** Check the whole pending set before replacing an earlier approved file; still grants no approval. */
export function validateProjectReviewCaptures(snapshot: ProjectReviewSnapshot, captures: ProjectReviewCapture[]): ProjectReviewCapture[] {
  assertData(captures);
  const parsed = z.array(imageSchema.omit({ approvedForCustomer: true })).max(6).parse(captures);
  checkedImages(snapshot, parsed.map(capture => ({ ...capture, approvedForCustomer: true })));
  return freeze(parsed);
}

function escape(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
}
const kindLabels = { unspecified: '资料性质未标注', rehearsal: '假设演练', real: '真实资料（确认状态另列）' };
const noteLabels = { 'team-check': '团队自查', 'client-feedback': '客户意见', 'client-confirmation': '客户确认记录', pending: '待确认项' };
const safeColor = (color: string | undefined) => /^#[\da-f]{6}$/i.test(color ?? '') ? color! : '#e9e5db';
const para = (value: unknown) => `<p class="text">${escape(value)}</p>`;
const table = (headers: string[], rows: unknown[][]) => `<div class="table-wrap"><table><thead><tr>${headers.map(h => `<th>${escape(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${row.map(c => `<td>${escape(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;

// Display only: snapshot geometry and grouping keep their original precision.
const number = (value: number) => String(Number(value.toFixed(2)));
const size = (item: ReviewItem) => `${number(item.width)} × ${number(item.depth)} × ${number(item.height)} 米`;
const displayTime = (value: string) => new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
}).format(new Date(value));
const materialLabels: Record<string, string> = {
  chair: '椅子', armchair: '扶手椅', 'dining-chair': '餐椅', bench: '长椅', sofa: '沙发',
  table: '桌子', 'dining-table': '餐桌', 'coffee-table': '茶几', 'side-table': '边桌', desk: '书桌',
  reception: '签到台', backdrop: '背景板', display: '展架', partition: '隔断', carpet: '地毯', decoration: '装饰道具',
  bed: '床', bookshelf: '书架', wardrobe: '衣柜', dresser: '斗柜', cabinet: '柜体', 'wall-shelf': '壁架',
  lamp: '台灯', 'floor-lamp': '落地灯', lamppost: '路灯', 'pendant-light': '吊灯', plant: '绿植', tree: '树木',
  'pine-tree': '松树', bush: '灌木', hedge: '绿篱', 'rose-bush': '玫瑰丛', flowerpot: '花盆', flowerbed: '花坛',
  tulips: '郁金香', sunflower: '向日葵', tv: '电视', computer: '电脑', nightstand: '床头柜',
  wifi: '无线网络设备', router: '路由器', cctv: '监控设备', 'security-camera': '监控摄像头',
  fridge: '冰箱', stove: '炉灶', dishwasher: '洗碗机', 'kitchen-sink': '厨房水槽', counter: '柜台', bbq: '烧烤架',
  toilet: '坐便器', bathtub: '浴缸', shower: '淋浴', 'bathroom-sink': '洗手池', rug: '地毯', painting: '装饰画',
  vase: '花瓶', mirror: '镜子', books: '书籍', candles: '蜡烛', curtains: '窗帘', 'wall-clock': '挂钟', fence: '围栏',
  pool: '泳池', pond: '池塘', birdbath: '鸟浴盆', 'garden-bench': '花园长椅', 'picnic-table': '野餐桌',
  'stepping-stone': '踏步石', mailbox: '信箱', person: '人物示意', pet: '宠物示意', stairs: '楼梯', door: '门', window: '窗',
  'glb-asset': '模型物料',
};
const sourceLabels = { builtin: '内置示意', public_library: '公共模型', generated: '生成模型', local_sample: '本地模型' };
const requirementLabels = { satisfied: '设计记录为满足', partial: '设计记录为部分满足', unmet: '设计记录为未满足' };
const materialLabel = (item: ReviewItem) => materialLabels[item.materialId ?? ''] ?? materialLabels[item.type] ?? '其他示意物料';
const modelVersions = (layout: ReviewLayout) => [...new Set(layout.floors.flatMap(f => f.items.map(i => i.assetVersionId).filter((id): id is string => !!id)))];
// The projection omits loading URLs; use its existing model limitation to retain that distinction.
const unversionedModels = (layout: ReviewLayout) => new Set([
  ...layout.limitations.filter(l => l.reason.startsWith('模型没有稳定归档编号')).flatMap(l => l.objectIds),
  ...layout.floors.flatMap(f => f.items.filter(i => !i.assetVersionId &&
    (i.type === 'glb-asset' || (i.source && i.source !== 'builtin'))).map(i => i.id)),
]);
const modelLabel = (item: ReviewItem, versions: string[], unversioned: boolean) => item.assetVersionId
  ? `模型版本 ${versions.indexOf(item.assetVersionId) + 1}`
  : unversioned ? `${item.source && item.source !== 'builtin' ? sourceLabels[item.source] : '模型物料'} · 版本未记录`
  : item.source ? sourceLabels[item.source] : '示意物料';
const shapeLabel = (item: ReviewItem) => [
  item.sofaShape ? ({ standard: '标准沙发', 'L-shape': 'L形沙发', 'U-shape': 'U形沙发' })[item.sofaShape] : '',
  item.stairsShape ? ({ straight: '直梯', winder: '转角梯' })[item.stairsShape] : '',
  item.stairsLeadIn === undefined ? '' : `起始台阶 ${number(item.stairsLeadIn)}`,
  item.mirrored ? '镜像形态' : '', item.sillHeight === undefined ? '' : `窗台高 ${number(item.sillHeight)} 米`,
].filter(Boolean).join(' · ');

function renderMaterials(layout: ReviewLayout, heading: string): string {
  const groups = new Map<string, { item: ReviewItem; count: number }>();
  const all = layout.floors.flatMap(f => f.items);
  const unversioned = unversionedModels(layout);
  for (const item of all.filter(i => i.role === 'material')) {
    // A model without a version has no safe identity for grouping; keep each instance separate.
    const key = JSON.stringify([item.materialId, item.type, item.source, item.assetVersionId,
      item.width, item.depth, item.height, item.color, item.mirrored, item.sofaShape, item.stairsShape,
      item.stairsLeadIn, item.sillHeight, unversioned.has(item.id) ? item.id : null]);
    const group = groups.get(key);
    if (group) group.count += 1;
    else groups.set(key, { item, count: 1 });
  }
  const versions = modelVersions(layout);
  return `<section class="materials"><h2>${escape(heading)}</h2>${para('按本方案的类型、规格、颜色与模型版本汇总。数量仅供布局讨论，实际规格与可获得性待核；不作采购清单或报价。')}
${table(['物料', '数量', '示意规格（宽 × 深 × 高）', '颜色', '表现形式'], [...groups.values()].map(({ item, count }) => [
      materialLabel(item), count, `${size(item)}${shapeLabel(item) ? `\n${shapeLabel(item)}` : ''}`,
      /^#[\da-f]{6}$/i.test(item.color) ? item.color.toUpperCase() : '颜色待核', modelLabel(item, versions, unversioned.has(item.id)),
    ]))}${all.some(i => i.role === 'fixed-structure') ? para(`另有 ${all.filter(i => i.role === 'fixed-structure').length} 件固定结构标记，见附录；未计入上述物料。`) : ''}</section>`;
}

function renderNote(note: ProjectReviewSnapshot['notes'][number]): string {
  return `<article>${para(note.text)}<p class="caption">${escape(kindLabels[note.dataKind])} · ${note.target === 'current' ? '当前布局' : '已记录采用布局'} · 人工记录于 ${escape(displayTime(note.recordedAt))}${note.missingObjectIds.length ? ' · 关联物件有变动，需复核' : ''}</p></article>`;
}

function renderLayout(layout: ReviewLayout, heading: string, teamNotes: ProjectReviewSnapshot['notes'], images: ProjectReviewImage[]): string {
  const items = layout.floors.flatMap(f => f.items);
  const plans = layout.scenePreset || layout.venue.shape !== 'rectangle' || layout.structure
    ? para('完整场馆或结构没有简化平面示意；可用本次记录的静态画面配合文字评审。')
    : layout.floors.map(floor => {
      const safeFloor: FloorLayout = { ...floor, floorColor: safeColor(floor.floorColor),
        wallColors: Object.fromEntries(Object.entries(floor.wallColors ?? {}).map(([key, value]) => [key, safeColor(value)])),
        ...(floor.interiorWalls ? { interiorWalls: floor.interiorWalls.map(w => ({ ...w, ...(w.color ? { color: safeColor(w.color) } : {}) })) } : {}),
        ...(floor.zones ? { zones: floor.zones.map(zone => ({ ...zone, color: safeColor(zone.color) })) } : {}),
        items: floor.items.map(i => ({ ...i, icon: '', color: safeColor(i.color) })),
      };
      const planLayout: RoomLayout = { name: layout.name, width: layout.width, height: layout.depth, floors: [safeFloor] };
      return `<figure class="plan">${layoutToSvg(planLayout, safeFloor)}<figcaption>${escape(floor.name)} · 平面示意，非实测。仅表达平面位置与物件轮廓，不能作为施工图。</figcaption></figure>`;
    }).join('');
  const design = layout.design;
  const requirements = design ? table(['设计要求', '原设计判断', '理由'], design.requirements.map(r => [
    r.text, r.objectIds.some(id => design.missingObjectIds.includes(id)) ? `关联有变动，需复核；${requirementLabels[r.status]}` : requirementLabels[r.status], r.reason,
  ])) : '';
  const captures = images.map(image => `<figure><img src="${escape(image.dataUrl)}" alt="${escape(image.caption)}"><figcaption>${escape(image.caption)} · ${image.kind === 'editor-capture' ? '工作台静态画面' : '经允许公开的评审图片'} · 本次内容记录</figcaption></figure>`).join('');
  return `<section class="layout"><h2>${escape(heading)}</h2><p class="caption">${escape(`${number(layout.width)} × ${number(layout.depth)} 米 · ${layout.floors.length} 层 · ${items.filter(i => i.role === 'material').length} 件示意物料`)}</p>${plans}${captures}
    <h3>设计说明与理由</h3>${design ? para(design.concept) + design.highlights.map(h => `<article><h4>${escape(h.title)}</h4>${para(h.description)}</article>`).join('') + requirements : ''}
${design ? para('以上为原方案设计记录，不是客户意见；现场条件与容量仍须核对。') : ''}
${teamNotes.length ? `<h4>团队说明</h4>${teamNotes.map(renderNote).join('')}${para('团队说明与自查不代替客户确认或现场验收。')}` : ''}
${!design && !teamNotes.length ? para('本次没有可公开的设计理由，待方案团队补充。') : ''}
${design?.missingObjectIds.length ? para('设计关联的部分物件已变动，请复核附录中的对应记录。') : ''}
${layout.limitations.length ? para('本方案仍可进行文字与画面评审；模型文件交付有待核事项，详见附录。') : ''}</section>`;
}

function renderLayoutAppendix(layout: ReviewLayout, heading: string): string {
  const versions = modelVersions(layout);
  const unversioned = unversionedModels(layout);
  const items = layout.floors.flatMap(f => f.items.map(i => ({ ...i, floorName: f.name })));
  return `<h3>${escape(heading)} · 逐件记录</h3>${para('尺寸、坐标与朝向仅为编辑布局记录，显示保留两位小数；坐标以场地中心为原点，旋转由原弧度换算为度。')}
${table(['楼层', '物件／原编号', '类型／来源', '示意规格', '定位与朝向', '模型记录'], items.map(i => [
      i.floorName, `${i.name}\n${i.id}${i.role === 'fixed-structure' ? '\n固定结构标记' : ''}`,
      `${materialLabel(i)}\n原类型 ${i.type}${i.materialId ? ` / ${i.materialId}` : ''}\n${i.source ? sourceLabels[i.source] : '来源未记录'}`,
      `${size(i)}\n颜色 ${i.color}${shapeLabel(i) ? `\n${shapeLabel(i)}` : ''}`,
      i.position ? `横向 ${number(i.position.x)} 米 / 纵向 ${number(i.position.z)} 米\n旋转 ${number((i.rotation ?? 0) * 180 / Math.PI)}°\n离地 ${number(i.elevation ?? 0)} 米` : '位置未记录',
      i.assetVersionId ? `${modelLabel(i, versions, false)}\n${i.assetVersionId}` : modelLabel(i, versions, unversioned.has(i.id)),
    ]))}
${layout.design ? `<h4>设计与物件对应</h4>${table(['记录', '原状态', '关联原编号'], [
      ...layout.design.highlights.map(h => [h.title, '设计亮点', h.objectIds.join('、') || '未关联']),
      ...layout.design.requirements.map(r => [r.text, r.objectIds.some(id => layout.design!.missingObjectIds.includes(id)) ? `需复核；原记录 ${r.status}` : r.status, r.objectIds.join('、') || '未关联']),
    ])}` : ''}
    <h4>模型交付限制及依据</h4>${para('本包供文字与静态画面评审，不是 Scene JSON 或 GLB。未运行模型授权、载入或文件转换验收；没有列出限制不代表这些验收已通过。')}
${layout.limitations.length ? table(['依据', '关联原编号'], layout.limitations.map(l => [l.reason, l.objectIds.join('、') || '场景整体'])) : para('所选字段没有识别到上述范围限制；模型和现场仍须另行核验。')}`;
}

/** A standalone, escaped HTML file. Native browser print/save works offline; no scripts or automatic print. */
export function projectReviewHtml(snapshot: ProjectReviewSnapshot): string {
  assertData(snapshot);
  if (snapshot.adopted) {
    const record = adoptionSchema.parse(snapshot.adopted.record);
    if (record.snapshotId !== snapshot.snapshot.id || projectReviewIsStale(snapshot, record.source)) {
      throw new Error('采用记录不属于本次内容快照，不能导出。');
    }
  }
  const brief = snapshot.brief.status === 'present' ? snapshot.brief.value : null;
  const customerNotes = snapshot.notes.filter(n => (n.kind === 'client-feedback' || n.kind === 'client-confirmation') && n.dataKind === 'real');
  const simulatedNotes = snapshot.notes.filter(n => (n.kind === 'client-feedback' || n.kind === 'client-confirmation') && n.dataKind !== 'real');
  const pendingNotes = snapshot.notes.filter(n => n.kind === 'pending');
  const teamNotes = snapshot.notes.filter(n => n.kind === 'team-check');
  const images = checkedImages(snapshot, snapshot.images);
  const adoptedName = snapshot.adopted && snapshot.adopted.record.variantId === snapshot.current.variantId
    ? snapshot.current.variantName : null;
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'none'; base-uri 'none'; form-action 'none'; object-src 'none'"><title>${escape(snapshot.current.layout.name)} · 方案评审包</title>
  <style>body{margin:0;color:#20372d;background:#f3f5f1;font:15px/1.65 system-ui,"Microsoft YaHei",sans-serif}main{max-width:960px;margin:28px auto;padding:36px 44px;background:white}h1{font-size:30px;line-height:1.35;margin:16px 0}h2{font-size:22px;border-bottom:1px solid #a5b9a4;padding-bottom:8px;margin-top:32px}h3{font-size:17px;margin:22px 0 8px}h4{font-size:15px;margin:14px 0 6px}p{margin:10px 0}.text,td{white-space:pre-wrap;overflow-wrap:anywhere}.eyebrow,.caption,figcaption{font-size:12px;color:#526654}.state{display:inline-block;padding:4px 12px;border:1px solid #a5b9a4;border-radius:4px;background:#edf3e9}.notice{padding:9px 12px;background:#f4f1e4;font-size:13px}.intro{border-top:3px solid #44684f;padding-top:12px}.facts{display:grid;grid-template-columns:1fr 1fr;gap:18px;margin:16px 0}.facts dt{font-size:12px;color:#526654}.facts dd{margin:4px 0;font-size:18px;font-weight:600}.table-wrap{overflow-x:auto}table{border-collapse:collapse;width:100%;font-size:13px;margin:16px 0}th,td{border:1px solid #d5dfd2;padding:10px;text-align:left;vertical-align:top}th{background:#edf3e9;font-weight:600}figure{margin:20px 0;border:1px solid #d5dfd2;padding:14px}svg{display:block;width:100%;max-height:570px}.plan text.label{display:none}svg,img{max-width:100%;height:auto}figcaption{margin-top:9px;overflow-wrap:anywhere}article{border-left:2px solid #a5b9a4;padding-left:14px;margin:14px 0}.pending article{border-color:#a98c42}.appendix{margin-top:34px;border:1px solid #d5dfd2;padding:14px 18px}.appendix summary{cursor:pointer;font-size:16px;font-weight:600}.appendix summary:focus-visible{outline:2px solid #44684f;outline-offset:5px}.appendix table{font-size:12px}.appendix-help,footer{font-size:12px;color:#526654}footer{margin-top:26px}@media(max-width:640px){main{margin:0;padding:24px 18px}.facts{grid-template-columns:1fr}h1{font-size:25px}h2{font-size:20px}}@page{size:A4;margin:14mm}@media print{body{background:white;font-size:11px}main{margin:0;padding:0;max-width:none}h1{font-size:23px}h2{font-size:18px}h3{font-size:14px}table,.appendix table{font-size:9px}.table-wrap{overflow:visible}thead{display:table-header-group}tr,figure{break-inside:avoid}h2,h3,h4{break-after:avoid}figure{margin:3mm 0;padding:2.5mm}svg{max-height:100mm;max-width:100%;width:auto;height:auto;margin:0 auto}img{display:block;max-height:95mm;max-width:100%;width:auto;height:auto;object-fit:contain;margin:0 auto}.layout{break-before:auto}.layout>.caption,.layout>.caption+p{break-after:avoid}.appendix:not([open]){display:none}.appendix[open]{break-before:page}.appendix-help{display:none}*{-webkit-print-color-adjust:exact;print-color-adjust:exact}}</style></head><body><main>
  <header><p class="eyebrow">幕景 · 客户方案评审文件</p><span class="state">${escape(kindLabels[snapshot.dataKind])} · ${snapshot.dataState === 'saved' ? '已保存资料' : '未保存草稿'}</span><h1>${escape(snapshot.current.layout.name)}</h1><p class="caption">本次内容记录于 ${escape(displayTime(snapshot.snapshot.generatedAt))}（北京时间）</p><p class="notice">供方案讨论。假设与待定项仍待确认；布局尺寸为示意，非实测。</p></header>
  <section class="intro"><h2>活动目标与场地</h2>${brief ? `<dl class="facts"><div><dt>活动与预计人数</dt><dd>${escape(`${brief.event} / ${brief.guests} 人`)}</dd></div><div><dt>布局中的场地尺寸</dt><dd>${escape(`${number(snapshot.current.layout.width)} × ${number(snapshot.current.layout.depth)} 米`)}</dd></div></dl><h3>活动目标与需求原文</h3>${para(brief.description)}<h3>必须满足</h3>${para(brief.mustHave)}<h3>现场条件</h3>${para(brief.venueConditions ?? '未记录，待核对。')}${para(`风格：${brief.style ?? '未记录'} · 配色：${brief.palette ?? '未记录'} · 氛围：${brief.atmosphere ?? '未记录'}`)}` : para(snapshot.brief.status === 'withheld' ? '需求原文未获准公开，未包含在本次客户文件中。' : '原项目没有已记录的需求；待补。')}</section>
${renderLayout(snapshot.current.layout, '布局示意与设计说明', teamNotes.filter(n => n.target === 'current'), images.filter(i => i.target === 'current'))}
${snapshot.adopted ? renderLayout(snapshot.adopted.layout, '已记录采用布局', teamNotes.filter(n => n.target === 'adopted'), images.filter(i => i.target === 'adopted')) : ''}
  <section class="review-status"><h2>采用与意见状态</h2>${para(`当前讨论方案：${snapshot.current.variantName ?? '当前编辑布局'}`)}${snapshot.adopted ? para(`采用版本：${adoptedName ?? '已记录采用方案（编号见附录）'}\n${kindLabels[snapshot.adopted.record.dataKind]} · ${snapshot.adopted.record.decision === 'team-selection' ? '团队选定，不等于客户确认' : '已提供客户确认记录；不作电子签字'}\n采用依据：${snapshot.adopted.record.basis}`) : para('采用版本：未记录。团队自查与布局应用不代替客户采用记录。')}
    <h3>真实客户意见与确认</h3>${customerNotes.length ? customerNotes.map(n => `<h4>${escape(noteLabels[n.kind])}</h4>${renderNote(n)}`).join('') : para('真实客户意见／确认：尚未记录，待补。')}
${simulatedNotes.length ? `<h3>演练或未标注性质的意见</h3>${simulatedNotes.map(renderNote).join('')}${para('以上记录不计作真实客户意见。')}` : ''}${para('报价：未记录。演示价格与假设预算不作供应商报价或合同金额。')}</section>
  <section class="pending"><h2>待确认项</h2>${pendingNotes.length ? pendingNotes.map(renderNote).join('') : para('独立待确认清单尚未记录。需求原文中的待定项仍有效，不能视为全部已确认。')}</section>
${renderMaterials(snapshot.current.layout, '当前方案物料概览')}${snapshot.adopted ? renderMaterials(snapshot.adopted.layout, '采用方案物料概览') : ''}
  <p class="appendix-help">附录默认折叠。需要完整打印时，请先展开附录并核对打印预览；本文件未记录打印验收。</p>
  <details class="appendix"><summary>附录 · 来源、版本与逐件定位</summary>
    <h3>本次文件与资料来源</h3>${para(`来源为项目需求、编辑布局及经允许公开的人工评审记录。仅包含指定白名单，未自动包含原照片、底图、私有模型加载地址、账号、内部工单备注与聊天。\n快照编号：${snapshot.snapshot.id}\n冻结时间：${snapshot.snapshot.generatedAt}\n保存状态：${snapshot.dataState === 'saved' ? '制作者声明已完成保存／读取；本包不证明云端保存' : '未保存草稿'}\n冻结后项目修改不会更新本文件；重用前须由工作台检查来源版本并重新导出。`)}
${table(['版本记录', '原编号／依据'], [['当前编辑方案', snapshot.current.variantId ?? '未记录'], ['采用方案', snapshot.adopted?.record.variantId ?? '未记录'], ...(snapshot.adopted ? [['采用记录来源', snapshot.adopted.record.sourceLabel], ['采用记录时间', snapshot.adopted.record.recordedAt]] : [])])}
${brief ? table(['需求资料标记', '原记录'], [['场地图资料', brief.hasFloorplan === undefined ? '未记录' : brief.hasFloorplan ? '标记有资料，不代表实测或原图已打包' : '标记无资料'], ['允许扩展创意', brief.allowIdeas ? '是，不代表已采用' : '否']]) : ''}
${snapshot.notes.length ? `<h3>人工记录来源与关联</h3>${table(['记录性质', '来源／时间', '对应方案', '关联原编号／复核'], snapshot.notes.map(n => [
      `${noteLabels[n.kind]} · ${kindLabels[n.dataKind]}`, `${n.sourceLabel}\n${n.recordedAt}`, n.target === 'current' ? '当前编辑布局' : `采用版本 ${snapshot.adopted?.record.variantId ?? '未记录'}`, `${n.objectIds.join('、') || '整体'}${n.missingObjectIds.length ? `\n需复核：${n.missingObjectIds.join('、')}` : ''}`,
    ]))}` : ''}
${images.length ? `<h3>画面来源与对应版本</h3>${table(['画面', '来源／捕获时间', '对应方案／快照'], images.map(i => [i.caption, `${i.sourceLabel}\n${i.capturedAt}`, `${i.target === 'current' ? '当前编辑布局' : '已记录采用布局'}\n${i.snapshotId}`]))}` : para('未附加静态捕获；适用布局仅有平面示意，未完成三维画面捕获验收。')}
${renderLayoutAppendix(snapshot.current.layout, '当前编辑布局')}${snapshot.adopted ? renderLayoutAppendix(snapshot.adopted.layout, '已记录采用布局') : ''}</details>
  <footer><p class="text review-id">评审编号：${escape(snapshot.snapshot.id)}</p>${para('资料来源：本项目的需求与布局，以及明确提供的人工记录。本文件仅供方案评审；物料、场地容量与现场条件另行核对。离线文件不会自动取得后续修改或意见。可使用浏览器打印保存为 PDF。')}</footer></main></body></html>`;
}
