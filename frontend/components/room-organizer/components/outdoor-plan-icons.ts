/**
 * 户外 2D 规划图标映射（H4-a）——tokens 登记名 → lucide-react 组件的编译期闭环。
 *
 * 口径（H4-a 卡「Lucide 自绘同风格，不扒 OnePlan 素材」）：
 * - 全部图标取自 lucide-react 1.48 线条图标集，与既有面板同风格；不引入任何 OnePlan 素材。
 * - `PLANNING_ICON_COMPONENTS` 以 `Record<PlanningIconName, LucideIcon>` 声明：
 *   tokens `PLANNING_ICONS` 增删名字时这里必须同步，否则 tsc 直接报错（登记名全部可解析）。
 * - `planningIcon(name)` 提供带回落（shapes）的取用入口，画布组件统一从这里消费，
 *   替代 H3-c 的局部 `LEGEND_ICON_COMPONENTS` 映射。
 */

import {
  BoxSelect,
  ChevronDown,
  ChevronUp,
  Circle,
  Copy,
  DoorOpen,
  Download,
  Hand,
  Hexagon,
  Info,
  Lasso,
  Layers,
  LayoutGrid,
  List,
  Lock,
  LockOpen,
  MapPin,
  Minus,
  Move,
  PenTool,
  Plus,
  Redo2,
  RotateCw,
  Route as RouteIcon,
  Ruler,
  Shapes,
  SlidersHorizontal,
  Square,
  StickyNote,
  Tent,
  Triangle as TriangleShape,
  TriangleAlert,
  Truck,
  Undo2,
  UserPlus,
  Users,
  X,
  type LucideIcon,
} from 'lucide-react';
import type { PlanningIconName } from '@/lib/outdoor-plan-tokens';

/** kebab 登记名 → LucideIcon 组件（与 PLANNING_ICONS 一一对应，编译期强制闭环）。 */
export const PLANNING_ICON_COMPONENTS: Record<PlanningIconName, LucideIcon> = {
  shapes: Shapes,
  hexagon: Hexagon,
  tent: Tent,
  truck: Truck,
  ruler: Ruler,
  route: RouteIcon,
  users: Users,
  'user-plus': UserPlus,
  'door-open': DoorOpen,
  hand: Hand,
  'pen-tool': PenTool,
  move: Move,
  lasso: Lasso,
  layers: Layers,
  'layout-grid': LayoutGrid,
  list: List,
  'triangle-alert': TriangleAlert,
  info: Info,
  'sticky-note': StickyNote,
  'undo-2': Undo2,
  'redo-2': Redo2,
  'map-pin': MapPin,
  download: Download,
  lock: Lock,
  'lock-open': LockOpen,
  'rotate-cw': RotateCw,
  copy: Copy,
  plus: Plus,
  x: X,
  'box-select': BoxSelect,
  'sliders-horizontal': SlidersHorizontal,
  'chevron-up': ChevronUp,
  'chevron-down': ChevronDown,
  square: Square,
  circle: Circle,
  'triangle-shape': TriangleShape,
  minus: Minus,
};

/** 取图标组件：类型上不会越界，回落 shapes 仅作运行时防御。 */
export function planningIcon(name: PlanningIconName): LucideIcon {
  return PLANNING_ICON_COMPONENTS[name] ?? Shapes;
}
