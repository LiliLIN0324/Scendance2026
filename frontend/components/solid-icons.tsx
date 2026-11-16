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

/** 自绘左轨工具图标：不走 Material 字形，24 网格、currentColor、paper 镂空。 */
function makeCustomIcon(render: (size: number, active: boolean) => JSX.Element): SolidIconComponent {
  return function CustomIcon({ size = 20, active = false, color, style, ...props }: SolidIconProps): JSX.Element {
    return (
      <span style={{ display: 'inline-flex', flex: 'none', ...(color ? { color } : {}), ...(active ? { color: '#141416' } : {}), ...style }} {...props}>
        {render(size, active)}
      </span>
    );
  };
}

/** 空间（S01）：四块独立圆角矩形 2×2，块间留缝，表达分区/房间。常态描边，激活实心。 */
export const RailSpace = makeCustomIcon((size, active) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true"
    fill={active ? 'currentColor' : 'none'}
    stroke={active ? 'none' : 'currentColor'}
    strokeWidth="1.8" strokeLinejoin="round">
    <rect x="3.5" y="3.5" width="7.5" height="7.5" rx="1.5"/>
    <rect x="13" y="3.5" width="7.5" height="7.5" rx="1.5"/>
    <rect x="3.5" y="13" width="7.5" height="7.5" rx="1.5"/>
    <rect x="13" y="13" width="7.5" height="7.5" rx="1.5"/>
  </svg>
));

/** 物料（M11d）：箱体 + 顶部拱形提手。常态描边，激活实心、提手以白负形弧留在最上层。 */
export const RailCrate = makeCustomIcon((size, active) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true"
    fill={active ? 'currentColor' : 'none'}
    stroke={active ? 'none' : 'currentColor'}
    strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round">
    {active
      ? <>
          <rect x="3.4" y="7.0" width="17.2" height="12.6" rx="2.4"/>
          <path d="M8.8 7.5 a3.2 3.2 0 0 1 6.4 0" stroke="#FFFFFF" strokeWidth="1.7" fill="none"/>
        </>
      : <>
          <path d="M8.8 7.5 a3.2 3.2 0 0 1 6.4 0"/>
          <rect x="3.5" y="7.5" width="17" height="12.5" rx="2.2"/>
        </>}
  </svg>
));

/** 场地（新建/生成功能区）：圆形容器包裹居中加号，表达新建一块可布置场地；24 网格、round 端点，圆径与户外星球同口径。常态圆与加号描边，激活圆实心、加号反白负形。 */
export const RailPlus = makeCustomIcon((size, active) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true"
    fill={active ? 'currentColor' : 'none'}
    stroke={active ? 'none' : 'currentColor'}
    strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round">
    {active
      ? <>
          <circle cx="12" cy="12" r="9.2"/>
          <path d="M8.0 12.0 h8.0 M12.0 8.0 v8.0" stroke="#FFFFFF" strokeWidth="1.8" fill="none"/>
        </>
      : <>
          <circle cx="12" cy="12" r="9.2"/>
          <path d="M8.0 12.0 h8.0 M12.0 8.0 v8.0"/>
        </>}
  </svg>
));

/** 户外规划（O01）：星球圆 + 两块对角正圆大陆。常态描边，激活实心、大陆镂空。 */
export const RailMap = makeCustomIcon((size, active) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true"
    fill={active ? 'currentColor' : 'none'}
    stroke={active ? 'none' : 'currentColor'}
    strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round">
    {active
      ? <>
          <circle cx="12" cy="12" r="9.2"/>
          <circle cx="9.1" cy="9.1" r="2.7" fill="#FFFFFF"/>
          <circle cx="14.9" cy="14.9" r="2.7" fill="#FFFFFF"/>
        </>
      : <>
          <circle cx="12" cy="12" r="9.2"/>
          <circle cx="9.1" cy="9.1" r="2.7"/>
          <circle cx="14.9" cy="14.9" r="2.7"/>
        </>}
  </svg>
));
