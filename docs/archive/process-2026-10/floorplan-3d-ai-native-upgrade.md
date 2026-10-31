# 幕景 AI-native 升级 · 平面图→3D（只拆规格，不改代码）

> 作者：平面图转3D空间  
> 日期：2026-10-24（Asia/Shanghai）  
> 本地仓库（用户保管，本轮不改）：`C:\Users\13266\.dsh\bot\workspace\Scendance2026`  
> 站内规范：[平面图转3D](sand-workflow:3d) · `/workspace/floorplan-to-3d/floorplan-3d-spec.md`

**本文件用途**：给其他 AI / 队友学习与拆任务书用的契约层。对标一流活动策划三维布置产品，细拆「场地进空间」；**禁止本轮执行改仓**。

---

## 0. 边界与分工（区分清楚）

| 块 | 领队 | 本文件 |
|---|---|---|
| 平面图/CAD/图片 → 墙门柱 → GLB；比例/主入口；Agent 改**空间**的工具契约 | **平面图转3D空间** | ✅ 细拆 |
| 谁在什么场景完成什么、优先级、砍需求、交付包范围 | 产品经理 | ❌ 只列依赖 |
| 确认闸 UI、2D↔3D、Agent 面板位置与用语 | UIUX专家 | ❌ 只列必须确认点 |
| 天气/雾/漫游观感、不抢布置导航 | 场景氛围调研 | ❌ |
| Agent 角色形象 | IP角色设计 | ❌ |
| 真正改 `Scendance2026` 代码 | Grok Bot / Cursor（**用户点头后**） | 🚫 本轮禁止 |

西湖清趣图/圆相 3D **不在本文件范围**（已迁「西湖清趣图」群）。

---

## 1. 一流产品对标（判断先）

**对标对象**：Cvent Event Diagramming（原 Social Tables；Prismm / Allseated 迁入同一产品线）。

公开能力（来源：[Cvent Event Design](https://www.cvent.com/en/event-marketing-management/cvent-event-design-software)、[Social Tables](https://www.socialtables.com/)、[Prismm](https://www.prismm.com/)）：

1. 按真实尺度从 CAD / DWG / PDF 起场地  
2. 2D 布置 ↔ 3D 漫游一体  
3. 照片级 walkthrough + 协作批注  
4. 座位 / 注册数据联动  
5. Diagram Assistant / CventIQ：自然语言改布局  

**幕景要对齐的不是功能清单抄写，而是这四条硬标准：**

| 一流标准 | 幕景含义 | 可差异化 |
|---|---|---|
| To-scale | 单位米、比例可追溯；结构进 SceneV2，不是贴图玩具 | 活动场地默认层高 **4.0 m**；主入口 `openingId` 单一真相 |
| 2D+3D 一体 | 同一 SceneV2；2D 改结构/物件，3D 同源 | 暖阳主题；布置主路径不被漫游抢走 |
| AI 改布局 | Agent 调**结构化工具**，不糊字符串进 Three | 每次可 diff / 撤销；不确定强制人确认 |
| 协作与交付 | 版本化场景 + 机读导出 | 中文活动语境；疏散提示标「仅供参考，非合规认证」 |

家具大海量库、注册一体化可后置；**先赢「半小时出可布置空间」**。

---

## 2. AI-native 四原则

1. **单一真相 = SceneV2**  
   墙/门/柱/`DimensionConstraint`/`venue.site` 可 JSON Schema 校验。  
   **GLB 是渲染投影，不是编辑源**；改空间先改 SceneV2，再 `rebuild_glb`。

2. **工具面 > 聊天面**  
   Agent 只通过命名工具改场地。禁止直接改 three 场景图或 GLB bytes。

3. **不确定即停**  
   比例、图层映射、主入口、层高在 `confidence ≠ high` 时必须人闸。  
   工具返回 `needs_user_confirm` + 候选，不静默猜。

4. **可教给其他 AI**  
   每个能力有：输入契约、输出契约、失败码、禁止事项、验收句。  
   学习入口：本文件 + skill `3d` + `floorplan-3d-spec.md`。

---

## 3. 能力细拆（六层）

### L1 摄入 Ingest

- **对标**：CAD/PDF/scaled plan 起图  
- **已定口径**：DXF 第一；DWG 不买 ODA → 用户另存 DXF；本轮底图可先收图片  
- **输出**：`assetId` + 字节哈希 + `format: dxf|pdf|raster`  
- **步骤**：魔数校验（DWG 头 `AC10…`）→ 类型路由 → 记元数据（图层名/页数/粗包围盒）；**此刻不定米制**

### L2 结构识别 Parse

- **输出**：`structure` draft（`status: detected|inferred`）+ `evidence` 叠底图像素归一化坐标  
- **DXF**：`recursive_decompose` → 图层正则（含 `xref$0$A-WALL`）→ 平行线配对双线墙 → buffer 补角；门弧→opening；小闭合块→柱；**门洞处勿 polygonize 丢墙**  
- **图片**：经典 CV / 现有 `extract-walls`；大模型只做门数与室内外语义复核，**不产出米制几何**  
- **兜底**：底图 + 手输长宽矩形，或沿底图描外轮廓

### L3 比例与场地壳 Scale + Venue

- **硬规则**：一律米；XZ + Y-up；原点左上；坐标全正  
- **单位**：`$INSUNITS` × `DIMLUNIT` 交叉；换算后宽深应落在 3–200 m；冲突 → `confidence medium/low`  
- **人闸**：自动取最长外墙生成一条尺寸 → 用户一键确认 → 写 `high`；第二条已知尺寸复核残差  
- **层高**：默认 **4.0 m**，`heightSource: default`，`status: inferred`（平面图证明不了层高）  
- **主入口**：仅 `venue.site.mainEntrance.openingId`；多门列 `candidateIds`；`venue.entrances` 留空

### L4 挤出与 GLB Mesh

- 服务端 trimesh 挤出即可；Blender 只离线 LOD/烘焙  
- GLB 层级：`Venue / Floor / Structure(Walls, Openings, Columns) / Markers(MainEntrance)`；节点名 `类型_UUID`；业务在 `extras`  
- **永不回写编辑**；`structure` 或尺寸变更才重生

### L5 布置就绪 Layout-ready

- 本文件只保证壳与通道提示数据；桌椅库/注册归其他模块  
- 输出：可碰撞墙、可行走多边形、通道宽黄灯提示（文案必须「非合规认证」）  
- 参考（非认证）：GB 55037 走道 ≥1.1 m、出口门 ≥0.80 m；大空间到出口 ≤30 m 等  
- 家具写 `objects` 层，**不污染** `structure`

### L6 交付侧吐出（3D → 交付）

交付包 UI/形态由产品经理 + UIUX 定。3D 侧须稳定吐出机读块：

- `structure` 快照 + `venue.site`（比例置信度、主入口）  
- 顶视 SVG/PNG（含比例尺）；可选漫游关键帧  
- 通道最窄处、出口列表、容量【估算】（带来源标记）  
- 相对上一版的墙门柱 diff

---

## 4. Agent 工具契约（建议名，对齐现有 domain，不另起模型）

| 工具 | 输入 | 输出 | 人闸 |
|---|---|---|---|
| `ingest_floorplan` | file `assetId` | format + layers/pages | 否 |
| `parse_structure` | `assetId` + 可选 `layerMap` | structure draft + warnings | 图层冲突时是 |
| `propose_scale` | `assetId` | 候选米制 + 最长墙尺寸条 | **是** |
| `confirm_scale` | `dimensionId` + meters | venue 更新 + confidence | 本身即确认 |
| `set_ceiling_height` | meters + source | `venue.height` | 首次可默认 |
| `list_entrance_candidates` | — | openingIds + 理由 | 否 |
| `set_main_entrance` | `openingId` | `mainEntrance` | 多候选时是 |
| `apply_structure_patch` | JSON patch | 新 SceneV2 + 校验错 | 大面积删墙时是 |
| `rebuild_glb` | `sceneVersion` | glb `assetId` | 否（幂等） |
| `explain_uncertainty` | — | 待确认清单 | 展示用 |

**禁止**：`set_mesh_transform`、任意写仓库文件、静默覆盖已 `confirmed` 的尺寸。

---

## 5. 必须用户确认的闸（交给 UIUX 出交互）

- [ ] 比例：最长外墙一键确认 / 手输已知边  
- [ ] `$INSUNITS` 冲突时的二选一  
- [ ] 图层映射置信不足  
- [ ] 主入口多门选择  
- [ ] 层高默认 4.0 m 可改并记来源  
- [ ] 识别不确定处可点击修正清单  
- [ ] 大面积删墙 / 外墙环破坏（Agent 不可静默）

---

## 6. 分阶段（不执行）

| 阶段 | 内容 | 完成定义（给其他 AI 的验收句） |
|---|---|---|
| **P0 契约冻结** | 冻结 SceneV2 + `venue.site` + 工具名表 + 本文件 | 文档齐；零业务代码或仅文档 |
| **P1 摄入+比例 MVP** | 图片底图 + 手输长宽 → 可布置矩形壳 | 用户填长宽后 3D 壳可放桌；底图对齐 |
| **P2 DXF 自动结构** | 浏览器预览 + 后端 ezdxf；一键尺寸；rebuild_glb | 确认一边后，相对该边误差 ≤1%；GLB 与 SceneV2 包围盒一致 |
| **P3 Agent 工具接通** | 上表工具挂产品内 Agent；diff/撤销 | Agent 改门/入口走工具；不确定返回人闸 |
| **P4 布置就绪+交付吐出** | 通道提示 + 导出块 | 交付包能嵌入机读 structure/site/diff |

---

## 7. 给其他 AI 的硬约束（违反即停）

1. 不另起数据模型；复用 `SceneV2` / `structureSchema` / `DimensionConstraint`  
2. 单位米；XZ + Y-up；原点左上；全正  
3. 入口唯一：`venue.site.mainEntrance.openingId`  
4. 层高默认 4.0 m 且标记来源  
5. DWG：不买 ODA；LibreDWG 仅独立进程且需法务  
6. 位图无商用可下载权重 → 不塞权重进产品；CV + 人闸  
7. 现场照片只附件，不参与主几何  
8. 疏散数字只提示 + 非合规认证声明  
9. **用户本轮明确：不要急着改本地代码；先规格 → 任务书 → 点头再执行**

### 只读代码锚点（勿本轮改）

- `supabase/functions/_shared/domain.ts`（SceneV2）  
- `reconstruction.ts` / `structural-geometry.ts`  
- 调研材料：`/workspace/floorplan-to-3d/`

---

## 8. 请其他队友补的空洞（本文件故意留白）

- **产品经理**：一流活动策划产品的「任务主路径」总表（创建场地→布置→协作→交付）；本文件 L6 如何嵌入交付包优先级。  
- **UIUX专家**：确认闸信息架构；2D/3D 切换；Agent 面板如何露出 `explain_uncertainty`。  
- **场景氛围调研**：壳就绪后，漫游/天气如何嵌进布置主路径而不抢导航。  
- **IP角色设计**：Agent 形象与「确认闸 / 不确定清单」状态的视觉语气（不进本文件）。

---

## 9. 仓库锚点（2026-10-24 只读扫描，未改仓）

根路径：`C:\Users\13266\.dsh\bot\workspace\Scendance2026`

| 能力 | 真实路径 | 备注 |
|---|---|---|
| SceneV2 / 重建 | `supabase/functions/_shared/reconstruction.ts`（+ `reconstruction-contract.ts` / `reconstruction-handler.ts` / `reconstruction-worker`） | DeepSeek 视觉 → 规划 → 单位归一 → SceneV2；**不是 CAD 矢量管线** |
| 前端核对 | `frontend/lib/reconstruction-review.ts`、`venue-edit.ts`、`…/panels/reconstruction-panel.tsx` | 来源类型仅 `floorplan \| photo` |
| Three 编排 | `frontend/components/room-organizer/three/`（`structure-builder.ts` 等）；独立 `scene/` | |
| 栅格→墙（离线） | `tools/floorplan/{extract-walls,find-openings,segment-walls}.py` | **未进主请求路径** |
| 本地预览 | `scripts/local-floorplan.ts` · `npm run dev:floorplan` | `.local-dev/floorplan/` |
| DXF | 仅有**导出** `frontend/…/plan-export/dxf.ts` | 上传口 `POST /assets/floorplan` 收 PNG/JPEG；`workbench-agent` 对 DXF/DWG/PDF → `nonImageRejected` |
| Agent | `…/lib/workbench-agent.ts`；`docs/BINGGO_SCENE_AGENT.md`、`docs/AI_*.md`；`.github/agents/3d-expert.agent.md` | |
| 相关文档 | `docs/floorplan-v2.md`、`docs/3D-GENERATION-UPGRADE-PLAN.md`、`docs/API.md` | 升级文档侧重生成通道路由，**不是 CAD 矢量重建** |

**扫描结论（已写入蓝图假设）**：P1「图片底图 + 手输长宽」与现仓一致；CAD→3D 需**新建矢量导入层**，不能假装已有 DXF/DWG 入口。无独立 `3d/` / `venue/` / `agent/` 包——嵌在 `supabase/functions` 与 `room-organizer`。

