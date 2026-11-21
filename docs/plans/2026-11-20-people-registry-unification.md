# 人物登记表统一：不同人群去重与性别化（大改计划）

> 生成日期：2026-11-20　|　状态：**P1–P3 已实施，P4 真机走查部分完成**（实施记录见 §十三）
>
> **范围**：物料库「不同人群」页、2D 布人员的岗位→人物解析、2D→3D 人群落点、漫游角色选择器。**不碰**素材文件、R2 对象、`supabase/functions` 契约、室内 `people.glb` 链路。
>
> **一句话**：把「谁可以出现在场地上」从两份并列清单（11 条基线 + 16 条 labor 追加）收敛成**一张登记表**：`人群类型 × 性别 → 唯一槽位`；旧的 5 张 PEOPLE-05 单模降级为只读别名，不再进选择器。物料卡从 27 张降到 22 张，人群类型从 9 行补到 13 行（含占位）。
>
> **这不是小修**：要动 17 个文件（11 个实现 + 6 个测试）和三条默认值链路（默认模型、派生路人、2D 岗位映射），所以按大改拆四个阶段、每阶段独立可验证、可回滚。

## 一、现状（已核实，非推断）

### 1.1 数字口径

| 项 | 现在 | 来源 |
| --- | --- | --- |
| 可漫游角色登记 | **27**（基线 11 + labor 16） | [walk-roles.ts](../../frontend/components/room-organizer/lib/walk-roles.ts) `WALK_ROLES`（:47）、`:60` 的 `...LABOR_WALK_ROLES` |
| 其中重复的人 | **5**（保安/警察/志愿者/主管/管理员各多一张单模） | 同上 `:55-59` |
| 人群类型 | **13** | [crowd-types.ts](../../frontend/components/room-organizer/lib/crowd-types.ts) `CROWD_TYPES`（:20） |
| 物料卡实际渲染 | **9 行 27 张** | [online-model-library.tsx](../../frontend/components/room-organizer/panels/online-model-library.tsx) `:747`、`:749`（`count === 0` 整行隐藏） |
| 素材库人物 | `bucket=people` **24**，含警察/消防员/医护等静态低模 | [merged.json](../../assets/library/merged.json)；976 条全库 sha256/路径无重复 |
| 低模登记表 | **空表**（2026-11-15 口径不启用） | `crowd-types.ts` `CROWD_TYPE_MODELS`（:55） |

### 1.2 重复的五个岗位（提示词逐字比对结果）

| 岗位 | PEOPLE-05 单模 | PEOPLE-06 对应槽 | 提示词 |
| --- | --- | --- | --- |
| 保安 | `…a007-b00000000007` 保安 | `security-m` `…a109-…` | **逐字相同** |
| 警察 | `…a008` 警察 | `police-m` `…a107-…` | **逐字相同** |
| 志愿者 | `…a009` 志愿者 | `volunteer-f` `…a110-…` | **逐字相同** |
| 管理员 | `…a00b` 管理员 | `admin-m` `…a10b-…` | **逐字相同** |
| 主管 | `…a00a` 主管 | `manager-f` `…a10e-…` | 仅西装颜色/裙装措辞不同 |

证据：[people05 manifest](../evidence/aholo/people05-crowd-uniform-batch/manifest.json) 的 `slots.*.prompt` vs [labor-gender.ts](../../frontend/components/room-organizer/lib/labor-gender.ts) `LABOR_GENDER_SLOTS`（:55）的 `prompt`。四组逐字相同，说明是同一描述生成了两次，出的是两个人、两张卡。

### 1.3 为什么当时会这样合

[2026-11-14-outdoor-walk-roadmap.md](2026-11-14-outdoor-walk-roadmap.md) §P1 写的是「统一角色登记表：人群类型 + 性别 → 首选 Aholo 槽位 / walk 模型 / 低模 / 占位」，把 `walk-roles` 与 `CROWD_TYPE_MODELS` 两套登记合并、接 16 槽与 `modelSource` 三态。实际落地是「16 槽并进 11 条」——登记表没建，两套语义靠 `spread` 拼在一起。`crowd-types.ts` 里「每个 slug 只属于一类，避免同一模型在多处重复出现」只在低模层生效，角色层没有对应约束。

### 1.4 已经影响到行为，不只是观感

1. **2D 人群落点取到旧模**：[plan-crowd-placement.ts](../../frontend/components/room-organizer/lib/plan-crowd-placement.ts) `defaultWalkAssetIdForType`（:76）取「该类型第一个可走角色」，旧条目在前 → 保安/警察/志愿者/主管/管理员点位在 3D 里挂的是 PEOPLE-05 单模，与面板里看到的男/女不一致。
2. **派生路人按名字反查**：[plan-crowd-derived.ts](../../frontend/components/room-organizer/lib/plan-crowd-derived.ts) `DERIVED_ROLE_POOL`（:113）写死 `'志愿者'`、`'保安'`，靠 `WALK_ROLES.find(role => role.name === name)`（:133、:209）解析；一旦改名/删名，这类路人会静默退回游客模型。
3. **流量预览同款**：[plan-traffic-preview.ts](../../frontend/components/room-organizer/lib/plan-traffic-preview.ts) `:79` 直接 `crowdType === 'volunteer'` 取第一个人，命中的也是旧单模。
4. **经理/主管语义串位**：`CROWD_TYPES` 有独立 `executive(经理)`，但 2D 岗位词表把「经理」映射到 `manager`（:33），2D 布「经理」出来的是主管模型。

## 二、目标与非目标

### 2.1 目标

- **G1 单一真源**：人物只有一张登记表；`walk-roles`、`crowd-types`、`labor-gender` 不再是三处并列的事实。
- **G2 一个岗位一种人**：同一 `(人群类型, 性别)` 在选择器里最多一张卡；默认解析稳定、可预测。
- **G3 旧方案不坏**：既有 `plan.workers[].assetId` 指向的旧单模仍能解析、仍能加载、仍能漫游；不删任何 R2 对象。
- **G4 空类目可见**：13 类都在，没有模型的显示「待补模型」，不再整行消失。
- **G5 不再"同名不同物"混在一起**：物料库里的静态低模与可漫游角色分开标注。

### 2.2 非目标（本轮明确不做）

- **N1** 不动 `supabase/functions/_shared/site-plan.ts` 的 `planWorkerSchema`（:271）——不加 `gender` 字段，不做数据迁移。
- **N2** 不删除、不重传、不改名任何 R2 对象；27 个 `people/<assetId>.glb` 全部保留可读。
- **N3** 不启用本地低模作漫游占位（保持 2026-11-15 口径：`CROWD_TYPE_MODELS` 仍为空表），只在登记表里留出 `lowpoly` 这一档。
- **N4** 不动室内 `assets/people.glb` 链路、不动 `glb-limits.ts` 的体积阈值。
- **N5** 不做自动化合并、不打 tag、不部署。

## 三、目标架构

### 3.1 新文件

`frontend/components/room-organizer/lib/people-registry.ts`（约 260 行）+ `people-registry.test.ts`。

登记表**接管**人物数据：6 个古装游客 + 16 个 labor 槽位 + 5 个旧单模（legacy）。`labor-gender.ts` 仍保留 16 槽的**生成批次档案**（prompt、assetId、ready、交接包出处），作为登记表的输入而不是第二套解析逻辑。

### 3.2 数据模型

```ts
export type PersonGender = 'male' | 'female';
export type PersonSource = 'walk' | 'lowpoly' | 'placeholder';

export interface PersonSlot {
  /** 稳定身份：`security:male` / `visitor:tang-female` / `legacy:security` */
  id: string;
  crowdType: CrowdTypeId;
  gender: PersonGender | null;   // legacy 单模无性别 → null
  name: string;                  // 保安男 / 唐女 / 保安（旧）
  image: string;                 // /assets/avatars/...
  source: PersonSource;
  walkable: boolean;
  note?: string;                 // 无坐姿动作 · 落座按下沉对位
  assetId?: string;              // walk：云端 GLB 代号
  slug?: string;                 // lowpoly：素材库 slug（本轮为空）
  legacy: boolean;               // true = 只还原、不进选择器
}
```

### 3.3 组装规则（唯一性由构造保证，不靠调用方自觉）

| 输入 | 产出 | 规则 |
| --- | --- | --- |
| `WALK_ROLES` 原 6 个古装角色 | 6 个 `visitor` 槽 | 性别按名字显式标注（唐女/宋女/明女 → female，唐男/宋男/明男 → male），**不用正则猜** |
| `LABOR_GENDER_SLOTS`（16） | 16 个槽 | 每槽 `crowdType + gender` 必须在全表唯一；重复即模块加载时报错（fail fast） |
| 原 `:55-59` 五个单模 | 5 个 `legacy: true` 槽 | 保留 `assetId`、保留 `walkable`、`gender: null`、**不进**任何选择器 |
| `CROWD_TYPE_MODELS`（空） | 本轮 0 个 `lowpoly` 槽 | 表非空时按同一套 API 自动出现，不用改 UI |

`people-registry.ts` 里写死一张 `LEGACY_ALIASES: Record<string, string>`（旧 assetId → 新槽 id），只用于「旧方案还原」提示，不参与默认值。

### 3.4 对外 API（替换现有三处散装查询）

```ts
peopleRegistry(): readonly PersonSlot[]        // 含 legacy，供测试/统计
selectablePeople(): readonly PersonSlot[]      // 不含 legacy，供选择器
peopleOfType(type: CrowdTypeId): readonly PersonSlot[]
gendersOfType(type: CrowdTypeId): readonly PersonGender[]
defaultPersonForType(type: CrowdTypeId): PersonSlot | null
findPerson(assetId: string | undefined): PersonSlot | null   // 含 legacy
resolveWorkerPerson(worker: { role: string; assetId?: string }): PersonSlot | null
```

**默认值规则（保持旧外观，不制造新惊喜）**：默认性别沿用 PEOPLE-05 那一版的性别，未绑定点位换表后外观不变。

| 类型 | 默认 | 依据 |
| --- | --- | --- |
| security / police / admin | male | PEOPLE-05 三张单模均为男 |
| volunteer / manager | female | PEOPLE-05 两张单模为女 |
| fire / medical / executive | male | 只有 labor 批次，取男槽为默认 |
| visitor | 取登记顺序首位（唐女），与旧行为一致；选择器里 6 张并列 | 古装角色无岗位概念 |

### 3.5 不变量（写进测试，永不再漂移）

1. `selectablePeople()` 中 `(crowdType, gender)` 唯一。
2. `selectablePeople()` 不含 `legacy`。
3. `findPerson('…a007…')` 返回 legacy 保安，`walkable === true`。
4. `defaultPersonForType` 永不返回 legacy，且符合 §3.4 表格。
5. 每个 `CROWD_TYPES` 至少有一个槽或明确标为 `placeholder`。
6. `peopleRegistry()` 的 `assetId` 集合 ⊆ `LOCAL_WALK_ASSET_IDS`（27 个），反向也成立。

## 四、迁移面（按依赖顺序改）

> 合计 **17 个文件**：11 个实现（含 1 个新建）+ 6 个测试（含 1 个新建）。下表第 12 行是那 6 个测试，合并成一格。

| # | 文件 | 现在 | 改成 |
| --- | --- | --- | --- |
| 1 | `lib/people-registry.ts`（新） | — | 登记表 + 六个 API |
| 2 | `lib/walk-roles.ts` | 自己拼 11+16 | 改成**兼容视图**：从登记表派生 `WALK_ROLES`（22 条可选）、新增 `LEGACY_WALK_ROLES`；`findWalkRole` 查全表（含 legacy）；`walkRoleGlbUrl` 保留 |
| 3 | `lib/crowd-types.ts` | `crowdDirectory()` 自己过滤 `WALK_ROLES` | 改为从登记表组装；`CROWD_TYPES_WITH_WALK_MODELS` 保持派生口径 |
| 4 | `lib/plan-crowd-placement.ts` | `defaultWalkAssetIdForType` 取第一个 | 改为 `defaultPersonForType`；`ROLE_TO_CROWD` 的「经理」待拍板（§11-D2） |
| 5 | `lib/plan-crowd-derived.ts` | 名字池 + 名字反查 | 角色池改成 `{type, gender}` 结构；`derivedRoleAt` 用 slot id；顺带让志愿者/保安各出男女两款（视觉不再一模一样） |
| 6 | `lib/plan-traffic-preview.ts` | 取第一个 volunteer | 用 `defaultPersonForType('volunteer')` |
| 7 | `panels/online-model-library.tsx` | 每类罗列全部 walk 角色 | 每类只列可选槽（保安 2 张）；空类目出占位行；物料库手风琴行改名「人物低模（静态）」 |
| 8 | `components/outdoor-plan-canvas.tsx` | `workerRoleOptions`（:10313）平铺 27 条 | 按类型分组 22 条；已绑旧单模的点位额外显示那一条（§5.2）；选择写 `worker.assetId`，**不改 schema** |
| 9 | `components/outdoor-plan-3d.tsx` | `findWalkRole(assetId).image`（:1432） | 换成 `findPerson`，legacy 显示「（旧）」后缀 |
| 10 | `components/room-organizer/room-organizer.tsx`（:5272 一带） | 透传 `WALK_ROLES.map(...)` | 透传 `selectablePeople()` |
| 11 | `lib/glb-limits.ts` | 27 个 id 白名单 | **不动**，只补一行注释说明 legacy 为何保留 |
| 12 | 6 个测试文件 | 锁的是「11+16=27」 | 改成锁 §3.5 不变量（见 §8） |

## 五、界面方案

### 5.1 物料 →「不同人群」页

- 13 行全出（含 4 个占位：工作人员 / 演员 / 展商 / 观众），占位行显示「待补模型 · 可用人位标记布点」，沿用 `MATERIAL_GROUP_EMPTY_HINT` 的口径。
- 有模型的 9 行：**每类只出可选人**。保安/警察/志愿者/主管/管理员各 2 张（男、女）；消防/医护/经理各 2 张；游客 6 张。合计 **22 张**。
- 卡面名保持「保安男 / 保安女」，不改成「保安 · 男」——2D 岗位名、导出清单、Agent 语料都按字符串匹配，改名会波及三处。
- 页首 `CharacterDesignPanel` 不动。

### 5.2 2D 属性卡「固定角色」

- 下拉平时 22 条；**仅当**当前点位已绑定旧单模时，额外出现那一条（值 = 旧 assetId，标签带「旧单模，建议换男/女」），否则列表里不出现。
- 性别切换 = 写 `worker.assetId`（指向对应槽）。**不新增 `gender` 字段**，老快照、Edge Function 校验、CSV/GeoJSON 导出全部不用动。

### 5.3 2D 左栏「工作人员」

9 行岗位按钮**不动**：一岗一图标、一岗一色，性别是点位属性（labor-gender 的既有口径）。点岗位仍是布人位，落哪个模型由 §3.4 默认表决定。

## 六、契约、数据与云端边界

- `planWorkerSchema.role: string` + `assetId?: uuid` 足够表达「岗位 + 具体某人」；性别通过 `assetId` 落地，**不需要契约变更**。
- 旧方案里 `assetId` 指向 `a007…a00b` 的点位：`findPerson` 命中 legacy，3D 照常加载，HUD 显示「（旧）」；不做静默替换。
- R2 27 个对象全部保留；`glb-limits` 白名单不减。
- 若将来要在点位层持久化性别（而不是 assetId 绑定），另开 P5 提案交契约 owner review——本轮明确不做。

## 七、实施顺序（每阶段独立可验收）

### P0 基线（不动代码）

- 跑并记录：`npm --prefix frontend run typecheck`、`npm --prefix frontend run test`（记录既有红条，作为「既有失败」基线）。
- 现状读数存档：不同人群 9 行 27 张、2D 固定角色 27 条。
- **完成判据**：基线日志里能指出本次改动前已红的用例名。

### P1 登记表 + 纯函数层（不改 UI）

- 新增 `people-registry.ts` + 测试；`walk-roles.ts` 改成派生视图；`crowd-types.ts` 的 `crowdDirectory` 改接登记表；`plan-crowd-placement` / `plan-crowd-derived` / `plan-traffic-preview` 三处换 API。
- **验证**：`npm --prefix frontend run typecheck`；`npm --prefix frontend exec -- vitest run components/room-organizer/lib/people-registry.test.ts components/room-organizer/lib/walk-roles.test.ts components/room-organizer/lib/crowd-types.test.ts components/room-organizer/lib/plan-crowd-placement.test.ts components/room-organizer/lib/plan-crowd-derived.test.ts`。
- **完成判据**：§3.5 六条全绿；`planCrowdPlacements` 未绑定点位的 `assetId` 不再是 `…a007…`。

### P2 界面收口

- 物料卡「不同人群」页（22 张 + 4 占位）；2D 固定角色下拉（22 + 旧角色单条）；物料库手风琴行改名。
- **验证**：`npm --prefix frontend run lint`；`npm --prefix frontend exec -- vitest run components/room-organizer/panels/online-model-library.react.test.tsx`。
- **完成判据**：`data-crowd-type="security"` 下正好 2 个按钮；`data-crowd-type="performer"` 出现占位行且不报错。

### P3 清理与护栏

- 删掉 `walk-roles.ts` 里 `...LABOR_WALK_ROLES` 的直拼与 `crowd-types` 里的双写过滤；补 §3.5 不变量；`glb-limits` 补注释。
- CHANGELOG 追加一版（按 [版本更新文案规范](../65-版本更新文案规范.md)：≥10 条、三节标题、≥1200 字），跑 `npm run check:changelog`。
- **完成判据**：`npm --prefix frontend run typecheck` + 全量 `npm --prefix frontend run test` 与 P0 基线对比，无新增红条；`npm run check` 通过。

### P4 真机验收

- `npm --prefix frontend run dev`，物料 → 不同人群：数 9 行有模型 + 4 行占位 = 13 行、22 张卡；逐张看头像加载、console 0 error。
- 2D 布一个「保安」点位 → 3D 看是男款、不是旧单模；绑定 `a007` 的旧方案打开后仍显示人，HUD 带「（旧）」。
- 漫游进入：选「保安女」走一圈，`Idle/Walk` 正常、无坐姿提示仍在。
- **完成判据**：以上读数写进提交说明，含命令与原始输出。

## 八、测试计划（新增/改写）

`people-registry.test.ts` 新增：

1. `(crowdType, gender)` 唯一；重复构造直接抛错。
2. `selectablePeople()` 22 条、无 legacy。
3. legacy 五条 `walkable` 仍为 true，`findPerson` 可命中。
4. `defaultPersonForType` 六类符合 §3.4 表。
5. `peopleOfType('security').map(p => p.name)` 等于 `['保安男', '保安女']`。
6. 所有 `assetId` 与 `LOCAL_WALK_ASSET_IDS` 双向一致。

改写：

- `walk-roles.test.ts`：弃「11 + 16」断言，改「22 可选 + 5 legacy」。
- `crowd-types.test.ts`：保留「每个 walk 角色只归一类」，新增「目录项里不出现 legacy assetId」。
- `plan-crowd-placement.test.ts`：`assetIdOf('警察')` 之类按名字取角色的助手改成按 slot id。
- `plan-crowd-derived.test.ts`：断言 `derivedRoleAt(8).crowdType === 'volunteer'`、`derivedRoleAt(11).crowdType === 'security'`（防止名字改动后退回游客）。
- `online-model-library.react.test.tsx`：现状**不覆盖**「不同人群」页（全文件没有相关断言），P2 新增 2 条——`security` 下正好 2 个按钮、`performer` 出占位行；不要删既有 44 条断言（实测 `it(` 计数）。

## 九、验收命令

```bash
npm --prefix frontend run typecheck
npm --prefix frontend run lint
npm --prefix frontend run test
npm --prefix frontend run build
npm run check
npm run check:changelog
```

定向调试用 `npm --prefix frontend exec -- vitest run <path>`（与根 `package.json` 里 `test:integration` 同一种调用形态）。

## 十、风险与回滚

| 风险 | 影响 | 处置 |
| --- | --- | --- |
| 旧方案 `assetId` 指向 legacy | 3D 加载不出人 | `findPerson` 覆盖全表；P4 用 `a007` 实测 |
| 名字匹配的隐藏依赖（派生路人、测试助手） | 静默退回游客 | P1 一并改按 id；测试 4 条兜底 |
| 面板新用例依赖 `data-crowd-type` 属性 | P2 一改就无声回归 | 用已存在的 `data-crowd-type` 写断言，不只比总数 |
| 默认性别选错 | 既有未绑定点位换脸 | 默认表沿用 PEOPLE-05 性别，P4 逐类目测 |
| 物料库 24 个低模被误解为重复 | 用户仍觉得乱 | 手风琴行改名「人物低模（静态）」，页内加一句「不可漫游」 |

**回滚**：2 个新文件 + 15 个文件的引用/断言替换，无数据迁移、无 schema 变更、无云端写入；回滚 = revert 单次提交，旧方案与素材完全不受影响。

## 十一、需要拍板的四件事（附我的建议）

| 编号 | 问题 | 建议 |
| --- | --- | --- |
| D1 | 未绑定点位默认出男还是女 | 按 §3.4 表沿用 PEOPLE-05 性别，外观不变 |
| D2 | 2D「经理」现在落到主管模型（`ROLE_TO_CROWD` :33），改不改 | 改：`经理 → executive`，让 2D 与 3D 同类目一致；会换掉既有「经理」点位的模型，需你在 P2 前确认 |
| D3 | 没有模型的 4 类是否显示占位行 | 显示，否则用户以为类目丢了（与 `crowd-types.ts` 注释口径一致） |
| D4 | 物料库那 24 个静态低模怎么标 | 手风琴行改名「人物低模（静态）」，`bucket` 与筛选键都不动 |

## 十二、工作量与提交

- 规模：预计新增 ~260 行（登记表 + 测试），改动 **17 个文件**（11 实现 + 6 测试）、预计净删 ~80 行重复登记。
- 节奏：P1 半天、P2 半天、P3 半天、P4 真机一轮；每阶段可单独停。
- 提交：直接 `main`，一处改动收口后一次提交；`feat(people): 统一人物登记表，不同人群去重并按岗位性别落地`（正文写「为什么」+ 命令与原始输出 + 刻意没做的事）。不 `git add -A`，不推、不打 tag。

## 十三、实施记录（2026-11-20）

**已完成**：登记表（`people-registry.ts`）、`walk-roles.ts` 兼容视图、`crowd-types.ts` 目录重接、三条默认值链路（`plan-crowd-placement` / `plan-crowd-derived` / `plan-traffic-preview`）、面板去重与占位行、2D 固定角色分组与旧模单条、低模行改名、CHANGELOG v4.17.16（含 `package.json` 两处版本号）。

**验证读数**：

- `npm --prefix frontend run typecheck` → 0 错。
- 定向 7 个套件 → 107 例全绿（含新增 `people-registry.test.ts` 8 例、面板新增 2 例）。
- `npm --prefix frontend run lint` → 0 error（2043 条既有 warning）。
- `npm --prefix frontend run build` → 静态导出成功，`check-oneplan-artifacts` 违规 0 条。
- 全量前端 `vitest run` → 10040 通过 / 235 失败 / 75 跳过；失败集中在夹具、文案断言与性能阈值（如 `scene-layers` 的 `INITIAL_LAYOUT.items[0]` 为空、`site-plan-legend` 的 `2 × 2 m m`），**与人物链路无关**；已用 HEAD 版复跑 `site-plan-legend` / `scene-layers` / `shared-seating-placement` 三个套件，仍然 17 例红，判定为既有失败。
- 根 `npm run check` → typecheck 0 错；`tests/` 24 例红（PGlite、`model200.json` 290 vs 279 等），既有失败，未动。
- `npm run check:changelog` → v4.17.16 PASS；整体仍有 52 处来自 v4.15.0–v4.17.15 旧条目，既有失败，未顺手修。
- 真机（本机 dev，Chromium）：物料 → 不同人群 → **13 行**（4 行占位）、**22 张卡**；保安展开只有「保安男 / 保安女」；物料库行显示「人物低模（静态）· 不可漫游 · 24」。

**未做**：2D 布人员→3D 落点的目视核对、绑定 `a007` 旧方案打开的目视核对（两者目前只有单测覆盖：默认性别与 legacy 绑定各一条）。

## 附：本次核实过的边界（避免后人重复排查）

- 素材层没有重复：976 条模型 sha256 / glb 路径 / 缩略图三向零重复；`people` 24 条无同网格近似重复（奔跑/自然站立两者 byte 数相同、sha 不同，是同一拓扑的不同姿势）。
- `planWorker` 无性别字段；`assetId` 是可选 uuid，旧快照不带照常解析（`site-plan.ts:285-286` 注释即此口径）。
- `CROWD_TYPE_MODELS` 自 2026-11-15 起为空表，`crowd-types.test.ts` 有断言锁死；本轮不启用。
