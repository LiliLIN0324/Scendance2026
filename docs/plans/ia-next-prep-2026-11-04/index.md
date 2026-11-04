# S2/S3/S4 第二轮并行施工前审 · 总索引（hub）

> 日期：2026-11-04
> 仓库：`C:\mujing\Scendance2026`（S1.0 已完工全绿，台账 §7 为完工凭证）
> 性质：第二轮只读前置审计集成索引；三份分文档把上轮 `docs/plans/ia-s1-prep-2026-11-04/` 的发现深化为可执行施工包，本轮未重跑已完成审计。
> 证据口径：全部 file:line 经本轮字符串匹配复核；未运行 vitest/tsc/build/dev，未做 git 操作。

---

## 0. 本轮工作树实况（验收时哈希实证）

- 审计期间主线程已并行开 **S1.1 画廊施工**：frontend 共 7 个文件变化——新增 `panels/activities-gallery-mount.tsx`，改动 `agent-panel.tsx`、`agent-panel.react.test.tsx`、`local-activities-panel.tsx/.css/.react.test.tsx`、`venue-picker.react.test.tsx`。三片文档行号均为各自快照，agent-panel 区域已出现 +1~3 行漂移，**每刀动工前重新 grep 定位**（分文档均已内置此纪律）。
- 零写入证明：以审计前 619 个源码文件 SHA1 快照比对，漂移文件全部落在 S1.1 预期集合内，无新增非 S1.1 文件、无测试外的可疑改写；目标 docs 目录仅四份 md。
- 上轮两条「待核验」本轮被关闭：`workbench-agent.test.ts` 真实存在且覆盖全部口令函数；体检组件级测试已有 T-03 底子（`agent-panel.react.test.tsx:188-258`）。
- 基线文件口径已辨清并实证：`.s1-baseline-failfiles.txt` = **16 文件/45 失败用例**（冻结基线，含 share.test.ts），`.s1-full-failfiles.txt` = **15 文件**（S1.0 完工快照，share.test.ts 转绿），`.s1-baseline.out.log` 实含 45 条 FAIL 行；S4 比对以 16 文件冻结基线为准。

## 1. 三份产物导航

| 文件 | 服务切片 | 内容 |
|---|---|---|
| `s3-entry-audit.md` | S3 空间/物料面板化 | 21 处入口穷举对照表、AgentChat 真能力/假聊天审计、两组件边界图、C 板四形态分步施工卡、禁词清单与测试缺口 |
| `s2-playbook-and-decisions.md` | S2 Bingo 转审校台 | T1–T7 施工任务书（含精确门控/挂载点/回滚点）、5 项待拍板决策简报、Q4 接口形状建议、先测后改测试计划 |
| `s4-execution-pack.md` | S4 清理回归 | :341 三档修复详评（推荐 A 档）、54 条死 CSS 逐条验证表、21 条注释改写文案、Bubble.to 兼容核查与两案、基线比对回归规程 |

## 2. 跨片关键结论

1. **空间/物料脸并不共用活动脸 composer**：它们走独立 `AgentChat`（`agent-panel.tsx:1935` `{!conversation && chatSlot}`）+ 独立 localStorage `scendance.agent-chat.v1`，与 AgentPanel 是两套对话；物料脸聊天 100% 假聊天（`agent-chat.tsx:101` 纯文案回执），空间脸仅 4 条正则是真动作。S3 要退役的是 AgentChat 气泡/form，send() 路由一行不用动。
2. **建场/重建一路四门**（SpacePanel 两钮、AgentChat「＋」菜单、地图采集单回传、业务下拉「场地重建」）同指 `openAholoWorkflow`；另有 VenueLibraryPanel 孤儿面板（`setSidePanel('venue')` 全仓零调用）。S3 的主体是入口收束与现有形态升级（EnvironmentPreview 已是行列表雏形、OnlineModelLibrary 已有三卡网格），不是新建。
3. **S2 最长依赖链**：三钮化（体检 `reviewNow` 当前唯一入口是口令 `agent-panel.tsx:1295`）必须先于 composer 摘除；现有测试 `agent-panel.react.test.tsx:818-819` 显式断言中间态输入框仍在，T2 后必须反转。
4. **评审侧一活两断的格局未变**：hash 钉评链端到端真接通；reviewSlot 整条制作侧钉链被 `demoteLegacyMode`（`workbench-mode.ts:19-23`）封成「接线在、门没开」，开门路径下游零新码但 reviewPins 仍无持久化；UUID 评论链生产零调用方。
5. **S4 三项技术清理均有安全证据**：:341 推荐 A 档（9 行、46 测试零改写只加 2 条）；死 CSS 54 条 JSX/TS 零引用且存活边界（:397、:398-401、.ap-composer 本体）已钉死；Bubble.to 硬删运行时安全（normalize 逐字段容错、UI 零写入、渲染零消费，仅 2 处测试断言改写）。
6. **禁词清洗范围需扩大**：分片 A 正文实列 12 处用户可见「高斯」（space-panel 6、environment-preview 3、agent-chat 3；速览「约 9 处」为低估），hub 验收另在 `lux3d-direct-test.tsx` 发现 6 处用户可见（:31/:33/:38/:153/:548/:552），environment-load/room-organizer 等文件尚有命中；S3 施工前须全量重 grep 定精确清单。

## 3. 去重行动项总表（16 项；10 项可直接施工，6 项待 owner 拍板）

### 可直接施工（路径与落点已在分文档钉死，按序）

| # | 行动项 | 出处 | 关键前置/依赖 |
|---|---|---|---|
| 1 | S2 三钮化：BingoAuditCard 旁加「立即体检/准备客户评审/导出评审包」，复用 reviewNow/onOpenReview/proposeExport，零新 state；先写三钮测试 | s2 T1 | 决策项 B1 的 A 案形状；任何 composer 改动的强制前置 |
| 2 | S2 composer 门控 conversation→activity，ap-lead/recap 补 activity 门控，typed-suggestion bingo 组处置；反转测试 :818-819 | s2 T2 | 必须在 #1 之后；send() 不改 |
| 3 | S3 建场/重建四路收口为单框 omnibox（world/recon 两档），AgentChat 四条真动作按钮化、正则分支退役、假聊天兜底删除 | s3 §4.3/§1.3 | 与 #2 错峰改 agent-panel 同区 |
| 4 | S3 环境行列表 + 物料库网格升级：换场地入口并入行列表头部、补右侧详情列与常驻搜索、拖入落点三档说明 | s3 §4.1/4.2/4.4 | 不动生成管线与 onApplyCreative |
| 5 | S3 物料生成三入口（composer 星/tile 块/云端任务列）合并为库头部「＋」，云端 jobs 并入「我的生成」pane | s3 M6-M8 | 云端/本地去重口径随 B6 待定部分先不并数据 |
| 6 | S3 用户可见禁词清洗（高斯/WorldGen），覆盖三片 12 处 + lux3d 浮层 6 处等，施工前全量 grep 出终版清单 | s3 §4.5 + hub 复核 | 不含 Aholo（Aholo 是否清洗见 B6） |
| 7 | S3 删除孤儿 VenueLibraryPanel 及其 2 处测试断言 | s3 S16 | 删前先核 useVenueLibrary 收藏数据有无其他读方（s3 待核验 1） |
| 8 | S4 修 :341：按 A 档把三副作用移出 updater 在 say 体内顺序执行；先加「同步落盘/连发不丢」2 条回防测试 | s4 §1 | 独立 commit，不夹带其他刀 |
| 9 | S4 清理包：删 agent-panel.css:402-493 共 54 条死规则（删前重 grep）+ 21 条注释口径改写（16 改/4 随块删/1 保留） | s4 §2/§3 | 与 #8 分两个 commit |
| 10 | S4 全量回归：vitest failfiles 与 16 文件冻结基线 Compare-Object 比对（零新增、≤45）、typecheck、build、清 .next 重启、:3001 五条冒烟路径 | s4 §5 | npm 来源待核验，vitest.cmd 可兜底 |

### 待 owner 拍板（审计只给方案与损益，不替决）

| # | 决策项 | 选项摘要 | 出处 |
|---|---|---|---|
| B1 | Bingo 脸 Q3 终审形态 | A 纯状态台三钮（台账已记倾向 A）/ B 精简输入条白名单两口令；B 不根治误触生成链 | s2 D1 |
| B2 | reviewSlot 开门还是封堵 | 甲开门：demoteLegacyMode 加分支+补入口控件，下游零新码但钉无持久化；乙封堵：删三文件死接线，review-pins lib 保留 | s2 T3/D |
| B3 | 双 ReviewSharePage 关系 + UUID 孤儿链删留 + Q4 接口形状是否本轮只留签名 | 合并/只留富钉页/双留分工三案；孤儿链删除或冻结 deprecated；Repository 接口注释零成本预留 | s2 T4/T5/T7、D3/D4/D5 |
| B4 | 红环与 returned 徽标口径 | R1 任意回执即红 / R2 加 planKey 参数对齐（审计推荐 R2），另定 sample demo 回执是否过滤 | s2 D2/T6 |
| B5 | Bubble.to/send(to?) 删留 | 案①连类型带迁移硬删（审计推荐，仅 2 测试改写）/ 案②保留只读迁移（留死数据） | s4 §4 |
| B6 | S3 三项小决定 | agent-chat-store 整删 vs 转动作日志；环境 Solo 隔离做不做；「Aholo」是否与高斯同列界面禁词 | s3 §3.2/§5 |

## 4. 接刀顺序建议

1. **先拍 B1**（台账已有倾向，走确认流程即可）→ 落 #1 → #2，S2 主刀闭合；B2/B3/B4 可与施工并行评审，落锤后再动 reviewSlot 与评审路由。
2. **S4 的 #8/#9 与 S2 不冲突可并行**（:341 与 CSS/注释都是独立区域），但各自独立 commit；B5 落锤后再接 Bubble.to 删除（未列入直接施工项）。
3. **S3 在 S2 之后落**：#3 与 #2 都触 agent-panel 左侧面板区，串行避免同树冲突；#4/#5 是主体工作量，#6/#7 随 S3 同刀清。
4. 每刀过 #10 同一组回归门；红线不变：不绕 onApplyCreative 三道门、不新增 wire schema、不引新依赖与紫/靛色系、Supabase 不实现只留形状。

## 5. 集成验收记录

- 目录清点：`docs/plans/ia-next-prep-2026-11-04/` 仅 index.md + 三份分文档；上轮目录未被修改。
- 独立抽查通过：VenueLibraryPanel 零入口 grep 实证；死 CSS 类名 TS/TSX 零引用（S1.1 后复核仍零）；workbench-agent.test.ts 存在；三个 agent.send 调用点（:1868/:1947/:1959）均单参；assistant-session-bodies 测试 :66/:75 断言属实；:818-819 测试中间态断言属实；failfiles 16/15 与日志 45 FAIL 实证；AgentChat 假聊天兜底 :101 实证。
- 一项计数修正已在 §2-6 记录（高斯用户可见实际 ≥18 处而非约 9 处）。
- 边界合规：四份产物均在指定目录；未写 frontend、未访问 ia-board junction 与旧快照 `C:\幕景\Scendance2026`、未运行禁止命令。
