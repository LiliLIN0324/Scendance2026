/**
 * 设置页快捷键目录。
 *
 * 只列当前已绑定的键，页面与测试共用一份，避免说明和 hook 漂移。
 * 主源：
 * - hooks/use-keyboard-shortcuts.ts（建造画布）
 * - hooks/use-annotate-draw-shortcuts.ts + lib/annotate-draw-shortcuts.ts（标注）
 * - components/outdoor-plan-canvas.tsx（户外 H/S）
 */
export interface ShortcutKeys {
  /** Windows / Linux 键位。 */
  win: string;
  /** macOS 键位。 */
  mac: string;
}

export interface ShortcutEntry {
  action: string;
  keys: ShortcutKeys;
  /** 生效条件、限制或例外；没有就不写。 */
  note?: string;
}

export interface ShortcutGroup {
  id: string;
  title: string;
  description?: string;
  entries: readonly ShortcutEntry[];
  /** 不落在单个按键上的模式说明。 */
  notes?: readonly string[];
}

const UNDO: ShortcutEntry = {
  action: '撤销',
  keys: { win: 'Ctrl+Z', mac: '⌘Z' },
  note: '输入框内不拦截',
};

const REDO: ShortcutEntry = {
  action: '重做',
  keys: { win: 'Ctrl+Shift+Z / Ctrl+Y', mac: '⌘⇧Z / ⌘Y' },
  note: '输入框内不拦截',
};

export const SHORTCUT_CATALOG: readonly ShortcutGroup[] = [
  {
    id: 'build-edit',
    title: '建造画布 · 编辑',
    description: '以下按键在建造画布内生效；输入框获得焦点时让给输入。',
    entries: [
      UNDO,
      REDO,
      {
        action: '复制选中家具',
        keys: { win: 'Ctrl+C', mac: '⌘C' },
        note: '有选中；一人称漫游时不生效',
      },
      {
        action: '粘贴家具',
        keys: { win: 'Ctrl+V', mac: '⌘V' },
        note: '剪贴板里有家具；一人称漫游时不生效',
      },
      {
        action: '直接复制',
        keys: { win: 'Ctrl+D', mac: '⌘D' },
        note: '有选中；一人称漫游时不生效',
      },
      {
        action: '删除',
        keys: { win: 'Delete / Backspace', mac: 'Delete / ⌫' },
        note: '物件或墙；有选中',
      },
      {
        action: '确认落位',
        keys: { win: 'Enter', mac: 'Return' },
        note: '仅键盘落位未确认时',
      },
      {
        action: '取消 / 取消选中',
        keys: { win: 'Esc', mac: 'Esc' },
        note: '优先取消未确认的落位',
      },
    ],
  },
  {
    id: 'build-transform',
    title: '建造画布 · 变换',
    description: '都要求先选中物件；锁定或拖拽中会被拦。',
    entries: [
      {
        action: '旋转',
        keys: { win: 'R', mac: 'R' },
        note: '有选中；默认 90°',
      },
      {
        action: '微旋',
        keys: { win: 'Shift+R', mac: '⇧R' },
        note: '有选中；角度见本方案设置，默认 15°',
      },
      {
        action: '移动工具',
        keys: { win: 'Q', mac: 'Q' },
        note: '切换变换模式',
      },
      {
        action: '旋转工具',
        keys: { win: 'E', mac: 'E' },
        note: '切换变换模式',
      },
      {
        action: '缩放工具',
        keys: { win: 'S', mac: 'S' },
        note: '切换变换模式',
      },
      {
        action: '聚焦选中',
        keys: { win: 'F', mac: 'F' },
        note: '有选中',
      },
      {
        action: '微移',
        keys: { win: '方向键', mac: '方向键' },
        note: '步长见本方案设置，默认 0.1 m；按住 Shift 为 10 倍；选中未锁定',
      },
      {
        action: '2D 切换',
        keys: { win: '2', mac: '2' },
      },
    ],
  },
  {
    id: 'build-view',
    title: '建造画布 · 视图',
    description: '视图类按键在漫游和评审锁定下仍可用。',
    entries: [
      {
        action: '网格吸附',
        keys: { win: 'G', mac: 'G' },
        note: '只切网格；墙 / 物件吸附是独立开关',
      },
      {
        action: '尺寸标注',
        keys: { win: 'M', mac: 'M' },
      },
      {
        action: '信号显示',
        keys: { win: 'W', mac: 'W' },
        note: '场景里有信号物件时',
      },
      {
        action: '侧栏',
        keys: { win: 'P', mac: 'P' },
      },
      {
        action: '上一时刻',
        keys: { win: '[', mac: '[' },
      },
      {
        action: '下一时刻',
        keys: { win: ']', mac: ']' },
      },
      {
        action: '上一层',
        keys: { win: 'PageUp', mac: 'PageUp' },
      },
      {
        action: '下一层',
        keys: { win: 'PageDown', mac: 'PageDown' },
      },
    ],
  },
  {
    id: 'outdoor',
    title: '户外规划',
    description: '户外画布的裸单键先给模式，再轮到工具。',
    entries: [
      {
        action: '抓手工具',
        keys: { win: 'H', mac: 'H' },
        note: '浏览模式',
      },
      {
        action: '选择工具',
        keys: { win: 'S', mac: 'S' },
        note: '选择模式；建造画布的 S 是缩放',
      },
      {
        action: '文本标注',
        keys: { win: 'T', mac: 'T' },
        note: '标注模式',
      },
      {
        action: '矩形标注',
        keys: { win: 'R', mac: 'R' },
        note: '标注模式；设施落位时 R 让给旋转',
      },
      {
        action: '圆形标注',
        keys: { win: 'O', mac: 'O' },
        note: '标注模式',
      },
      {
        action: '三角形标注',
        keys: { win: 'Y', mac: 'Y' },
        note: '标注模式',
      },
      {
        action: '线段标注',
        keys: { win: 'L', mac: 'L' },
        note: '标注模式',
      },
      {
        action: '退出当前工具',
        keys: { win: 'Esc', mac: 'Esc' },
      },
    ],
  },
  {
    id: 'annotate',
    title: '标注绘图',
    description: '标注工具只在进入标注模式后接管这些键。',
    entries: [
      {
        action: '文本',
        keys: { win: 'T', mac: 'T' },
        note: '输入框内不拦截',
      },
      {
        action: '矩形',
        keys: { win: 'R', mac: 'R' },
        note: '设施落位时让开',
      },
      {
        action: '圆形',
        keys: { win: 'O', mac: 'O' },
      },
      {
        action: '三角形',
        keys: { win: 'Y', mac: 'Y' },
        note: '已避开 H / S / WASD',
      },
      {
        action: '线段',
        keys: { win: 'L', mac: 'L' },
      },
      {
        action: '退出',
        keys: { win: 'Esc', mac: 'Esc' },
        note: '输入框内不拦截',
      },
    ],
  },
  {
    id: 'limits',
    title: '模式与例外',
    description: '同名键在不同模式下含义不同；这里只列会影响预期的情况。',
    entries: [],
    notes: [
      '一人称漫游：WASD / 方向键归相机，裸单键关闭；撤销、重做、Esc 仍可用。',
      '评审 / 交付锁定：撤销、删除、微移、旋转、粘贴等改布局的键被拦截；视图类按键仍可用。',
      '拖拽中：部分改布局的键被暂扣，视图类按键仍可用。',
      '输入框或可编辑区域获得焦点时，所有单键快捷键都不拦截。',
      '桌面优先：触屏（双指缩放、拖拽）与纯键盘路径尚未覆盖，桌面端鼠标 + 键盘是完整操作方式。',
    ],
  },
];
