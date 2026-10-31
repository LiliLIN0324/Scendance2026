# 幕景 Scendance 整改方案（含优先级）

> 编制日期：2026-10-07
> 核查基线：`main` @ `d139da7`（tag `v0.8.0`）
> 证据方式：对仓库源码逐项核查，结论均附文件与行号；未做代码改动
> 关联诉求：① 2D→3D 空间准确性（尤其入口）② 3D 布局规划 ③ 接入模型的选型判断

---

## 0. 结论摘要

三条诉求都不是"调参就能变好"的效果问题，而是**数据模型与算法层面的能力缺失**：

| 诉求 | 真实根因 | 性质 |
| --- | --- | --- |
| ① 入口把控不住 | `entrances` 只有 `{id, position, width}`，无朝向/主次；AI 重建强制清空；编辑器改动不回写 | **数据模型缺字段 + 单向丢失** |
| ② 布局规划不行 | 系统内不存在动线/净宽/疏散计算，相关要求被代码强制降级为 `partial` | **算法缺失** |
| ③ 选型判断不准 | 喂给模型的只有"中文名 + 19 个粗类别 + 不可靠包围盒"，无 tags/描述/视觉 | **元数据缺失** |

并且存在一个**元问题**：三条诉求目前都**没有被评测过**（无标注集、无度量），因此任何改动都无法证明"变好了"。所以阶段 0 必须先建度量。

---

## 1. 优先级总览

| 优先级 | 编号 | 事项 | 对应诉求 | 估算 | 依赖 |
| --- | --- | --- | --- | --- | --- |
| **P0** | 0.1 | 建立识别准确率评测基线 | ①② | 3–5 人日 | — |
| **P0** | 1.1 | 入口语义建模（朝向/主次/回写） | ① | 5–8 人日 | 0.1 |
| **P0** | 1.2 | 模型库元数据补齐 + 可摆放池纠偏 | ②③ | 5–10 人日 | — |
| **P1** | 0.2 | 建立布局质量评测基线 | ② | 3–5 人日 | — |
| **P1** | 2.1 | 动线/净宽可计算校验 | ② | 10–15 人日 | 1.1, 0.2 |
| **P1** | 1.3 | 尺寸可信度分层（bbox ≠ 真实尺寸） | ②③ | 2–3 人日 | 1.2 |
| **P1** | 3.1 | 版本号 / CHANGELOG / tag 对齐 | — | 0.5–1 人日 | — |
| **P2** | 3.2 | 测试命令可靠性（`npm test` 大面积红） | — | 1–2 人日 | — |
| **P2** | 3.3 | 分支与交付基线收敛（含双仓库） | — | 1–2 人日 | 3.1 |
| **P2** | 3.4 | 仓库瘦身（预览图 / 模板 GLB / LFS） | — | 2–3 人日 | 3.3 |
| **P2** | 3.5 | 注册邮件链路验证 | — | 1–2 人日 | — |
| **P2** | 2.2 | 两套空间模型收敛（house-builder ↔ Scene v2） | ①② | 15–25 人日 | 1.1, 2.1 |

**建议排期**：阶段 0（度量）→ 阶段 1（P0 修复，与阶段 0 部分并行）→ 阶段 2（算法补齐）→ 阶段 3（工程治理，可随时穿插）。

---

## 2. 阶段 0：度量先行

### 0.1 建立识别准确率评测基线 — P0

**问题**：系统从未评测过识别精度。文档自己声明 1 毫米阈值"不能表述为图片识别精度"，"模型识别准确率需使用人工标注的实际图纸和照片另行评测"（[floorplan-v2.md](./floorplan-v2.md)）。

**改法**

1. 准备 20–30 份真实图纸 + 现场照片，人工标注真值（墙段、门窗、柱、入口位置/宽度、层高）。
2. 复用现有离线管线（`scripts/local-floorplan.ts`、PGlite）跑评测，**不依赖云环境与计费**。
3. 输出指标：墙段端点误差（米）、墙数/门窗数召回与误报、入口位置误差、层高误差、`detected→confirmed` 人工核对耗时。
4. 每次改动识别提示词或尺度算法后自动重跑，结果存档（参照 `docs/evidence/` 的 JSON 存证风格）。

**验收标准**：仓库内存在可复现的评测脚本 + 真值集 + 基线报告；给出"识别准确率 X%"这样可引用的数字。

**依赖**：无（**应最先做**，否则 1.1 / 2.1 无法验证效果）。

---

### 0.2 建立布局质量评测基线 — P1

**问题**：布局好坏无度量，"避免重叠、留实际通道"只是提示词里的期望。

**改法**：定义可计算的布局指标并在离线场景集上测量：

- 重叠/穿墙数量（已有 `OBJECT_OVERLAP`、`WALL_COLLISION` 可直接计数）
- 通道净宽最小值（需 2.1 提供计算）
- 入口到关键设施的可达性
- 要求满足率（当前 `satisfied` 几乎都会降级为 `partial`，需区分"真满足"与"未验算"）
- 用户采纳率（线上埋点可选）

**验收标准**：指标定义文档 + 离线脚本 + 基线数值。

---

## 3. 阶段 1：P0 修复

### 1.1 入口语义建模与回写 — P0

**问题（三处叠加）**

1. 字段本身表达力不足：`entrances` 仅 `{id, position, width}`，**没有朝向、门扇信息、主/次入口角色**——"入口朝哪、哪扇是主入口"在契约里无法表达（[domain.ts:55](../supabase/functions/_shared/domain.ts:55)）。
2. AI 重建**主动清空**：提示词要求 `venue.entrances必须为[]`（[reconstruction.ts:79](../supabase/functions/_shared/reconstruction.ts:79)），重建一次即永久退化为匿名"门洞"。
3. 编辑器**不回写**：v2 场景保存时入口原样透传（`if (layout.backendSceneV2) return original;`，[backend-adapter.ts:151](../frontend/components/room-organizer/lib/backend-adapter.ts:151)）；v2 加载时也只渲染 `openings` 而不生成"主要出入口"物件（[backend-adapter.ts:119](../frontend/components/room-organizer/lib/backend-adapter.ts:119)）；`createMeasuredRoomLayout` 直接写死 `entrances: []`（[backend-adapter.ts:243](../frontend/components/room-organizer/lib/backend-adapter.ts:243)）。

**结果**：用户在编辑器里挪门/改门后，`venue.entrances` 保持旧值，**位置与几何脱节**，且流程内无法声明"哪扇是主入口、朝哪个方向"。

**改法**

1. **契约扩展**（`domain.ts`）：给 entrance 增加可选字段——
   - `role: 'main' | 'secondary' | 'service' | 'emergency'`
   - `facing: 'north' | 'south' | 'east' | 'west'`（或由 wallId + 法线推导，二者取一，不要并存两套真值）
   - `wallId?: uuid`（与 v2 `openings` 建立显式关联，替代"靠坐标猜"）
   - `doorSwing?: 'in' | 'out' | 'none'`、`sillHeight?`
   - 保持全部可选以兼容 v1；`venueSchema` 是 `strictObject`，**新增字段必须同步前端与 `client/` 的解析器**，否则历史数据会解析失败。
2. **建立唯一真值方向**：明确"入口"以 `structure.openings(kind='door') + role` 为准，`venue.entrances` 降级为兼容视图（或反过来）。**不要继续同时维护两套**。
3. **打通回写**：`layoutToBackendScene` 对 v2 场景改为从编辑后的 openings 重新推导入口属性；移除 `return original` 的短路。
4. **重建不再清空**：修改 [reconstruction.ts:79](../supabase/functions/_shared/reconstruction.ts:79) 提示词，要求识别出的外门一并标注 `role`（至少区分主入口），并允许写回 `venue.entrances`。
5. **UI 补入口编辑**：允许用户指定/改判主入口与朝向（当前只能通过 `scene-preview.tsx:108` 的标记看到，无编辑入口）。

**验收标准**

- 新建项目 → 上传图纸 → AI 重建 → 挪动门 → 保存 → 重新打开，**入口位置/角色/朝向全程一致**，无脱节。
- 契约兼容测试：v1 老场景可读可存，不触发 `INVALID_SCENE`。
- 加入"入口一致性与回写"的回归测试（当前测试夹具中 `entrances: []` 几乎恒为空，覆盖为零）。

**风险**：`strictObject` 契约变更需要前后端 + `client/` 同步发版；建议按"仅新增可选字段"的方式做，避免破坏线上客户端。

---

### 1.2 模型库元数据补齐与可摆放池纠偏 — P0

**问题**

- 传给模型的上下文只有 4 列：`[resourceId, name, category, sizeMeters]`（`resourceIndex`，[scene-resources.ts](../supabase/functions/_shared/scene-resources.ts)），单次上限 100 条（[agent-runner.ts:118](../supabase/functions/_shared/agent-runner.ts:118)）。
- `assets/library/merged.json` 529 个模型**只有** `slug/name/originalName/bucket/subcategory/width/depth/height/bytes/triangles/glb/thumb/page/cdnUrl/sha256/license/sources/aliases/assetId`——**无 tags、无 description、无风格/材质/颜色/容纳人数/适用场景**，`aliases` 全空。
- 类别仅 19 个子类，且**把 `建筑结构`(43) 与 `后勤设施`(41) 也放进可摆放池** → 模型会把结构件当家具选。
- 自建/个人 GLB 的 `category` 被写死为 `'个人素材；尺寸待指定'` 且**无尺寸** → 模型完全无从判断。
- `thumb` 缩略图存在，但**从未传给模型**（无视觉输入）。
- 内置只有 8 个 `materialId`（[domain.ts:22](../supabase/functions/_shared/domain.ts:22)），与 529 条库资源之间**无映射**。

**改法**

1. **补元数据**：
   - 用视觉模型（HY3 / DeepSeek 视觉均可）对 529 个模型批量生成结构化标签：`tags[]`、一句话描述、风格、主色、材质、典型用途、可容纳人数（如适用）。
   - 用 `bucket` + `subcategory` 派生初稿，再人工抽检修正（建议抽检 ≥15%）。
   - 填充 `aliases`（中英别名、口语词），提升检索命中率。
2. **可摆放池纠偏**：把 `建筑结构`、`后勤设施`、`人物角色` 等**非家具类**从默认候选池移出，仅在明确意图时可用；对每个子类标注 `placeablePolicy: always | on-request | never`。
3. **给模型视觉**：把 `thumb` 以缩略图数组传给模型（或做两阶段：先按文本召回 20 条，再让视觉模型从缩略图选 3 条）。
4. **个人素材**：缺类别/尺寸时，先要求模型调用 `inspect_materials` 或直接**不进入候选池**，而不是塞一个无意义的类别字符串。
5. **扩大检索上限或改为多轮检索**：100 条硬上限对 529 条库偏紧，建议按类别分桶检索。

**验收标准**

- 选型评测集（0.3 或 0.2 附带）上，"给定需求 → 选出合适模型"的准确率有基线并提升。
- 抽样 50 条：非家具类不再出现在默认候选；每条至少有 tags + 描述 + 明确 `placeablePolicy`。
- 回归：`tests/merged-library.test.ts` 对新字段仍通过。

---

### 0.3 建立选型准确率评测基线 — P0（与 1.2 配套）

**改法**：构造 30–50 条"需求描述 → 期望模型类别/具体模型"的评测样本，人工判定；覆盖模糊需求与近似类别干扰项。

**验收标准**：脚本 + 样本集 + 基线准确率；1.2 改动前后可直接对比。

---

## 4. 阶段 2：算法与结构补齐

### 2.1 动线 / 净宽可计算校验 — P1

**问题**

- 代码**主动承认**没有动线计算：凡命中 `通道|净宽|动线|疏散|连通性|aisle|clearance|egress|circulation` 的要求，一律强制降级为 `partial`，理由原文"当前尚未建立可计算的通道路径"（[reconstruction.ts:67](../supabase/functions/_shared/reconstruction.ts:67)、[:69](../supabase/functions/_shared/reconstruction.ts:69)）。
- 唯一几何校验是穿墙/重叠（`WALL_COLLISION`、`OBJECT_OVERLAP`，[structural-geometry.ts:23](../supabase/functions/_shared/structural-geometry.ts:23)），无净宽、分区、视线、疏散。
- 方案比较也无法判断动线：`cannot establish global circulation or safety`（[jev.ts:23](../supabase/functions/_shared/jev.ts:23)）。
- 文档承认疏散路径未做几何验算（[floorplan-verification.md:59](./floorplan-verification.md)）。

**改法**

1. 在 `structural-geometry.ts`（前后端共享的纯几何模块）新增：
   - **可通行网格**：场地离散化，按物件占地 + 门洞宽度做占据/通行判定
   - **净宽计算**：给定起终点（如入口 → 签到台），计算最窄处净宽
   - **连通性**：入口到各分区/固定设施是否可达
   - **疏散路径**：到最近出口的最短路径（可作为净宽的特例）
2. 新增 `REQUIREMENT_UNVERIFIED` 与 `AISLE_TOO_NARROW` / `UNREACHABLE` 之类错误码，把当前"一律 partial"改为**真的能算**：能算的给 `satisfied/unmet`，算不了的才留 `partial` 并说明原因。
3. 把净宽/连通性接入 AI 提案校验与 JEV 方案比较（这样"方案 B 动线更好"才有依据）。
4. 明确性能边界：网格分辨率、物件上限（当前 ≤50 物件）下的耗时预算。

**验收标准**

- 给定"通道净宽 ≥1.5 米"的要求，系统能给出**数值结论**而非 `partial`。
- 构造窄通道用例能被拦截；`reconstruction.test.ts:99-101` 中"降级为 partial"的断言按新语义更新。
- 前后端共用同一实现，前端提示与后端保存结论一致（不允许只在 UI 变红）。

**依赖**：1.1（入口是动线起点）、0.2（否则无法判断指标是否改善）。

---

### 1.3 尺寸可信度分层 — P1

**问题**：`size` 直接取 GLB 包围盒，而代码自己注释 `Raw GLB bounds are not a statement of real-world dimensions`，还被 clamp 到 `[0.02, 50]` 并四舍五入到毫米（`libraryResources`，[scene-resources.ts](../supabase/functions/_shared/scene-resources.ts)）。模型的尺寸推理建立在作者自己声明不可靠的数字上。

**改法**

1. 给尺寸加来源分层：`measured | estimated | bbox`（与既有 `procurementStatus: 'needs_confirmation'` 语义对齐）。
2. `resourceIndex` 把来源一并传给模型，让模型知道"这个尺寸只是占位"。
3. 对关键物件（舞台、桌椅、通道相关）要求真实尺寸，缺则显式询问，而不是拿包围盒当真实尺寸。
4. 明确禁止用包围盒数字做承载/容量/安全结论。

**验收标准**：模型可见尺寸来源；抽查场景中所有影响通道计算的物件均为 `measured` 或已明确标注为占位。

---

### 2.2 两套空间模型收敛 — P2

**背景**：前端 `room-organizer` 源自 MIT 项目 `threejs-sims-house-builder`（固定提交 `ab646476`，见 [PLAN.md](../PLAN.md:95)、[UPSTREAM-LICENSE](../frontend/UPSTREAM-LICENSE)），其布局模型是**住宅设计器**语义：楼层、地形、门廊、**凹入式入口**、成就系统（内部 issue 号 #204/#273/#285/#357/#382/#394）。

后端 Scene v2 是**活动场地**语义：多边形轮廓、参数墙、门窗开口、柱子。

二者靠 `backend-adapter.ts` 有损互转，且互转处大量抛错（`STRUCTURE_NOT_SUPPORTED`、`MIRROR_NOT_SUPPORTED`、`FLOORPLAN_NOT_SUPPORTED`、`POLYGON_NOT_SUPPORTED`…）。**这正是入口问题的结构性来源**：同一个"入口"在两套模型里含义不同。

**改法（择一，建议先评估再动）**

- **方案 A（推荐，成本较低）**：保留 house-builder 作为渲染/交互层，**明确它只是 Scene v2 的视图**，把两套语义差异集中到一个显式映射表并补齐单向丢失的字段（与 1.1 合并）。
- **方案 B（成本高）**：以 Scene v2 为唯一真值，替换 `room-organizer` 的布局数据结构，逐步剥离楼层/地形/门廊等与本产品无关的概念。

**验收标准**：adapter 中"抛错阻止保存"的路径数量下降；不再出现同一语义两处存储；`docs` 中新增一页"两套模型映射说明"。

---

## 5. 阶段 3：工程治理（可穿插进行）

### 3.1 版本号 / CHANGELOG / tag 对齐 — P1

**问题**：`package.json` 与 `frontend/package.json` 均为 `0.6.0`，[CHANGELOG.md](../CHANGELOG.md) 最新也只到 `0.6.0`，但 tag 已到 **`v0.8.0`** → `0.7.0`/`0.7.1`/`0.7.2`/`0.8.0` 既无版本号也无变更记录。

**改法**：从 `git log` 反推补齐 CHANGELOG 四个版本条目；把两个 `package.json` 的 `version` 提升到 `0.8.0`；在 `scripts/` 加一个发版前校验脚本（tag 与 version 不一致即失败）。

**验收标准**：`tag === package.json.version === CHANGELOG 最新条目`，且由脚本强制。

---

### 3.2 测试命令可靠性 — P2

**问题**：README 与 `package.json` 的 `check`/`test` 均为 `vitest run tests/`（未限制 worker）。本次实测：**18 个测试文件失败/超时**（多为 30s 超时）；按 [floorplan-v2.md](./floorplan-v2.md) 加 `--maxWorkers=2` 后降到 **2 文件 3 用例**失败（`config.test.ts`、`hunyuan-config.test.ts`，5s 默认超时 + 依赖本地 CLI/密钥文件）。**干净检出"照文档跑"会大面积红**。

**改法**

1. 把 `--maxWorkers=2`（或按 CPU 自适应）固化进 `vitest.config.ts` / npm script，让文档命令与 CI 一致。
2. 把需要外部 CLI/密钥的 preflight 测试标记为 `skipIf(!existsSync(secretFile))` 或拆到独立 `test:preflight`，不让它们污染主测试。
3. 提升进程内启动类测试的 timeout。

**验收标准**：干净检出 + `npm ci` 后，**照 README 单条命令即可全绿**；CI 与本地一致。

---

### 3.3 分支与交付基线收敛 — P2

**问题**

- 默认分支 `main` **不是集成分支，而是"线上快照分支"**：README 自述"本次整理不…合并到 main"，而 tag `v0.8.0` 又指向它。
- 本地 11 个分支、远端 21 个分支，多个 upstream 显示 `gone`（`codex/integrate-v0.2.1`、`feat/*`、`ui/complete-project-version`、`version` 等）。
- **双仓库并存**：`LiliLIN0324/scendance` 与 `LiliLIN0324/Scendance2026`。2026-10-07 已按用户要求把本地 `main` 强推到 `Scendance2026/main`，**远端原有 6 个提交被覆盖**（`842cfc9`、`40bd91c`、`9f7a71b`、`66344ba`、`51660c6`、`5eb9797`）；旧内容仍可通过 `Scendance2026` 上的 **`v0.7.2` tag（指向 `842cfc9`）** 找回。

**改法**

1. 明确唯一交付仓库；另一个设为只读归档或直接归档。
2. 定义分支策略：`main` = 集成分支；线上快照单独用 `release/*` 或 tag 表达，不要占用默认分支。
3. 清理已 `gone` 的本地分支（保留有 PR/证据价值的并归档说明）。
4. 补齐 `Scendance2026` 的 tag 与分支基线说明（tag 已同步到 `v0.8.0`）。

**验收标准**：仓库首页 README 能一句话说清"交付基线是哪个分支/哪个 tag"；远端无 `gone` 上游的分支。

---

### 3.4 仓库瘦身 — P2

**问题**：tracked 内容 **111.9 MB**；`preview.jpg` 7.7 MB，`scene/templates/*.glb` 10 个共约 40 MB（market 6.5 MB、popup 6.4 MB…），`assets/scenes/*.png` 多个 2.5 MB 级；未使用 Git LFS。

**改法**：图片压到 WebP/适当分辨率；模板 GLB 走 LFS 或改为按需下载 + 校验哈希（`merged.json` 已有 `sha256`，可复用该机制）；`preview.jpg` 单独放到 release 附件或 CDN。

**验收标准**：克隆体积显著下降；`npm ci` + 构建流程不破坏。

---

### 3.5 注册邮件链路验证 — P2

**问题**：文档自述"公开注册邮件尚需本项目独立 SMTP…没有验证实际邮件送达"（[PROJECT_STATUS.md](./PROJECT_STATUS.md)）。

**改法**：配置独立 SMTP，端到端验证注册确认邮件与找回密码邮件的实际送达（含垃圾箱判定）。

**验收标准**：真实邮箱收到邮件；有验证记录入 `docs/evidence/`。

---

## 6. 明确不在本次整改范围

- 不做 UI 视觉改版（与三条诉求无关）。
- 不引入新的第三方空间/规划引擎（先把自有几何能力补齐，2.2 方案 B 需单独立项评估）。
- 不改动生产环境与云数据库；所有验证优先走离线管线（`dev:floorplan` + PGlite）。

---

## 7. 建议的第一步

按依赖关系，**同时启动 0.1（识别评测基线）与 1.2（模型元数据）**：

- 0.1 是一切"变好了没有"的前提，必须先有数字；
- 1.2 与 0.1 无依赖，且直接命中诉求 ②③，性价比最高；
- 1.1（入口）紧随 0.1 之后开始，它是 2.1（动线）的前置。

3.1（版本对齐）成本极低，可顺带完成。
