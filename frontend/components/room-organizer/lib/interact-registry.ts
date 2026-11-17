import type { PersonAction } from './types';

/**
 * E 键交互 —— 注册表与近邻探测纯函数层（一期零新增依赖）。
 *
 * 设计口径见 `.temp/research-D-interaction-system.md`：注册表条目 + 距离球预筛 +
 * （场景层）中心射线回查 userData + 激活切片 + DOM 提示卡。本模块只放不依赖 three
 * 运行时实例的数据结构与纯计算，便于单测；three 对象根的挂载、射线拾取、高亮、
 * 提示 UI 与 E 键触发挂在场景 / hook 层。
 *
 * 坐标系：条目 `position` 是世界坐标快照（x 东、y 上、z 北，单位米），由场景层在
 * 模型落位成功后写入；人物走动后由场景层失效旧快照。缺位置的条目不参与距离筛选。
 */

export type InteractableKind = 'facility' | 'scene-object' | 'npc' | 'crowd' | 'seat';

/** 一期交互键固定 E（旧室内坐姿 F 键随壳体退役，不复活）。 */
export const INTERACT_ACTION_KEY = 'E' as const;

/** 单条目近邻默认半径（米）。 */
export const DEFAULT_INTERACT_DISTANCE = 2.2;

export interface InteractablePosition {
  x: number;
  y: number;
  z: number;
}

/** seat 条目携带的落座元数据（ENU 落点 + 坐面高 + 坐姿眼高），由场景层换算世界坐标。 */
export interface SeatInteractInfo {
  x: number;
  y: number;
  rotationDeg: number;
  seatHeight: number;
  eyeY: number;
}

/** 注册表条目：与 plan 数据对齐的稳定 id；元数据用于提示卡。 */
export interface InteractableEntry {
  /** facilityId / sceneObjectId / `${workerId}#${index}`。 */
  id: string;
  kind: InteractableKind;
  /** 提示主文案，如「签到岗亭」。 */
  label: string;
  /** 提示副标题（岗位 / 说明），可空。 */
  subtitle?: string | undefined;
  actionKey: typeof INTERACT_ACTION_KEY;
  /** 近邻半径（米），缺省 {@link DEFAULT_INTERACT_DISTANCE}。 */
  maxDistance: number;
  /** 关闭后不参与探测与触发（二期按岗位状态 / 活动阶段禁用）。 */
  enabled: boolean;
  /** 世界坐标快照；null / 缺省表示暂无可测距位置。 */
  position?: InteractablePosition | undefined;
  /** kind === 'seat' 时填：落座点 / 坐面高 / 眼高。 */
  seat?: SeatInteractInfo | undefined;
  /** 命中时建议播放的人物动作；缺省表示只提示、不播动作。 */
  personAction?: PersonAction | undefined;
}

/** E 键触发上下文：回调只拿条目与必要的只读快照，不直接碰 three 场景结构。 */
export interface InteractableContext {
  entry: InteractableEntry;
}

export type InteractAction = (ctx: InteractableContext) => void;

/** 构造一条带缺省值的条目。 */
export function makeInteractableEntry(
  entry: Omit<InteractableEntry, 'actionKey' | 'maxDistance' | 'enabled'> & Partial<Pick<InteractableEntry, 'maxDistance' | 'enabled'>>,
): InteractableEntry {
  return {
    actionKey: INTERACT_ACTION_KEY,
    maxDistance: DEFAULT_INTERACT_DISTANCE,
    enabled: true,
    ...entry,
  };
}

/** 两点世界距离（米）。 */
export function distance3(a: InteractablePosition, b: InteractablePosition): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * 距离球预筛：只保留启用、有位置、且在条目自身半径（与外部可达上限取小）内的条目。
 * `reach` 是玩家 / 相机到可交互物的全局可达上限；不传则只用条目自身半径。
 */
export function nearbyEntries(
  entries: readonly InteractableEntry[],
  player: InteractablePosition,
  reach?: number,
): InteractableEntry[] {
  return entries
    .filter((entry) => {
      if (!entry.enabled || !entry.position) return false;
      const limit = reach === undefined ? entry.maxDistance : Math.min(entry.maxDistance, reach);
      return distance3(entry.position, player) <= limit;
    })
    .sort((a, b) => {
      const da = distance3(a.position!, player);
      const db = distance3(b.position!, player);
      return da - db;
    });
}

/** 预筛后最近的一条；无候选返回 null。 */
export function nearestNearbyEntry(
  entries: readonly InteractableEntry[],
  player: InteractablePosition,
  reach?: number,
): InteractableEntry | null {
  return nearbyEntries(entries, player, reach)[0] ?? null;
}

/**
 * 可交互物注册表：id → 条目 + id → 动作回调分离。
 * 生命周期：模型落位成功后 `register`；卸载 / 代际失效 / cleanup 时 `deregister`。
 * 异步晚到模型必须过场景层的 disposed / 代际守卫再登记。
 */
export class InteractRegistry {
  private readonly entries = new Map<string, InteractableEntry>();
  private readonly actions = new Map<string, InteractAction>();

  register(entry: InteractableEntry, action?: InteractAction): void {
    this.entries.set(entry.id, entry);
    if (action) this.actions.set(entry.id, action);
  }

  deregister(id: string): void {
    this.entries.delete(id);
    this.actions.delete(id);
  }

  clear(): void {
    this.entries.clear();
    this.actions.clear();
  }

  get(id: string): InteractableEntry | undefined {
    return this.entries.get(id);
  }

  actionFor(id: string): InteractAction | undefined {
    return this.actions.get(id);
  }

  /** 全量条目；可按图层 kind 过滤。 */
  list(kind?: InteractableKind): InteractableEntry[] {
    const all = [...this.entries.values()];
    return kind ? all.filter(entry => entry.kind === kind) : all;
  }

  get size(): number {
    return this.entries.size;
  }
}
