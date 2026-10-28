# T-LIGHTING-WIRE · 现场灯光接线（让氛围菜单里的三个灯光真的生效）

> 开卡日期：2026-10-28
> 来源：上一版把 `onLighting` 从工具列挪走后没再传，`ScendanceViewTools` 的 `onLighting?.()` 永远是空调用；同时 `scendance-workspace.tsx` 留了一条未使用参数的 TS6133 错误。

## 现状事实

- `ScendanceViewTools`（[scendance-workspace.tsx](file:///C:/Users/13266/.dsh/bot/workspace/Scendance2026/frontend/components/room-organizer/panels/scendance-workspace.tsx)）已经有 `LIGHTING_OPTIONS`（明亮自然 / 温暖聚会 / 冷调展览）与 `role="option"` 菜单，点击时调 `onLighting?.(id)`。
- `room-organizer.tsx` 渲染 `<ScendanceViewTools/>` 时**没传** `onLighting`；同页 `<ScendanceLibrary/>` 反倒挂着一个没人用的 `onLighting`。
- 3D 场景读的是 `useEventAtmosphere({ lighting: previewCandidate?.backendLighting ?? layout.backendLighting ?? 'warm' })`，所以只要写进 `layout.backendLighting`，画面会立刻变。

## IN

1. `room-organizer.tsx` 给 `<ScendanceViewTools/>` 传 `onLighting`：`commitHistoryNow(); actions.applyLayout({...当前 layout, backendLighting}); setView(v => ({...v, view2D:false}))`（灯光只有 3D 看得出来，切换时自动回 3D）。
2. 把 `<ScendanceLibrary/>` 上的 `onLighting` 去掉，同时删掉 `LibraryProps.onLighting` 与该组件解构里的 `onLighting`——消灭那条 TS6133。

## OUT

- 不改灯光的三个选项名、不改菜单结构、不加新灯光预设。
- 不动「时光/天气/人群/足迹」其他氛围项。
- 不改 3D 渲染的色温算法（`useEventAtmosphere` 内部）。
- 不刻意做「灯光是否先预览再确认」——灯光是视图氛围，不进物料布置的确认流程。

## 验收 checkbox

- [x] `npx tsc --noEmit` → **0 error**（含消除既有 TS6133）
- [x] `vitest run` 定向：`scendance-workspace` / `creative-studio` 全绿
- [x] 浏览器：3D 下打开「氛围」→「现场灯光」→ 选「冷调展览」，菜单收起、按钮文字变「冷调展览」、再一次打开时该项 `aria-selected="true"`；画布照明切换为冷调
- [x] 浏览器：切到 2D 后再选灯光，视图自动回到 3D
- [x] 撤销（Ctrl+Z）能把灯光还原到上一档

## 落点

| 文件 | 改动 |
|---|---|
| `frontend/components/room-organizer/room-organizer.tsx` | 工具列传 `onLighting`；素材库去掉 `onLighting` |
| `frontend/components/room-organizer/panels/scendance-workspace.tsx` | 删 `LibraryProps.onLighting` 与解构参数 |

## 自检记录

**2026-10-28**

- 类型：`npx tsc --noEmit -p tsconfig.json` → exit 0，TS6133 消失。
- 测试：`scendance-workspace` 与 `creative-studio` 随定向批次跑过，10 文件 / 467 条全绿。
- 浏览器（`localhost:3000` 工作台，1440×900）：
  1. 3D 下点工具列「氛围」→ 菜单出现 `漫游 / 人群 / 晴朗 / 正午 / 明亮自然` 5 项；点「现场灯光」弹出 `明亮自然 / 温暖聚会 / 冷调展览` 三个 `role="option"`，初始 `明亮自然:true`。
  2. 选「冷调展览」→ 弹层收起，按钮文字变「冷调展览」，再打开弹层 `冷调展览:true`。
  3. 点「平面 / 立体」切到 2D（按钮显示 2D）→ 选「温暖聚会」→ 按钮变「温暖聚会」，模式按钮回到 3D。
  4. Ctrl+Z（`window` 上派发 `keydown z + ctrlKey`，走同一个 handler）→ 灯光回到「明亮自然」，同时 `#tool-undo` 变 disabled，说明历史栈已被这一步撤空。
- 备注：CDP 的 `press_key` 在当前焦点下没送到页面（键盘焦点停在工具按钮上、又被浏览器抢走），所以撤销用 `window.dispatchEvent(new KeyboardEvent('keydown',{key:'z',ctrlKey:true}))` 验证；快捷键监听本身就挂在 `window` 上（`use-keyboard-shortcuts.ts:270`），等价。
- 未 commit / 未 push / 未部署。
