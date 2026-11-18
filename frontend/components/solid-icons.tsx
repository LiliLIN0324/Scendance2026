import { forwardRef, useId, type HTMLAttributes } from 'react';
import { MaterialSymbol } from '@/components/room-organizer/panels/material-symbol';

export interface SolidIconProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'children'> {
  size?: number;
  strokeWidth?: number;
  absoluteStrokeWidth?: boolean;
  color?: string;
  fill?: string;
  active?: boolean;
}
export type SolidIconComponent = (props: SolidIconProps) => JSX.Element;

function makeSolidIcon(name: string): SolidIconComponent {
  return function SolidIcon({ size = 20, color, style, ...props }: SolidIconProps): JSX.Element {
    return <MaterialSymbol name={name} size={size} style={{ ...style, ...(color ? { color } : {}) }} {...props} />;
  };
}

export const AlertTriangle = makeSolidIcon('warning');
export const ArrowLeft = makeSolidIcon('arrow_back');
export const ArrowLeftRight = makeSolidIcon('swap_horiz');
export const ArrowRight = makeSolidIcon('arrow_forward');
export const ArrowUp = makeSolidIcon('arrow_upward');
export const ArrowUpDown = makeSolidIcon('swap_vert');
export const ArrowUpRight = makeSolidIcon('north_east');
export const BookOpen = makeSolidIcon('menu_book');
export const Box = makeSolidIcon('inventory_2');
export const Boxes = makeSolidIcon('widgets');
export const BrickWall = makeSolidIcon('brick');
export const Building2 = makeSolidIcon('corporate_fare');
export const Camera = makeSolidIcon('photo_camera');
export const Check = makeSolidIcon('check');
export const ChevronDown = makeSolidIcon('keyboard_arrow_down');
export const ChevronRight = makeSolidIcon('chevron_right');
export const ChevronUp = makeSolidIcon('keyboard_arrow_up');
export const ClipboardCheck = makeSolidIcon('assignment_turned_in');
export const ClipboardList = makeSolidIcon('assignment');
export const Clock = makeSolidIcon('schedule');
export const Compass = makeSolidIcon('explore');
export const Copy = makeSolidIcon('content_copy');
export const Crown = makeSolidIcon('workspace_premium');
export const DoorOpen = makeSolidIcon('door_open');
export const Download = makeSolidIcon('download');
export const ExternalLink = makeSolidIcon('open_in_new');
export const Eye = makeSolidIcon('visibility');
export const FileDown = makeSolidIcon('file_save');
export const FileImage = makeSolidIcon('image');
export const FolderOpen = makeSolidIcon('folder_open');
export const Globe = makeSolidIcon('public');
export const HelpCircle = makeSolidIcon('help');
export const Home = makeSolidIcon('home');
export const Image = makeSolidIcon('image');
export const ImagePlus = makeSolidIcon('add_photo_alternate');
export const Images = makeSolidIcon('photo_library');
export const Inbox = makeSolidIcon('inbox');
export const Info = makeSolidIcon('info');
export const KeyRound = makeSolidIcon('key');
export const Layers = makeSolidIcon('layers');
export const Layers3 = makeSolidIcon('layers');
export const LayoutGrid = makeSolidIcon('grid_view');
export const LayoutTemplate = makeSolidIcon('dashboard_customize');
export const Link2 = makeSolidIcon('link');
export const Loader2 = makeSolidIcon('progress_activity');
export const Lock = makeSolidIcon('lock');
export const LockKeyhole = makeSolidIcon('lock_person');
export const Map = makeSolidIcon('map');
export const MapPin = makeSolidIcon('location_on');
export const Pin = makeSolidIcon('push_pin');
export const Maximize2 = makeSolidIcon('fullscreen');
export const MessageCirclePlus = makeSolidIcon('add_comment');
export const MessageSquare = makeSolidIcon('chat');
export const Minimize2 = makeSolidIcon('fullscreen_exit');
export const Minus = makeSolidIcon('remove');
export const MoreHorizontal = makeSolidIcon('more_horiz');
export const Mountain = makeSolidIcon('landscape');
export const MousePointerClick = makeSolidIcon('ads_click');
export const PackageOpen = makeSolidIcon('inventory_2');
export const Palette = makeSolidIcon('palette');
export const PanelLeftClose = makeSolidIcon('left_panel_close');
export const Paperclip = makeSolidIcon('attach_file');
export const PenTool = makeSolidIcon('draw');
export const Pencil = makeSolidIcon('edit');
export const PencilLine = makeSolidIcon('edit_note');
export const Plus = makeSolidIcon('add');
export const QrCode = makeSolidIcon('qr_code_2');
export const RefreshCw = makeSolidIcon('autorenew');
export const RotateCcw = makeSolidIcon('replay');
export const RotateCw = makeSolidIcon('refresh');
export const Ruler = makeSolidIcon('straighten');
export const Satellite = makeSolidIcon('satellite');
export const Scan = makeSolidIcon('document_scanner');
export const Search = makeSolidIcon('iconpark_search_solid');
export const Settings = makeSolidIcon('settings');
export const Settings2 = makeSolidIcon('tune');
export const ShieldCheck = makeSolidIcon('verified_user');
export const SlidersHorizontal = makeSolidIcon('tune');
export const Sparkles = makeSolidIcon('wand_stars');
export const Square = makeSolidIcon('crop_square');
export const SquareDashed = makeSolidIcon('select_all');
export const Star = makeSolidIcon('star');
export const Tag = makeSolidIcon('sell');
export const Timer = makeSolidIcon('timer');
export const Trash = makeSolidIcon('delete');
export const Trash2 = makeSolidIcon('delete');
export const TriangleAlert = makeSolidIcon('warning');
export const Type = makeSolidIcon('text_fields');
export const Unlock = makeSolidIcon('lock_open');
export const Upload = makeSolidIcon('upload');
export const UserPlus = makeSolidIcon('person_add');
export const UserRound = makeSolidIcon('person');
export const Users = makeSolidIcon('group');
export const UsersRound = makeSolidIcon('groups');
export const Video = makeSolidIcon('videocam');
export const X = makeSolidIcon('close');

/**
 * 左轨自绘标记（2026-11-18 补救）。
 * 四枚工具标与 Bingo 环同为 24 网格。未选中：单线 1.65、圆端、`--ink-soft`，形状完整。
 * 选中：图标填 `#141416`，细节留纸色 `#FFFFFF`。不再靠轨钮左缘绿条。
 * 门厅不参与反黑，始终实心 `--green-deep`。右下角也不再加品牌句点。
 */
export const RAIL_STROKE = 1.65;
export const RAIL_SELECTED = '#141416';
export const RAIL_PAPER = '#FFFFFF';

const RAIL_INK = 'var(--ink-soft, #55585F)';

/**
 * 户外：完整外环。左上小、右下大，适中缝 2.0。
 * d = r_s + r_l + gap。沿 45°（u = √0.5）按面积配重：
 * t_s = d · r_l² / (r_s² + r_l²)，t_l = d − t_s。
 * 小圆在 (12 − t_s·u, 12 − t_s·u)，大圆在 (12 + t_l·u, 12 + t_l·u)。
 * 大圆更靠近环心。外环不开口。
 */
const RAIL_OUTDOOR_SMALL_R = 2.05;
const RAIL_OUTDOOR_LARGE_R = 3.45;
const RAIL_OUTDOOR_GAP = 2;
const RAIL_OUTDOOR_DISTANCE = RAIL_OUTDOOR_SMALL_R + RAIL_OUTDOOR_LARGE_R + RAIL_OUTDOOR_GAP;
const RAIL_OUTDOOR_SMALL_TRAVEL = RAIL_OUTDOOR_DISTANCE * (RAIL_OUTDOOR_LARGE_R ** 2)
  / (RAIL_OUTDOOR_SMALL_R ** 2 + RAIL_OUTDOOR_LARGE_R ** 2);
const RAIL_OUTDOOR_LARGE_TRAVEL = RAIL_OUTDOOR_DISTANCE - RAIL_OUTDOOR_SMALL_TRAVEL;
const RAIL_OUTDOOR_UNIT = Math.SQRT1_2;

export const RAIL_OUTDOOR = {
  ring: { cx: 12, cy: 12, r: 9.2 },
  small: {
    cx: 12 - RAIL_OUTDOOR_SMALL_TRAVEL * RAIL_OUTDOOR_UNIT,
    cy: 12 - RAIL_OUTDOOR_SMALL_TRAVEL * RAIL_OUTDOOR_UNIT,
    r: RAIL_OUTDOOR_SMALL_R,
  },
  large: {
    cx: 12 + RAIL_OUTDOOR_LARGE_TRAVEL * RAIL_OUTDOOR_UNIT,
    cy: 12 + RAIL_OUTDOOR_LARGE_TRAVEL * RAIL_OUTDOOR_UNIT,
    r: RAIL_OUTDOOR_LARGE_R,
  },
  gap: RAIL_OUTDOOR_GAP,
} as const;

/**
 * 门厅脸：与 `door.png` 同一张脸，收成 28 网格以便在 28px 上清晰。
 * 右眼略高、略长；眼睛与底部门洞都是纸色镂空，不是另画的瞳孔。
 * 眼洞单独成组，以便 `--eye-x` / `--eye-y` 平移；整张脸用 `--tilt-*` 侧倾。
 * 始终实心 `--green-deep`，选中不改线框、不把门洞闭上。
 */
export const RAIL_HALL = {
  fill: 'var(--green-deep, #35624A)',
  eyes: {
    left: { cx: 11.98, cy: 10.14, rx: 1.19, ry: 2.31 },
    right: { cx: 17.25, cy: 9.58, rx: 1.26, ry: 2.52 },
  },
} as const;

/** 圆角方块轮廓把底部门洞让开。门洞是轮廓缺口，不是另挖的洞。 */
const RAIL_HALL_BODY = [
  'M 9.15 1.75 H 18.63',
  'A 7.4 7.4 0 0 1 26.03 9.15 V 18.63',
  'A 7.4 7.4 0 0 1 18.63 26.03 H 17.28 V 19.58',
  'C 17.28 17.71 15.76 16.19 13.89 16.19',
  'C 12.02 16.19 10.5 17.71 10.5 19.58',
  'V 26.03 H 9.15',
  'A 7.4 7.4 0 0 1 1.75 18.63 V 9.15',
  'A 7.4 7.4 0 0 1 9.15 1.75 Z',
].join(' ');

const RAIL_HALL_EYE_LEFT = [
  'M 13.16 10.30 C 12.98 11.56 12.31 12.51 11.66 12.42',
  'C 11.01 12.33 10.63 11.23 10.81 9.97',
  'C 10.98 8.71 11.65 7.76 12.31 7.85',
  'C 12.96 7.94 13.34 9.04 13.16 10.30 Z',
].join(' ');

const RAIL_HALL_EYE_RIGHT = [
  'M 18.50 9.75 C 18.30 11.13 17.59 12.17 16.90 12.07',
  'C 16.21 11.97 15.81 10.78 16.00 9.40',
  'C 16.19 8.02 16.91 6.98 17.60 7.08',
  'C 18.29 7.18 18.69 8.37 18.50 9.75 Z',
].join(' ');

/** 静息时与原先 evenodd 脸同一张：身体 + 两只眼洞。眼洞拆出以便跟着指针走。 */
export const RAIL_HALL_FACE = [RAIL_HALL_BODY, RAIL_HALL_EYE_LEFT, RAIL_HALL_EYE_RIGHT].join(' ');

export const RailHall = forwardRef<HTMLSpanElement, { size?: number }>(function RailHall({ size = 28 }, ref) {
  const maskId = `sc-rail-hall-${useId().replace(/:/g, '')}`;
  return (
    <span ref={ref} className="sc-rail-avatar is-door" style={{ width: size, height: size }}>
      <span className="sc-rail-avatar-tilt">
        <svg className="sc-rail-hall" width={size} height={size} viewBox="0 0 28 28" aria-hidden="true" focusable="false" style={{ display: 'block' }}>
          <defs>
            <mask id={maskId} maskUnits="userSpaceOnUse" x="0" y="0" width="28" height="28">
              <rect width="28" height="28" fill="#fff" />
              <g className="sc-rail-hall-eyes">
                <path d={RAIL_HALL_EYE_LEFT} fill="#000" />
                <path d={RAIL_HALL_EYE_RIGHT} fill="#000" />
              </g>
            </mask>
          </defs>
          <path fill={RAIL_HALL.fill} d={RAIL_HALL_BODY} mask={`url(#${maskId})`} />
        </svg>
      </span>
    </span>
  );
});

function makeCustomIcon(render: (size: number, active: boolean) => JSX.Element): SolidIconComponent {
  return function CustomIcon({ size = 20, active = false, color, style, ...props }: SolidIconProps): JSX.Element {
    return (
      <span
        data-rail-active={active ? 'true' : 'false'}
        style={{ display: 'inline-flex', flex: 'none', color: active ? RAIL_SELECTED : (color ?? RAIL_INK), ...style }}
        {...props}
      >
        {render(size, active)}
      </span>
    );
  };
}

const railPen = {
  fill: 'none' as const,
  stroke: 'currentColor',
  strokeWidth: RAIL_STROKE,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

function filledShape(active: boolean) {
  return active
    ? { fill: RAIL_SELECTED, stroke: 'none' }
    : railPen;
}

/** 空间：2×2 四间完整圆角房间。选中填墨，不另加描边，也不在房间之间开装饰缝。 */
const RAIL_SPACE_ROOMS = [
  { x: 4, y: 4 },
  { x: 13, y: 4 },
  { x: 4, y: 13 },
  { x: 13, y: 13 },
] as const;

export const RailSpace = makeCustomIcon((size, active) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    {RAIL_SPACE_ROOMS.map(room => (
      <rect key={`${room.x}-${room.y}`} x={room.x} y={room.y} width={7} height={7} rx={2} {...filledShape(active)} />
    ))}
  </svg>
));

/** 物料：盖贴在盒身上的收纳箱。选中两块都填墨，接缝留一条纸色发丝线。 */
export const RAIL_CRATE_LID = 'M4.6 9.35 L5.35 6.55 Q5.5 5.9 6.2 5.9 H17.8 Q18.5 5.9 18.65 6.55 L19.4 9.35 Z';
export const RAIL_CRATE_SEAM = 'M5.1 9.35 H18.9';

export const RailCrate = makeCustomIcon((size, active) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d={RAIL_CRATE_LID} {...filledShape(active)} />
    <rect x={5.1} y={9.35} width={13.8} height={10.15} rx={2} {...filledShape(active)} />
    {active ? <path d={RAIL_CRATE_SEAM} fill="none" stroke={RAIL_PAPER} strokeWidth={1.55} /> : null}
  </svg>
));

/** 场地：圆角方块加完整加号。选中方块填墨，加号留纸色。 */
export const RAIL_PLUS_MARK = 'M12 8.15 V15.85 M8.15 12 H15.85';

export const RailPlus = makeCustomIcon((size, active) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <rect x={3.9} y={3.9} width={16.2} height={16.2} rx={3.6} {...filledShape(active)} />
    <path
      d={RAIL_PLUS_MARK}
      fill="none"
      stroke={active ? RAIL_PAPER : 'currentColor'}
      strokeWidth={active ? 1.7 : RAIL_STROKE}
      strokeLinecap="round"
    />
  </svg>
));

/** 户外：完整外环，左上小、右下大，适中缝 2.0。选中外环填墨，两枚大陆留纸色。外环不开口。 */
export const RailMap = makeCustomIcon((size, active) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <circle cx={RAIL_OUTDOOR.ring.cx} cy={RAIL_OUTDOOR.ring.cy} r={RAIL_OUTDOOR.ring.r} {...filledShape(active)} />
    <circle
      cx={RAIL_OUTDOOR.small.cx}
      cy={RAIL_OUTDOOR.small.cy}
      r={RAIL_OUTDOOR.small.r}
      {...(active ? { fill: RAIL_PAPER, stroke: 'none' } : railPen)}
    />
    <circle
      cx={RAIL_OUTDOOR.large.cx}
      cy={RAIL_OUTDOOR.large.cy}
      r={RAIL_OUTDOOR.large.r}
      {...(active ? { fill: RAIL_PAPER, stroke: 'none' } : railPen)}
    />
  </svg>
));
