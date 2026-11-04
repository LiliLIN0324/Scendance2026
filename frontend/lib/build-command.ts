import type { FurnitureItem, RoomLayout } from '../components/room-organizer/lib/types';
import { collectViolations } from './placement-rules';
import { layoutFingerprint, fingerprintsEqual } from './layout-fingerprint';

/**
 * M2 Command 门（纯函数层）。
 *
 * PetitMaker 机制：所有会写画布的动作——手动拖拽、AI 预览确认、
 * 键盘/API 批量——在落盘前都包装成同一个 BuildCommand，先做形状校验，
 * 再做前置条件校验（几何合法 + 指纹防旧候选盖新画布）。
 *
 * 本文件只做命令的"形状 + 前置"判定，不执行写入；执行器（M2-B 接线批）
 * 仍由房间组件自己实现，但所有写路径都要从这里过一遍。
 */

/** 合法的命令种类。 */
export type BuildCommandKind =
  | 'place-item'
  | 'move-item'
  | 'update-item'
  | 'remove-item'
  | 'swap-asset'
  | 'apply-layout';

/** 坐标约束（米）。 */
const COORD_MIN = -50;
const COORD_MAX = 50;
/** 单件尺寸约束（米）。 */
const SIZE_MIN = 0.05;
const SIZE_MAX = 20;

/** 单条形状问题。 */
export interface ShapeIssue {
  /** 字段路径，例如 "payload.position.x"。 */
  path: string;
  /** 中文人话描述。 */
  message: string;
}

/** 单条前置条件问题。 */
export interface PreconditionIssue {
  code:
    | 'ITEM_NOT_FOUND'
    | 'OUT_OF_BOUNDS'
    | 'WALL_INTERSECTION'
    | 'BBOX_OVERLAP'
    | 'BASE_FINGERPRINT_MISMATCH'
    | 'FLOOR_OUT_OF_RANGE';
  /** 中文人话描述。 */
  message: string;
  /** 相关 itemId（若有）。 */
  itemId?: string;
}

/** 共同外壳：所有命令都带可选配方 id 与基线指纹。 */
interface CommandBase {
  kind: BuildCommandKind;
  /** 配方 id（来自 recipe.ts 的 8 位 hex）；手动命令可空。 */
  recipeId?: string;
  /**
   * 命令构造那一刻的画布指纹。apply-layout 时若与当前画布不一致，
   * 说明有未保存改动，由调用方决定是否仍执行。
   */
  baseFingerprint?: string;
}

/** 在 floorIndex 这一层放置一件新家具。 */
export interface PlaceItemCommand extends CommandBase {
  kind: 'place-item';
  floorIndex: number;
  item: FurnitureItem;
}

/** 移动已有家具（改 position / rotation）。 */
export interface MoveItemCommand extends CommandBase {
  kind: 'move-item';
  floorIndex: number;
  itemId: string;
  position: { x: number; z: number };
  rotation?: number;
}

/** 更新已有家具的字段（材质、颜色、尺寸等），不动位置。 */
export interface UpdateItemCommand extends CommandBase {
  kind: 'update-item';
  itemId: string;
  patch: Partial<FurnitureItem>;
}

/** 删除已有家具。 */
export interface RemoveItemCommand extends CommandBase {
  kind: 'remove-item';
  itemId: string;
}

/** 把已有家具换成另一资产（拖素材到已放家具上时触发）。 */
export interface SwapAssetCommand extends CommandBase {
  kind: 'swap-asset';
  itemId: string;
  nextAsset: Pick<FurnitureItem, 'assetId' | 'glbUrl' | 'name' | 'type' | 'width' | 'depth' | 'height'>;
}

/** 用一整份新布局替换当前画布（AI 预览确认）。 */
export interface ApplyLayoutCommand extends CommandBase {
  kind: 'apply-layout';
  layout: RoomLayout;
}

export type BuildCommand =
  | PlaceItemCommand
  | MoveItemCommand
  | UpdateItemCommand
  | RemoveItemCommand
  | SwapAssetCommand
  | ApplyLayoutCommand;

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function checkCoord(path: string, value: unknown, issues: ShapeIssue[]): void {
  if (!isFiniteNumber(value)) {
    issues.push({ path, message: `必须是有限数字` });
    return;
  }
  if (value < COORD_MIN || value > COORD_MAX) {
    issues.push({ path, message: `坐标越界：${value} 超出 [${COORD_MIN}, ${COORD_MAX}]` });
  }
}

function checkSize(path: string, value: unknown, issues: ShapeIssue[]): void {
  if (!isFiniteNumber(value)) {
    issues.push({ path, message: `必须是有限数字` });
    return;
  }
  if (value < SIZE_MIN || value > SIZE_MAX) {
    issues.push({ path, message: `尺寸 ${value}m 超出 [${SIZE_MIN}, ${SIZE_MAX}]` });
  }
}

function checkRotation(path: string, value: unknown, issues: ShapeIssue[]): void {
  if (value === undefined) return;
  if (!isFiniteNumber(value)) {
    issues.push({ path, message: `必须是有限数字` });
    return;
  }
  if (value < -Math.PI * 4 || value > Math.PI * 4) {
    issues.push({ path, message: `rotation ${value} 超出常用弧度范围` });
  }
}

function checkItem(path: string, item: unknown, issues: ShapeIssue[]): void {
  if (!item || typeof item !== 'object') {
    issues.push({ path, message: `item 必须是对象` });
    return;
  }
  const it = item as Partial<FurnitureItem>;
  if (typeof it.id !== 'string' || it.id.length === 0) {
    issues.push({ path: `${path}.id`, message: `id 不能为空` });
  }
  if (typeof it.name !== 'string' || it.name.length === 0) {
    issues.push({ path: `${path}.name`, message: `name 不能为空` });
  }
  checkSize(`${path}.width`, it.width, issues);
  checkSize(`${path}.depth`, it.depth, issues);
  checkSize(`${path}.height`, it.height, issues);
  if (it.position) {
    checkCoord(`${path}.position.x`, it.position.x, issues);
    checkCoord(`${path}.position.z`, it.position.z, issues);
  }
  checkRotation(`${path}.rotation`, it.rotation, issues);
}

/**
 * 阶段一：形状校验。不看当前画布，只看命令本身是不是格式正确。
 */
export function validateCommandShape(cmd: BuildCommand): ShapeIssue[] {
  const issues: ShapeIssue[] = [];
  switch (cmd.kind) {
    case 'place-item':
      if (!Number.isInteger(cmd.floorIndex) || cmd.floorIndex < 0) {
        issues.push({ path: 'floorIndex', message: `floorIndex 必须是非负整数` });
      }
      checkItem('item', cmd.item, issues);
      break;
    case 'move-item':
      if (!Number.isInteger(cmd.floorIndex) || cmd.floorIndex < 0) {
        issues.push({ path: 'floorIndex', message: `floorIndex 必须是非负整数` });
      }
      if (typeof cmd.itemId !== 'string' || cmd.itemId.length === 0) {
        issues.push({ path: 'itemId', message: `itemId 不能为空` });
      }
      checkCoord('position.x', cmd.position.x, issues);
      checkCoord('position.z', cmd.position.z, issues);
      checkRotation('rotation', cmd.rotation, issues);
      break;
    case 'update-item':
      if (typeof cmd.itemId !== 'string' || cmd.itemId.length === 0) {
        issues.push({ path: 'itemId', message: `itemId 不能为空` });
      }
      if (!cmd.patch || typeof cmd.patch !== 'object' || Object.keys(cmd.patch).length === 0) {
        issues.push({ path: 'patch', message: `patch 不能为空` });
      }
      break;
    case 'remove-item':
      if (typeof cmd.itemId !== 'string' || cmd.itemId.length === 0) {
        issues.push({ path: 'itemId', message: `itemId 不能为空` });
      }
      break;
    case 'swap-asset':
      if (typeof cmd.itemId !== 'string' || cmd.itemId.length === 0) {
        issues.push({ path: 'itemId', message: `itemId 不能为空` });
      }
      checkSize('nextAsset.width', cmd.nextAsset.width, issues);
      checkSize('nextAsset.depth', cmd.nextAsset.depth, issues);
      if (typeof cmd.nextAsset.name !== 'string' || cmd.nextAsset.name.length === 0) {
        issues.push({ path: 'nextAsset.name', message: `name 不能为空` });
      }
      break;
    case 'apply-layout': {
      const layout = cmd.layout as unknown;
      if (!layout || typeof layout !== 'object') {
        issues.push({ path: 'layout', message: `layout 必须是对象` });
        break;
      }
      const l = layout as { floors?: unknown };
      if (!Array.isArray(l.floors) || l.floors.length === 0) {
        issues.push({ path: 'layout.floors', message: `floors 必须是非空数组` });
      }
      break;
    }
  }
  return issues;
}

/** 执行前置校验时所需的最小上下文。 */
export interface CommandContext {
  /** 当前画布。 */
  layout: RoomLayout;
}

/** 把 placement-rules 的违规码映射到 Command 门的前置问题码。 */
function mapViolationCode(code: string): PreconditionIssue['code'] {
  switch (code) {
    case 'OUT_OF_BOUNDS':
      return 'OUT_OF_BOUNDS';
    case 'WALL_INTERSECTION':
      return 'WALL_INTERSECTION';
    default:
      return 'BBOX_OVERLAP';
  }
}

function findItemOnLayout(layout: RoomLayout, itemId: string): { item: FurnitureItem; floorIndex: number } | null {
  for (let fi = 0; fi < layout.floors.length; fi++) {
    const hit = layout.floors[fi]!.items.find((it) => it.id === itemId);
    if (hit) return { item: hit, floorIndex: fi };
  }
  return null;
}

/**
 * 阶段二：前置条件校验。形状没问题之后，再看这条命令在当前画布里能不能执行。
 *
 * - 几何类（place-item / move-item）复用 placement-rules 的硬伤判据。
 * - apply-layout 比对 baseFingerprint：不一致说明画布已被改动。
 * - 其它 kind 只校验 item 是否存在。
 */
export function validateCommandPreconditions(cmd: BuildCommand, ctx: CommandContext): PreconditionIssue[] {
  const issues: PreconditionIssue[] = [];
  const { layout } = ctx;

  switch (cmd.kind) {
    case 'place-item': {
      if (!layout.floors[cmd.floorIndex]) {
        issues.push({ code: 'FLOOR_OUT_OF_RANGE', message: `第 ${cmd.floorIndex} 层不存在` });
        break;
      }
      // 把 candidate 临时塞进去跑全量违规；只要违规清单里有任何一条牵到 candidate.id，就拒绝。
      // （placement-rules 内部对重叠对按 id 字典序挂记，单问 candidate 合法性时可能漏掉，
      //  所以这里用 trial 全扫而不是只看 isPlacementLegal。）
      const trial: RoomLayout = {
        ...layout,
        floors: layout.floors.map((f, i) =>
          i === cmd.floorIndex
            ? { ...f, items: [...f.items.filter((it) => it.id !== cmd.item.id), cmd.item] }
            : f,
        ),
      };
      const trialViolations = collectViolations(trial, { floorIndex: cmd.floorIndex });
      const hit = trialViolations.find(
        (v) => v.itemId === cmd.item.id || v.targetId === cmd.item.id,
      );
      if (hit) {
        issues.push({
          code: mapViolationCode(hit.code),
          itemId: cmd.item.id,
          message: `「${cmd.item.name}」落点不合法：${hit.detail}`,
        });
      }
      break;
    }
    case 'move-item': {
      const found = findItemOnLayout(layout, cmd.itemId);
      if (!found) {
        issues.push({ code: 'ITEM_NOT_FOUND', itemId: cmd.itemId, message: `找不到家具「${cmd.itemId}」` });
        break;
      }
      if (!layout.floors[cmd.floorIndex]) {
        issues.push({ code: 'FLOOR_OUT_OF_RANGE', message: `第 ${cmd.floorIndex} 层不存在` });
        break;
      }
      const candidate: FurnitureItem = {
        ...found.item,
        position: { x: cmd.position.x, z: cmd.position.z },
        rotation: cmd.rotation ?? found.item.rotation ?? 0,
      };
      // 在临时 layout 上做合法性判定：先把原 item 摘掉，再放候选，跑全量违规。
      const trial: RoomLayout = {
        ...layout,
        floors: layout.floors.map((f, i) =>
          i === cmd.floorIndex
            ? { ...f, items: [...f.items.filter((it) => it.id !== cmd.itemId), candidate] }
            : f,
        ),
      };
      const trialViolations = collectViolations(trial, { floorIndex: cmd.floorIndex });
      const hit = trialViolations.find(
        (v) => v.itemId === cmd.itemId || v.targetId === cmd.itemId,
      );
      if (hit) {
        issues.push({
          code: mapViolationCode(hit.code),
          itemId: cmd.itemId,
          message: `移到该位置后不合法：${hit.detail}`,
        });
      }
      break;
    }
    case 'update-item':
    case 'remove-item':
    case 'swap-asset': {
      if (!findItemOnLayout(layout, cmd.itemId)) {
        issues.push({ code: 'ITEM_NOT_FOUND', itemId: cmd.itemId, message: `找不到家具「${cmd.itemId}」` });
      }
      break;
    }
    case 'apply-layout': {
      if (cmd.baseFingerprint !== undefined) {
        const current = layoutFingerprint(layout);
        if (!fingerprintsEqual(current, cmd.baseFingerprint)) {
          issues.push({
            code: 'BASE_FINGERPRINT_MISMATCH',
            message: `画布指纹已变化（基线 ${cmd.baseFingerprint} ≠ 当前 ${current}），可能覆盖未保存的改动`,
          });
        }
      }
      break;
    }
  }
  return issues;
}

/**
 * 把命令压成一句中文，给日志 / Bingo 报告用。
 */
export function summarizeCommand(cmd: BuildCommand): string {
  switch (cmd.kind) {
    case 'place-item':
      return `放置「${cmd.item.name}」到第 ${cmd.floorIndex + 1} 层`;
    case 'move-item':
      return `移动家具 ${cmd.itemId} 到 (${cmd.position.x.toFixed(2)}, ${cmd.position.z.toFixed(2)})`;
    case 'update-item':
      return `更新家具 ${cmd.itemId} 的字段（${Object.keys(cmd.patch).join('、')}）`;
    case 'remove-item':
      return `删除家具 ${cmd.itemId}`;
    case 'swap-asset':
      return `把 ${cmd.itemId} 换成「${cmd.nextAsset.name}」`;
    case 'apply-layout':
      return `整体替换为新布局（${cmd.layout.floors.reduce((n, f) => n + f.items.length, 0)} 件）`;
  }
}

/* ---------- 轻量工厂：调用方不用手拼可辨识联合。 ---------- */

export function placeItemCommand(p: Omit<PlaceItemCommand, 'kind'>): PlaceItemCommand {
  return { ...p, kind: 'place-item' };
}
export function moveItemCommand(p: Omit<MoveItemCommand, 'kind'>): MoveItemCommand {
  return { ...p, kind: 'move-item' };
}
export function updateItemCommand(p: Omit<UpdateItemCommand, 'kind'>): UpdateItemCommand {
  return { ...p, kind: 'update-item' };
}
export function removeItemCommand(p: Omit<RemoveItemCommand, 'kind'>): RemoveItemCommand {
  return { ...p, kind: 'remove-item' };
}
export function swapAssetCommand(p: Omit<SwapAssetCommand, 'kind'>): SwapAssetCommand {
  return { ...p, kind: 'swap-asset' };
}
export function applyLayoutCommand(p: Omit<ApplyLayoutCommand, 'kind'>): ApplyLayoutCommand {
  return { ...p, kind: 'apply-layout' };
}
