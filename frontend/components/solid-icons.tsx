import type { HTMLAttributes } from 'react';
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
 * 左轨工具图标共用一档：24 网格、描边 1.6、外接盒 3.25–20.75。
 * 选中不改填充，只靠轨道的淡绿底和左缘绿条，避免一枚变实心、一枚仍是线。
 */
const RAIL_STROKE = 1.6;

function makeCustomIcon(render: (size: number) => JSX.Element): SolidIconComponent {
  return function CustomIcon({ size = 20, active = false, color, style, className, ...props }: SolidIconProps): JSX.Element {
    return (
      <span
        className={['sc-rail-glyph', className].filter(Boolean).join(' ')}
        data-active={active ? 'true' : 'false'}
        style={{ display: 'inline-flex', flex: 'none', ...(color ? { color } : {}), ...style }}
        {...props}
      >
        {render(size)}
      </span>
    );
  };
}

function railSvg(size: number, children: JSX.Element | JSX.Element[]): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true"
      fill="none" stroke="currentColor" strokeWidth={RAIL_STROKE}
      strokeLinejoin="round" strokeLinecap="round">
      {children}
    </svg>
  );
}

/** 空间：四块等大圆角方。外接盒仍是 3.25–20.75，与加号圆、双圆外沿对齐；块间缝按描边外沿留 1.4，四块不会糊成一格。 */
export const RailSpace = makeCustomIcon((size) => railSvg(size, [
  <rect key="a" x="3.25" y="3.25" width="7.25" height="7.25" rx="1.25" />,
  <rect key="b" x="13.5" y="3.25" width="7.25" height="7.25" rx="1.25" />,
  <rect key="c" x="3.25" y="13.5" width="7.25" height="7.25" rx="1.25" />,
  <rect key="d" x="13.5" y="13.5" width="7.25" height="7.25" rx="1.25" />,
]));

/** 物料：公文包。提手顶、箱体底与宫格外接盒对齐，中缝只画在箱内。 */
export const RailCrate = makeCustomIcon((size) => railSvg(size, [
  <rect key="body" x="3.25" y="8.05" width="17.5" height="12.7" rx="2" />,
  <path key="handle" d="M9.2 8.05V5.05a1.8 1.8 0 0 1 1.8-1.8h2a1.8 1.8 0 0 1 1.8 1.8V8.05" />,
  <path key="seam" d="M6.15 12.55h11.7" />,
]));

/** 场地：与户外同一外圆，加号停在圆内，端点 round。选中仍是同一描边。 */
export const RailPlus = makeCustomIcon((size) => railSvg(size, [
  <circle key="ring" cx="12" cy="12" r="8.75" />,
  <path key="plus" d="M12 7.7v8.6M7.7 12h8.6" />,
]));

/** 户外：外圆与加号同径，两枚等大圆沿对角线分开，不互相压住。 */
export const RailMap = makeCustomIcon((size) => railSvg(size, [
  <circle key="planet" cx="12" cy="12" r="8.75" />,
  <circle key="nw" cx="9.2" cy="9.2" r="2.2" />,
  <circle key="se" cx="14.8" cy="14.8" r="2.2" />,
]));
