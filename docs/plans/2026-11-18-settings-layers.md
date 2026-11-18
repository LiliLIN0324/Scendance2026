# Scendance 设置改版方案（评审稿）

> 日期：2026-11-18
> 基线：`origin/main` `364f1ef7`（已含 #152、#166）
> 状态：评审稿，先不合入
> 仓库：`LiliLIN0324/Scendance2026`
> 适用范围：账户中心「设置」的信息架构、个人偏好落盘、快捷键说明；方案级与团队级分刀推进

---

## 0. 一页结论

把设置拆成三层，但不要一次性把三层都做满：

| 层 | 跟谁走 | 本轮做到哪 |
|---|---|---|
| 个人偏好 | 跟账号走，换方案还在 | 第一刀（PR 1 + 2）：改名、快捷键、吸附与读数精度 |
| 本方案 | 跟这份活动走 | 第二刀（PR 3 + 4）：显示单位覆盖、网格间距、微移步长、时区；先本机，云端另议 |
| 团队默认 | 跟工作室走，只影响新建 | 第三刀（PR 5）：团队报价抬头；等 #155 合入或独立 studio settings API |

三条硬约束：

1. **内部尺寸一律存米**。单位、精度只影响读数、输入与导出展示。
2. **不要为了填页面造开关**。每个可见控件必须有消费方；没有消费方就不加。
3. **前端与后端分开 PR**。`frontend/AGENTS.md` 明确前端归 A、迁移与 Edge 契约归 B；跨所有权的大 PR 不评审。

第一刀（PR 1 + PR 2）完成后，用户能看到：

- 设置页标题/分区与存储层级一致；
- 快捷键页从空状态变成按模式分组的真实按键表；
- 吸附与读数精度接出已有 `ViewSettings`，并落本机/云端个人偏好。

网格间距、方案时区、团队报价抬头不在第一刀。

刀与 PR 的对应关系：**第一刀 = PR 1 + PR 2**（个人偏好与快捷键）；**第二刀 = PR 3 + PR 4**（本方案与时区）；**第三刀 = PR 5**（团队报价抬头）。同一刀内的前端/后端仍拆成独立 PR。

---

## 1. 为什么要改

现状不是“设置项太少”，而是“三个不同层级的东西挤在一个没有层级说明的页面里”：

- 账户中心的「设置」里只有「画布」「快捷键」两个页签；
- 「画布」只有显示单位与尺寸标注，两项都是账号级个人偏好；
- 「快捷键」是空状态，但画布上的快捷键已经生效很久；
- 吸附开关已经在 `ViewSettings` 里，`G` 键也能切，但设置页看不到；
- 读数精度、网格间距、方案时区、团队报价抬头都还没有归属。

用户感知到的问题是：

- “我换一台电脑，为什么吸附没了？”（个人偏好没有持久化）
- “我按 G 只关了网格，为什么墙吸附还在？”（`G` 的语义没写清）
- “这是项目设置还是我的设置？”（层级错位）
- “快捷键到底有哪些？”（空页）

改版目标不是把设置页堆满，而是让用户一眼知道：**这项设置跟谁走、存在哪、会影响什么**。

---

## 2. 成熟产品怎么做的：借什么，不借什么

这里只借模式，不逐条引用菜单路径；具体交互以本仓库实现为准。

| 产品/场景 | 可借的模式 | 落到 Scendance | 不照搬 |
|---|---|---|---|
| SketchUp | 单位与精度放在 Model Info（文档级）；快捷键放在 Preferences（应用级）；模板预设单位 | 本方案拥有显示单位/网格；个人拥有快捷键与读数偏好；新建方案用团队默认做种子 | 不在本轮做自定义改键编辑器 |
| Vectorworks Spotlight | 文档单位、座席布置参数（过道、排距）属于文档/工具设置；绘图偏好另放 | 通道净宽、摊位间距属于方案/户外工具默认，不属于账户 | 不做多层模态设置树 |
| Cvent Event Diagramming / Social Tables 这类活动图工具 | 图面设置与团队/账户设置分开；团队品牌信息用于客户产物 | 个人/方案/团队三层；团队抬头供报价单 | 不把团队成员管理搬进设置页 |
| Figma | 快捷键说明按模式/上下文组织，可搜索；偏好是个人级 | 快捷键目录按建造/户外/标注/漫游/锁定分组 | 本轮不做快捷键自定义与冲突检测 |
| 通用 SaaS 默认值模式 | 团队默认只影响新建文档；已有文档不追溯；显示“来自团队/已覆盖” | 新建时写入方案；行内显示来源与“恢复默认” | 不做团队改动实时回写老方案，除非产品明确要求 |

归纳成六条原则：

1. **文档级 vs 应用级分开**：单位、网格、时区是文档的；快捷键、读数偏好是个人的。
2. **默认值是种子，不是活链接**：团队默认在新建时复制进方案；之后团队改动不追溯。
3. **精度是显示格式，不是模型精度**：内部永远存米，精度只控制 `toFixed` 的位数。
4. **快捷键是个人偏好，但本轮只读**：先把已有绑定说清楚，不急着做改键。
5. **团队身份用于客户产物**：公司名、报价人、logo、货币属于团队；方案可以覆盖。
6. **每个开关都要有消费方**：没有画布/导出/报价消费方的字段，不进设置页。

---

## 3. 现状审计（以 `origin/main` `364f1ef7` 为准）

### 3.1 设置页

- `frontend/components/room-organizer/panels/cloud-panel.tsx`
  - 设置区标题是「设置」，`aria-label="设置"`（约 950 行）；
  - 左侧页签是「画布」「快捷键」（约 966 行）；
  - 快捷键页文案是「快捷键还在整理，这里先空着。」（约 996 行）。
- 也就是说：**标题不是「项目设置」**。真正的问题是页面没有说明“这是个人偏好还是本方案设置”。

### 3.2 个人偏好存储

- `frontend/components/room-organizer/lib/account-preferences.ts`
  - `LocalPreferences` 只有 `unit` 与 `showMeasurements`；
  - 本机键：`scendance.preferences.v1:{userId|guest}`；
  - 读取时逐字段兜底，旧 JSON 不会炸。
- `frontend/lib/backend-session.ts:182`
  - `AccountPreferences` 只有 `unit?: 'm' | 'ft'` 与 `showMeasurements?: boolean`。
- `supabase/functions/_shared/api.ts:303`
  - PATCH `/preferences` 使用 `z.strictObject({unit, showMeasurements})`，**新键会直接 400**。
- `supabase/migrations/20261112190000_user_preferences.sql`
  - SQL 白名单只对 `unit`、`showMeasurements` 做 `jsonb_set`，其他键忽略。
- 仓库里没有 preferences 的测试文件（按文件名与 grep 核对），需要新建。

### 3.3 画布吸附

- `frontend/components/room-organizer/lib/types.ts:534`
  - `ViewSettings` 已有 `snapToGrid`、`snapToWall`、`snapToItems`。
- `frontend/components/room-organizer/room-organizer.tsx:3626`
  - `G` 只绑定 `toggle('snapToGrid')`，**不控制墙/物件吸附**。
- `frontend/components/room-organizer/hooks/use-item-placement.ts`
  - 三个开关都在落位/拖动时被消费。
- 户外规划另有一套：`room-organizer.tsx:682` 的 `outdoorSnapOn`，默认 `true`，走底条吸附钮，不在 `ViewSettings` 里。
- 结论：设置页如果只写一个“网格吸附”，必须说明它指建造画布的 `snapToGrid`，否则会和户外底条开关打架。

### 3.4 快捷键

主源：`frontend/components/room-organizer/hooks/use-keyboard-shortcuts.ts`；标注源：`hooks/use-annotate-draw-shortcuts.ts` + `lib/annotate-draw-shortcuts.ts`；户外源：`components/outdoor-plan-canvas.tsx`。

实际绑定与条件：

- `Ctrl/Cmd+Z` 撤销；`Ctrl/Cmd+Shift+Z` 或 `Ctrl/Cmd+Y` 重做；
- `Ctrl/Cmd+D` 复制选中物件；`Ctrl/Cmd+C` 复制选中家具；`Ctrl/Cmd+V` 粘贴家具剪贴板；
  - `C`/`V` 不是裸键；
  - `C` 只在有选中时生效；`V` 只在剪贴板有家具时生效；
  - 漫游时不生效。
- `Enter` 只在键盘落位未确认时确认；`Esc` 优先取消落位，否则取消选中；
- `Delete/Backspace` 删除选中物件或墙；
- `R` 旋转；`Shift+R` 15° 微旋；
- `Q/E/S` 切换移动/旋转/缩放（有选中时）；
- `F` 聚焦选中；
- `2` 切换 2D；
- `[` / `]` 调时刻；
- `PageUp/PageDown` 换楼层；
- `M` 尺寸标注；
- `G` 网格吸附（仅 `snapToGrid`）；
- `W` 信号显示（仅场景有信号物件时）；
- `P` 侧栏；
- 方向键微移 0.1 m；`Shift` 加按 1.0 m（选中且未锁定）；
- 一人称漫游：`WASD`/方向键归相机，所有裸单键关闭；撤销/重做/Esc 仍可用；
- 评审/交付锁定：撤销、删除、微移、旋转、粘贴等改布局的键被拦截；视图类按键仍可用；
- 户外：`H` 抓手、`S` 选择；
- 标注：`T` 文本、`R` 矩形、`O` 圆形、`Y` 三角形、`L` 线段；设施落位时 `R` 让给旋转。

已有测试矩阵：`hooks/use-keyboard-shortcuts.react.test.ts`。这说明快捷键表可以抽成一份 catalog，页面与测试共用，避免手写漂移。

### 3.5 时区

- `frontend/lib/event-profile.ts`
  - `eventProfile.timeWindow.value.timeZone` 已存在；
  - `isValidTimeZone` 校验 IANA；
  - `eventInstants` 处理 DST 不存在/歧义。
- 硬编码 `Asia/Shanghai` 至少在 6 个文件：
  - `frontend/lib/event-day-sheet.ts:14`
  - `frontend/components/room-organizer/lib/event-operations.ts:124`
  - `frontend/components/room-organizer/lib/scene-delivery.ts:140,221`
  - `frontend/components/room-organizer/lib/bingo-status.ts:95`
  - `frontend/components/room-organizer/lib/bingo-feedback.ts:177`
  - `frontend/components/room-organizer/panels/commercial-dossier-panel.tsx:47`
- `RoomLayout.eventProfile` 是本地侧车；`frontend/lib/layout-export.ts:39` 在 `stripHandoffs` 时删除它。
- 结论：**不要再新增一个“项目时区”字段**；应读取已有 `timeZone`。但要先决定它是否要跨设备/进分享。

### 3.6 网格与货币

- `frontend/components/room-organizer/lib/constants.ts:7`：`GRID_SIZE_METERS = 0.5`。
- 消费方：`canvas-2d/render.ts`、`hooks/use-item-placement.ts`、`three/grid.ts`、`lib/plan-export/plan-geometry.ts`。
- `constants.ts:10`：`CURRENCY_SYMBOL = '$'`，还在 `canvas-2d/render.ts:1223` 的密度读数里使用。
- 结论：网格间距不是加字段就能生效；货币也不是只改报价单抬头。

### 3.7 团队与方案存储

- `frontend/lib/backend-session.ts`：`Studio` 只有 `id/name/role/displayName`，没有公司名/logo/货币。
- `frontend/components/room-organizer/lib/schema.ts`：
  - `LAYOUT_KEYS` 是 `Record<keyof RoomLayout, true>` 的全量白名单；
  - 给 `RoomLayout` 加字段但漏了白名单，typecheck 会失败（这是好事，不会静默丢）。
- `supabase/functions/_shared/domain.ts:136`：`sceneV2Schema` 是 `z.strictObject`，没有 spare bag。
- `frontend/components/room-organizer/lib/backend-adapter.ts`：`backendSceneToLayout` 从 `Scene` 重建布局，不保留本地侧车。
- `frontend/lib/share-snapshot.ts`：`ShareSnapshot` 没有 unit/precision 字段。
- 结论：方案级字段是“类型 → 白名单 → 云端契约 → 导出/分享 → 消费方”的一条链，不是单点。

---

## 4. 目标模型

### 4.1 三层与两个时刻

```
团队默认（工作室）
   │  新建时写入（种子，不追溯）
   ▼
本方案（当前活动）──────► 画布/导出/报价
   ▲
   │  没有方案值时回退
个人偏好（账号）
```

两个时刻必须分开：

1. **新建时**：`seedNewPlan(teamDefaults, personalPrefs)` 把团队默认复制进方案。
2. **打开时**：`resolvePlanSetting(planValue, personalValue, builtin)` 只读方案值；方案没有才回退个人/内置。

不要把“团队默认”放进运行时 resolver。否则团队改一次单位，所有老方案跟着变，用户会认为是数据损坏。

### 4.2 归属表

| 设置项 | 层 | 默认 | 存储 | 消费方 | 哪个 PR | 状态 |
|---|---|---|---|---|---|---|
| 显示单位（米/英尺） | 个人；方案可覆盖 | `m` | `AccountPreferences.unit` + 本机 | `formatLength`、属性面板、导出 | 1（仅改名）/ 3（方案覆盖） | 已有 |
| 尺寸标注 | 个人 | 开 | `showMeasurements` | 画布、属性面板 | 1 | 已有 |
| 长度小数位 | 个人 | `auto`（米 2 位/英尺 1 位） | `lengthPrecision` | `formatLength` 全仓 18 处引用 | 2 | 新增 |
| 建造画布吸附：网格/墙/物件 | 个人 | 全关 | `snapToGrid/snapToWall/snapToItems` | `use-item-placement` | 2 | 已有 ViewSettings，未持久化 |
| 户外规划网格吸附 | 个人（户外） | 开 | 先保持 `outdoorSnapOn`，后续统一 | 户外底条 | 暂不做 | 已有独立状态 |
| 快捷键说明 | 个人（只读） | 内置 | 代码 catalog | 设置页 | 1 | 新增说明 |
| 方案显示单位覆盖 | 本方案 | 跟随个人 | `planSettings.displayUnit` | 画布、导出、分享查看器 | 3 | 新增 |
| 网格间距 | 本方案 | 0.5 m | `planSettings.gridSizeM` | 2D/3D 网格、落位、平面导出 | 3 | 需接线 |
| 微移步长 | 本方案 | 0.1 m / Shift 1.0 m | `planSettings.nudgeStepM` | 键盘 hook | 3 | 需接线 |
| 方案时区 | 本方案 | 上海 | `eventProfile.timeWindow.value.timeZone` | 执行包/运营/交付 | 4 | 已有字段，需消费 |
| 通道净宽/摊位间距 | 本方案/团队 | 待定 | 户外 plan schema | #151/#167 | 后移 | 消费方未合 |
| 公司名/报价人/货币 | 团队；方案可改 | 空/现有 `$` | `studio_settings` + 方案覆盖 | 报价、BOM、画布密度 | 5 | 需新表 |
| logo | 团队 | 空 | 对象存储 + `logoAssetId` | 报价/客户产物 | 5C | 单独做 |
| 地理定位/北向/底图/画质/公开链接/导出语言/自定义改键 | 后移 | — | — | — | 不做 | 非目标 |

### 4.3 优先级与 resolver

先写纯函数，不要先做抽象框架：

```ts
export type SettingSource = 'plan' | 'personal' | 'builtin';

export interface Resolved<T> {
  value: T;
  source: SettingSource;
}

export function resolvePlanSetting<T>(
  planValue: T | null | undefined,
  personalValue: T | null | undefined,
  builtin: T,
): Resolved<T> {
  if (planValue !== null && planValue !== undefined) return { value: planValue, source: 'plan' };
  if (personalValue !== null && personalValue !== undefined) return { value: personalValue, source: 'personal' };
  return { value: builtin, source: 'builtin' };
}
```

新建时种子：

```ts
export type CurrencyCode = 'CNY' | 'USD' | 'EUR' | 'GBP' | 'JPY';

export interface TeamDefaults {
  defaultUnit?: DisplayUnit;
  gridSizeM?: number;
  currency?: CurrencyCode;
  companyName?: string;
  quoteContact?: string;
  logoAssetId?: string;
}

export function seedPlanSettings(
  team: TeamDefaults | null,
): PlanSettings {
  return {
    ...(team?.defaultUnit ? { displayUnit: team.defaultUnit } : {}),
    ...(team?.gridSizeM !== undefined ? { gridSizeM: team.gridSizeM } : {}),
    // 不把个人快捷键、个人吸附写进方案文件；个人单位只在运行时回退
  };
}
```

必须写表驱动测试：

| plan | personal | builtin | 期望 | 来源 |
|---|---|---|---|---|
| `ft` | `m` | `m` | `ft` | plan |
| `null` | `ft` | `m` | `ft` | personal |
| `undefined` | `undefined` | `m` | `m` | builtin |
| `null` | `null` | `m` | `m` | builtin |

规则细节：

- 只认自己的键；不要把整个对象 spread 后 delete。
- `false` 是有效值，不能被 `||` 吃掉；用 `??`。
- 空字符串、`NaN`、非法枚举按缺失处理。
- 每一行 UI 显示来源：`来自本方案` / `来自个人` / `默认`，并提供“恢复默认”。

---

## 5. 数据与接口设计

### 5.1 个人偏好

本机形状：

```ts
export type LengthPrecision = 'auto' | 0 | 1 | 2;

export interface LocalPreferences {
  unit: DisplayUnit;
  showMeasurements: boolean;
  lengthPrecision: LengthPrecision;
  snapToGrid: boolean;
  snapToWall: boolean;
  snapToItems: boolean;
}
```

云端形状：

```ts
export interface AccountPreferences {
  unit?: 'm' | 'ft';
  showMeasurements?: boolean;
  lengthPrecision?: LengthPrecision;
  snapToGrid?: boolean;
  snapToWall?: boolean;
  snapToItems?: boolean;
}
```

存储键保持 `scendance.preferences.v1:{userId|guest}`，不升 v2；读取时逐字段兜底，旧 JSON 直接可用。

**合并规则（重要）**：

```ts
const local = readLocalPreferences(userId);
const remote = await controller.getPreferences();
const merged = {
  unit: remote.unit ?? local.unit,
  showMeasurements: remote.showMeasurements ?? local.showMeasurements,
  lengthPrecision: remote.lengthPrecision ?? local.lengthPrecision,
  snapToGrid: remote.snapToGrid ?? local.snapToGrid,
  snapToWall: remote.snapToWall ?? local.snapToWall,
  snapToItems: remote.snapToItems ?? local.snapToItems,
};
```

缺键回退**本机**，不是回退产品默认。否则 A 设备刚开的吸附，到 B 设备会被旧云端记录重置。

**PATCH 只发变更键**：

```ts
const patch: AccountPreferences = {
  ...(next.snapToGrid !== undefined ? { snapToGrid: next.snapToGrid } : {}),
  ...(next.lengthPrecision !== undefined ? { lengthPrecision: next.lengthPrecision } : {}),
};
controller.savePreferences(patch);
```

`exactOptionalPropertyTypes` 下不要写 `{ snapToGrid: undefined }`；用条件展开。不要为了变绿改弱 tsconfig 或删断言。

**防抖**：`G` 是高频键，不能每按一次就 PATCH。本地立即写，云端 400 ms 防抖；切页/关闭前 flush。设置页的开关可以立即写。

**后端**：

- 新 migration：`supabase/migrations/20261118..._user_preferences_readings.sql`
  - 建议沿用现有“重命名 + 新分发器”模式：`scene_rpc` → `scene_rpc_before_settings_preferences`，新函数拦截 `preferences.get/put` 后下放；
  - 白名单新增 `lengthPrecision`（`'auto' | 0 | 1 | 2`）与三个 boolean；
  - 非法值返回 `INVALID_PREFERENCE_VALUE`；
  - 旧客户端只 PATCH 两个旧键时，`jsonb_set` 保留新键。
- `supabase/functions/_shared/api.ts:303`
  - `z.strictObject` 增加可选字段；
  - `lengthPrecision` 用 `z.union([z.literal('auto'), z.literal(0), z.literal(1), z.literal(2)])` 或等价枚举。
- 测试：
  - `tests/preferences.test.ts`（或并入 `tests/api.test.ts`）：
    - GET 空账号返回 `{}`；
    - PATCH 部分字段只改该字段；
    - PATCH 非法精度/非 boolean 返回 400；
    - 未知键返回 400；
    - 旧客户端 PATCH 两个旧键后，新键仍在；
    - 未登录 401。
- 不在本地或线上 apply migration；PR 只提交文件与回滚说明，等人 review。

### 5.2 方案级设置

建议形状：

```ts
// CurrencyCode 见 4.3

export interface QuoteHeader {
  companyName?: string;
  contact?: string;
  currency?: CurrencyCode;
}

export interface PlanSettings {
  /** 本方案对客户/导出的显示单位；缺省跟随个人。 */
  displayUnit?: DisplayUnit;
  /** 仅编辑器：画布网格与落位间距，米。 */
  gridSizeM?: number;
  /** 仅编辑器：方向键微移步长，米；Shift 为 10 倍。 */
  nudgeStepM?: number;
  /** 本方案对团队报价抬头的覆盖；缺省跟随团队。 */
  quote?: QuoteHeader;
}
```

`RoomLayout` 增加 `planSettings?: PlanSettings`，并同步：

1. `types.ts` 的 `RoomLayout`；
2. `schema.ts` 的 `LAYOUT_KEYS` 加 `planSettings: true`；
3. `isRoomLayout` 增加 `isPlanSettings` 校验：
   - `displayUnit` 只能是 `m`/`ft`；
   - `gridSizeM` 在 `[0.05, 5]`；
   - `nudgeStepM` 在 `[0.001, 1]`；
4. `repairLayout` 对越界值 clamp 或丢弃；
5. `layout-export.ts`：
   - `stripHandoffs=true` 时保留 `displayUnit`（客户要看到同一单位），删除 `gridSizeM`/`nudgeStepM`（编辑器偏好）与 `quote`（报价/BOM 内部字段，不进 3D 分享）；
6. `share-snapshot.ts` / `app/view`：
   - 查看器读取 `planSettings.displayUnit`；没有则用查看者个人单位或米；
   - 如果不做查看器消费，就不要声称“方案单位覆盖”。

**云端策略（本轮建议）**：

- `planSettings` 先只在本机保存/恢复，**不进入 `sceneV2Schema`**；
- UI 明确写“本机方案设置，云端暂不同步”；
- 如果要跨设备，另开契约 PR 把需要的字段加进 `Scene`（需人 review），不要在本轮偷塞。

理由：`sceneV2Schema` 是 `strictObject`，`backendSceneToLayout` 又会重建布局；本地侧车字段上云不是“顺手”能完成的。

### 5.3 团队默认与报价抬头

现状 `Studio` 没有设置存储。建议：

- 新表 `scene_private.studio_settings(studio_id uuid primary key, settings jsonb not null default '{}', updated_at timestamptz)`；
- API：`GET/PATCH /studios/:id/settings`；
- 权限：owner 可写，editor 可读；经 service_role RPC，客户端不直连；
- 字段：
  - `defaultUnit?: 'm' | 'ft'`
  - `gridSizeM?: number`
  - `currency?: CurrencyCode`
  - `companyName?: string`
  - `quoteContact?: string`
  - `logoAssetId?: string`
- 团队默认只用于 `seedNewPlan`；已有方案不追溯。
- 报价抬头解析：
  - `planSettings.quote?.companyName ?? team.companyName ?? ''`；
  - 方案覆盖时显示“本方案已覆盖”；否则显示“来自团队”。
- logo 单独做：对象存储、MIME/大小限制、删除清理、权限；不要和文本抬头挤在同一个 PR。
- 货币：把 `CURRENCY_SYMBOL` 常量换成 `formatMoney(amount, currency)`；`canvas-2d/render.ts` 的密度读数也要用同一个 formatter。
- #155 未合时不要在那条分支上改；本 PR 只提供可被报价面板消费的团队字段。

### 5.4 时区

不新增字段，读取：

```ts
const timeZone = layout.eventProfile?.timeWindow.value?.timeZone;
```

规则：

- `timeZone` 存在且 `isValidTimeZone` → 使用；
- `timeWindow.status !== 'confirmed'` → 是否使用？建议使用，但在执行包上标注“时区未确认”；
- 缺失/非法 → `Asia/Shanghai`，并显示“默认时区”。

改造点：

- `renderDaySheet` 接受 `timeZone` 参数；
- `event-operations.ts`、`scene-delivery.ts`、`bingo-status.ts`、`bingo-feedback.ts`、`commercial-dossier-panel.tsx` 从 `layout` 取同一个值；
- 文件名日期与“生成于”共用同一个 formatter；
- 测试：
  - `America/New_York` 跨 DST；
  - `Pacific/Kiritimati`（UTC+14）；
  - 非法时区回退上海；
  - 未确认时区有标注；
  - 不退回 UTC 截断。

**跨设备/分享**：`eventProfile` 是本地侧车，换设备或分享查看器拿不到。本轮建议明确“本机方案时区”；如果产品要求跨设备，另开契约 PR，只提升 `timeZone` 一个字段，不要搬整个 eventProfile。

### 5.5 精度

`formatLength(metres, unit, precision?)` 已支持第三参：

- 缺省（`auto`）：米 2 位、英尺 1 位，保持现状；
- 显式 `0/1/2`：覆盖默认；
- 面积仍 1 位小数，本轮不动；设置项文案写“长度读数小数位”。

需要过的消费方（全仓 18 处引用，含定义与测试）：

- `canvas-2d/render.ts`（6 处）
- `lib/site-plan-csv.ts`（3 处）
- `three/measurement.ts`（2 处）
- `lib/site-plan-pdf.ts`、`lib/site-plan-legend.ts`、`lib/site-plan-inventory.ts`、`lib/outdoor-plan-canvas.ts`
- `lib/display-units.test.ts` 补 `auto/0/1/2` 与米/英尺矩阵

验收时用同一份方案分别导出画布、CSV、PDF，读数必须一致。

---

## 6. 分刀计划（按所有权拆 PR）

> `frontend/AGENTS.md`：前端归 A；后端、迁移、密钥、根依赖归 B。涉及 `/preferences` 或 studio settings 的改动，前端与后端必须分开 PR。

### 第一刀 / PR 1：设置页说人话（前端 A）

**目标**：不改存储，只改信息架构与快捷键说明。

改动：

- 设置区标题保持「设置」，内部改成两个真实分区：
  - 「个人偏好」：PR1 先只显示已有的显示单位、尺寸标注；
  - 「快捷键」：按模式分组的只读表。
- 长度小数位与吸附开关等 PR2 合入后再加，不在 PR1 放不可用的控件。
- 不出现空的「本方案」页签；等 PR3 有真实字段再加。
- `G` 标注为“网格吸附”，并注明墙/物件吸附独立。
- 快捷键页删除“还在整理，这里先空着”。

文件：

- `frontend/components/room-organizer/panels/cloud-panel.tsx`
- 新增 `frontend/components/room-organizer/lib/shortcut-catalog.ts`
- 新增 `frontend/components/room-organizer/panels/shortcut-reference.tsx`（或同文件内组件）
- 对应 `.css` 与 `.react.test.tsx`

测试：

- catalog 每条键触发对应 handler（复用 `use-keyboard-shortcuts.react.test.ts` 的矩阵）；
- 漫游/锁定例外各一条；
- 页面不出现“还在整理”；
- `npm --prefix frontend run typecheck`、`test`、`lint`、`build`。

不做：自定义改键、方案级字段、团队设置、后端。

### 第一刀 / PR 2B → PR 2A：个人偏好落盘（后端 B → 前端 A）

**目标**：吸附与精度刷新还在，登录能读回，断网有本机兜底。

PR 2B（后端 B）：

- 新 migration：扩展 `/preferences` 白名单；
- `api.ts` strictObject 增加字段；
- `tests/preferences.test.ts`；
- 不 apply 线上；PR 正文写回滚说明。

PR 2A（前端 A，依赖 2B）：

- `account-preferences.ts` 扩展 `LocalPreferences`；
- `backend-session.ts` 扩展 `AccountPreferences`；
- `room-organizer.tsx`：
  - 初始化 `ViewSettings` 时合并全部个人偏好；
  - `updatePreference` 改为函数式更新 + 只 PATCH 变更键；
  - `G` 走 `updatePreference({ snapToGrid })`，云端防抖；
- 设置页加三个吸附开关与“长度小数位”；
  - 文案写“建造画布吸附”，不要暗示控制户外；
- 精度贯穿 `formatLength` 调用点。

验收：

- 刷新后仍在；
- 登录后从云端读回；
- 断网/隐私模式本机兜底；
- 旧本机 JSON、旧云端记录、旧客户端 PATCH 三种兼容；
- 切单位不改方案 JSON 数字；
- 画布/属性/CSV/PDF 精度一致。

不做：方案级设置、团队默认、户外吸附统一。

### 第二刀 / PR 3A / PR 3B：本方案（前端 A）

**目标**：让“本方案”有真实内容，但不制造死开关。

PR 3A：方案显示单位覆盖 + 分享/导出消费。

- `RoomLayout.planSettings.displayUnit`；
- `LAYOUT_KEYS`、`isPlanSettings`、`repairLayout`；
- `layout-export.ts` 在客户导出时保留 `displayUnit`；
- `app/view` 查看器读取并显示；
- 设置页“本方案”页签出现，显示来源“跟随个人/本方案覆盖”；
- 测试：米/英尺切换只改读数，不改存储数字；分享链接查看器单位一致。

PR 3B：网格间距 + 微移步长（仅接线后）。

- `planSettings.gridSizeM`、`nudgeStepM`；
- 替换 `GRID_SIZE_METERS` 的消费方式：
  - `canvas-2d/render.ts` 接收 `gridSizeM`；
  - `use-item-placement.ts` 接收 `gridSizeM`；
  - `three/grid.ts` 接收 `gridSizeM`；
  - `plan-export/plan-geometry.ts` 使用同一值；
- 键盘 hook 的 `0.1/1.0` 改为 `nudgeStepM` 与 `10×`；
- 测试：2D 网格与导出平面图同间距；方向键与 Shift 步长一致。

如果 3B 的接线工作量压不住，就只做 3A；**不要先把 `gridSizeM` 存进方案却不消费**。

云端：两个 PR 都先本机；UI 明说“本机方案设置，云端暂不同步”。

### 第二刀 / PR 4：时区（前端 A）

- 读取 `eventProfile.timeWindow.value.timeZone`；
- 替换 6 处硬编码；
- `renderDaySheet` 等接受 `timeZone`；
- 测试 DST/UTC+14/非法/未确认；
- 明确“本机方案时区”；跨设备另开契约 PR。

### 第三刀 / PR 5B → PR 5A：团队报价抬头（后端 B → 前端 A）

- 5B：`studio_settings` 表 + API + 测试；
- 5A：团队区增加公司名/报价人/货币；报价面板消费；
- 货币 formatter 替换 `CURRENCY_SYMBOL`；
- logo 5C 单独做；
- 等 #155 合入，或只提供字段、不在 #155 分支上改。

### 依赖关系

```
PR1（前端，可独立）
PR2B（后端） → PR2A（前端）
PR3A（前端，可选依赖 PR2A 的单位偏好）
PR3B（前端，独立但工作量大）
PR4（前端，独立）
PR5B（后端） → PR5A（前端，等 #155）
```

---

## 7. 交互与文案

### 7.1 分区

账户中心顶部分区保持不变：项目 / 物料 / 团队与权限 / 设置。

设置内：

- 「个人偏好」——跟账号走；
- 「本方案」——跟这份活动走（PR3 才出现）；
- 「快捷键」——只读说明。

「团队与权限」保留原分区，不搬进设置；团队默认/报价抬头在团队区增加。

### 7.2 状态

- 未登录：个人偏好写本机，显示“本机保存，登录后同步”；
- 已登录：本机 + 云端，显示同步状态；
- 断网：写本机，显示“云端暂不可用，已保存在本机”；
- 没有当前方案：隐藏「本方案」，或禁用并说明“先打开一份方案”；
- 方案设置未上云：显示“仅本机”；
- 团队默认：显示“只影响新建方案”。

### 7.3 行内来源与重置

每行右侧：

- `来自个人` / `来自本方案` / `来自团队` / `默认`；
- “恢复默认”或“跟随个人”；
- 覆盖时不要静默改值，先让用户看到来源。

### 7.4 文案

- 「显示单位」：影响标注、属性面板与导出清单；场景数据始终按米存储。
- 「长度小数位」：自动 = 米 2 位、英尺 1 位；也可固定 0/1/2 位。
- 「建造画布吸附」：`G` 只切换网格吸附；墙/物件吸附单独控制。
- 「网格间距」：仅影响本方案画布与落位；导出平面图使用同一间距。
- 「微移步长」：方向键每次移动；`Shift` 为 10 倍。
- 「方案时区」：用于当天执行包文件名与“生成于”；默认 Asia/Shanghai。
- 「团队默认」：只影响新建方案；已有方案不追溯。

不要出现「项目设置」。仓库里 project/plan 已经混用，设置页统一用“方案”。

### 7.5 可访问性与移动端

- 页签用 `role="tablist"` / `role="tab"` / `aria-selected` / `aria-controls`；
- 开关用原生 checkbox + label，不用纯 div；
- 分组用 `fieldset/legend` 或 `role="group"` 加 `aria-labelledby`；
- 焦点环可见；键盘可走完整个设置页；
- 360/390 px 宽下不横向滚动，行内控件换行；
- 触控目标 ≥ 44 px。

---

## 8. 快捷键目录（页面与测试共用）

不要把这张表手写进 JSX。抽成 `SHORTCUT_CATALOG`，页面渲染它，测试遍历它。

### 建造画布

| 操作 | Windows/Linux | macOS | 条件/备注 |
|---|---|---|---|
| 撤销 | `Ctrl+Z` | `⌘Z` | 输入框内不拦截 |
| 重做 | `Ctrl+Shift+Z` / `Ctrl+Y` | `⌘⇧Z` / `⌘Y` | — |
| 复制选中家具 | `Ctrl+C` | `⌘C` | 有选中；漫游时不生效 |
| 粘贴家具 | `Ctrl+V` | `⌘V` | 剪贴板有家具；漫游时不生效 |
| 直接复制 | `Ctrl+D` | `⌘D` | 有选中；漫游时不生效 |
| 确认落位 | `Enter` | `Enter` | 仅键盘落位未确认时 |
| 取消/取消选中 | `Esc` | `Esc` | 优先取消落位 |
| 删除 | `Delete` / `Backspace` | 同左 | 物件或墙 |
| 旋转 | `R` | `R` | 有选中；默认 90°，`Shift+R` 15° |
| 移动/旋转/缩放 | `Q` / `E` / `S` | 同左 | 有选中 |
| 聚焦选中 | `F` | `F` | 有选中 |
| 2D 切换 | `2` | `2` | — |
| 时刻 -1/+1 | `[` / `]` | 同左 | — |
| 楼层 | `PageUp` / `PageDown` | 同左 | — |
| 尺寸标注 | `M` | `M` | — |
| 网格吸附 | `G` | `G` | 仅 `snapToGrid` |
| 信号显示 | `W` | `W` | 仅场景有信号物件 |
| 侧栏 | `P` | `P` | — |
| 微移 | 方向键 | 方向键 | 0.1 m；`Shift` 1.0 m；选中未锁定 |

例外：

- 一人称漫游：`WASD`/方向键归相机，裸单键关闭；撤销/重做/Esc 仍可用。
- 评审/交付锁定：改布局的键被拦截；视图类按键仍可用。
- 拖拽中：部分改布局的键被暂扣，视图类按键仍可用。

### 户外规划

| 操作 | 按键 | 条件/备注 |
|---|---|---|
| 抓手 | `H` | 浏览模式 |
| 选择 | `S` | 选择模式；与建造画布的 `S=缩放` 不同 |
| 文本/矩形/圆形/三角形/线段 | `T` / `R` / `O` / `Y` / `L` | 标注模式；设施落位时 `R` 让给旋转 |
| 退出当前工具/取消 | `Esc` | — |

### 标注

| 操作 | 按键 | 条件/备注 |
|---|---|---|
| 文本 | `T` | 输入框内不拦截 |
| 矩形 | `R` | 设施落位时让开 |
| 圆形 | `O` | — |
| 三角形 | `Y` | 避开 `H/S/WASD` |
| 线段 | `L` | — |
| 退出 | `Esc` | — |

落笔前再对一遍源码；只列真正绑定的键，不编造。

---

## 9. 兼容与迁移

### 9.1 本机

- 键名不变：`scendance.preferences.v1:*`；
- 新字段逐字段兜底；旧 JSON 读取不抛错；
- 未知字段忽略，不写回；
- `DEFAULT_LOCAL_PREFERENCES` 不要被调用方原地修改。

### 9.2 云端

- 新字段缺失 → 回退本机，不回落产品默认；
- 旧客户端 PATCH 两个旧键 → SQL 保留新键；
- 新客户端 PATCH 未知键 → `api.ts` 400，不会写库；
- 迁移采用“重命名 + 新分发器”，保留回滚函数；
- 不在本地/线上 apply；PR 里写清 `migration` 与回滚 SQL。

### 9.3 方案字段

- 加 `RoomLayout` 字段必须同步 `LAYOUT_KEYS`；漏了 typecheck 会挂；
- `isPlanSettings` 负责枚举/范围校验；
- `repairLayout` 对越界值 clamp/丢弃；
- `layoutForExport(stripHandoffs)` 决定哪些字段给客户：
  - `displayUnit` 保留；
  - `gridSizeM`/`nudgeStepM` 删除；
- 分享查看器不消费 `displayUnit`，就不要声称方案单位覆盖。

### 9.4 云端场景契约

- 本轮不把 `planSettings` 塞进 `sceneV2Schema`；
- 如果后续要跨设备，单独开契约 PR，改 `domain.ts` 与 `client/scene-client.ts`，并做人 review；
- 不要新起一套并行 wire schema。

### 9.5 `exactOptionalPropertyTypes`

- 可选字段用条件展开，不传 `undefined`；
- 不要为了通过类型检查删断言、改弱 tsconfig；
- 后端返回的 `undefined` 与“字段缺失”要区分清楚。

---

## 10. 验收

| ID | 验收条件 | 证据 |
|---|---|---|
| A1 | 设置页标题/分区与三层一致；不再把账号偏好写成“项目设置” | 截图 + `cloud-panel.tsx` diff |
| A2 | 快捷键页按模式分组，列出真实绑定；无“还在整理” | catalog 测试 + 逐键对照 |
| A3 | 改单位、标注、精度、吸附后刷新仍在；登录读回；断网本机兜底 | 手动矩阵 + 单测 |
| A4 | 尺寸仍按米存储；切英尺只改读数 | 切换前后 JSON 对比 |
| A5 | 画布/属性/CSV/PDF 精度一致 | 同一方案四处导出 |
| A6 | 每个可见控件有消费方；`G` 只影响网格 | 代码引用 + 截图 |
| A7 | 方案字段本机保存/恢复；云端不同步有明确文案 | 刷新/重开/换设备 |
| A8 | 时区（若做）跨 DST/UTC+14 正确；非法回退上海 | 单测 |
| A9 | 相关测试、typecheck、lint、build 通过 | 原始命令与输出 |
| A10 | 未碰 #151/#155；改动范围可自证 | `git status --porcelain` + `git diff --stat` |
| A11 | 360/390 px 不横向滚动；键盘可走完 | 截图 + 手动 |
| A12 | PR 正文说明“评审稿，先不合” | PR 链接 |

命令：

```bash
npm --prefix frontend run typecheck
npm --prefix frontend run test
npm --prefix frontend run lint
npm --prefix frontend run build
npm run typecheck
npm test
```

只写“已测试”不算完成；贴命令和原始输出。

兼容矩阵：

| 场景 | 期望 |
|---|---|
| 游客本机 | 新字段写本机，刷新仍在 |
| 登录，云端旧记录 | 缺键回退本机 |
| 登录，云端有新键 | 云端覆盖本机 |
| 断网/隐私模式 | 本机可用，不阻塞画布 |
| 旧本机 JSON | 缺字段用默认，不抛错 |
| 旧客户端 PATCH | 新键不被抹掉 |
| 未知键 PATCH | 400，不写库 |

---

## 11. 风险与回滚

| 风险 | 影响 | 缓解 |
|---|---|---|
| 迁移改 `scene_rpc` | 偏好读写全挂 | 沿用重命名 + 下放模式；本地/测试库先跑；PR 不 apply 线上 |
| 云端 merge 写错 | 用户设置被重置 | 缺键回退本机；表驱动测试 |
| `G` 每次 PATCH | 请求风暴 | 本地立即写，云端 400 ms 防抖 |
| 方案字段被剥 | 刷新后设置消失 | `LAYOUT_KEYS` + `isPlanSettings` + round-trip 测试 |
| 分享单位不一致 | 客户看到不同读数 | 查看器消费 `displayUnit`；否则不做方案覆盖 |
| 团队默认追溯 | 老方案突变 | 只做新建种子；不实时联动 |
| 货币替换范围大 | 画布密度读数漏改 | 用 `formatMoney`，全仓 grep `CURRENCY_SYMBOL` |
| logo 上传 | 存储/权限/清理 | 单独 PR，不在文本抬头里塞 |

回滚：

- 前端：revert PR；本机键向前兼容，旧版本忽略新字段；
- 后端：保留 `scene_rpc_before_settings_preferences`，回滚时把分发器指回去；
- 方案字段：旧版本读到时忽略，不阻塞打开。

---

## 12. PR 模板与执行约束

分支：

- `agent/settings-layers-<ticket>`；
- 从最新 `origin/main` 开；
- 对 `main` 开 draft PR；
- 不合并、不部署、不打 tag。

PR 正文：

```md
feat(settings): 一句话

## 为什么
（用户问题 + 现状证据）

## 改了什么
（文件/行为）

## 没做什么
（明确非目标）

## 验证
（命令 + 原始输出；哪些没验证）

## 风险/回滚
（迁移、兼容、回滚）
```

硬约束：

- 不改 LiliLIN0324 的 PR/分支；
- 不重写、不重基、不强推 #151；
- 不叠在 #155 的分支上改；
- 不 `git add -A`；
- 不提交 `.env.local`、`node_modules`、`.next`、`out`；
- 不为了变绿改弱断言；
- 不恢复旧左轨执行表单；
- 不让设置依赖生成配额；
- 不预留未接线的空白开关。

---

## 13. 开放问题（需要产品拍板）

1. 「本方案」放在账户中心，还是方案信息/场地设置入口？如果放账户中心，无方案时如何呈现？
2. 方案时区是否需要跨设备/进分享？如果需要，是否接受一个只提升 `timeZone` 的契约 PR？
3. 方案显示单位是否要覆盖个人单位？如果要，分享查看器是否同步改造？
4. 团队报价抬头是“新建时快照”还是“实时继承团队”？建议身份字段实时继承、几何默认快照。
5. 货币默认值：保持现有 `$`，还是新团队默认 `CNY`？这会改变画布密度读数。
6. logo 是否本轮做？建议单独 PR，先做文本抬头。
7. 长度精度用 `auto/0/1/2` 小数位，还是绝对步长（0.01/0.1/1 m）？建议前者，避免英尺伪精度。

---

## 14. 附录：证据索引

| 主题 | 文件 |
|---|---|
| 设置页 UI | `frontend/components/room-organizer/panels/cloud-panel.tsx` |
| 本机偏好 | `frontend/components/room-organizer/lib/account-preferences.ts` |
| 云端偏好类型 | `frontend/lib/backend-session.ts:182` |
| PATCH 严格校验 | `supabase/functions/_shared/api.ts:303` |
| 偏好 SQL 白名单 | `supabase/migrations/20261112190000_user_preferences.sql` |
| ViewSettings | `frontend/components/room-organizer/lib/types.ts:534` |
| `G` 绑定 | `frontend/components/room-organizer/room-organizer.tsx:3626` |
| 户外吸附 | `frontend/components/room-organizer/room-organizer.tsx:682` |
| 键盘主源 | `frontend/components/room-organizer/hooks/use-keyboard-shortcuts.ts` |
| 键盘测试矩阵 | `frontend/components/room-organizer/hooks/use-keyboard-shortcuts.react.test.ts` |
| 标注快捷键 | `hooks/use-annotate-draw-shortcuts.ts`、`lib/annotate-draw-shortcuts.ts` |
| 户外 H/S | `components/outdoor-plan-canvas.tsx` |
| 时区字段 | `frontend/lib/event-profile.ts` |
| 硬编码上海 | `frontend/lib/event-day-sheet.ts:14` 等 6 个文件 |
| 本地侧车删除 | `frontend/lib/layout-export.ts:39` |
| 网格常量 | `frontend/components/room-organizer/lib/constants.ts:7` |
| 货币常量 | `frontend/components/room-organizer/lib/constants.ts:10` |
| 布局白名单 | `frontend/components/room-organizer/lib/schema.ts`（`LAYOUT_KEYS`） |
| 云端 Scene 契约 | `supabase/functions/_shared/domain.ts:136` |
| 场景重建 | `frontend/components/room-organizer/lib/backend-adapter.ts` |
| 分享快照 | `frontend/lib/share-snapshot.ts` |
| 工作室模型 | `frontend/lib/backend-session.ts`（`Studio`） |

术语：

- **个人偏好**：账号级，换方案仍在。
- **本方案**：当前活动方案级，跟这份活动走。
- **团队默认**：工作室级，只用于新建方案。
- **精度**：读数小数位，不是模型精度。
- **种子**：新建时复制团队默认，之后不追溯。
