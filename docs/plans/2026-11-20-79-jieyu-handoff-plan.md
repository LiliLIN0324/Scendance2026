# #79 解隅（解局）接手计划

> 目的：让新的 agent 不靠猜、不重跑已经完成的证据，把 #79 从 **3/11** 解到 **11/11**，最后由人签字。
>
> 这不是发布结论，也不是“自动通过”脚本。**partial 不算过，agent 不能代签。**

## 范围边界（先读这条，避免带偏方向）

- **本 #79 是既有「户外策划链路」的发布门禁走查收尾**：核对已上线功能在固定数据、真实浏览器、真实云端三类证据下是否站得住。**不是新功能立项，不发展室内模块，不新增产品方向。**
- 台账里 8 条 `partial` = 验收证据未齐 / 待人工签字，**不是待排期开发的需求清单**；不要据此去做室内布局、室内场景、新物料或新交互。
- 文档中出现“室内”字样（如 #11 室内布局态弹窗、室内 `undoGroup` 字段）只是**核对既有功能时的对照项**，不代表要往室内方向扩展。
- 下列属**产品待办 backlog**，已剥离本轮门禁判据，须另立决策，不占本轮门禁轮次（清单 §七、台账 `walkthrough.json` 顶层 `backlog` 一一对应）：#3 路线小改触发口径；#8 同上下文 A→B→A 活动热切换入口；#8/#9 adopt/撤销未编辑先推副本 +1 的口径定性；#10 前后端 trace 同号接线（M1b）；#11 旧云 Agent Run 列表端点 + 前端卡片。剥离不等于转 `pass`，相关用例仍按现有证据记 partial。
- 本轮不推 main、不部署云端、不重新构建发布；门禁解除只能由人签字。

## 0. 给新 agent 的第一条指令

```text
你接手 #79。工作目录固定为：
C:\幕景\Scendance2026\.worktrees\79-closure

先读：
1) docs/evidence/79/2026-11-19-signoff-checklist.md
2) docs/evidence/79/walkthrough.json
3) docs/evidence/79/04/2026-11-19-case04-v10-formal.md
4) docs/evidence/79/01/2026-11-19-case01-v10-formal.md

先跑 `npm run check:79` 记录基线，不要改台账。
然后按本文件 P0 → P1 → P2 的顺序做，每条都留下真实浏览器 + 真实云端 + 原始 JSON/截图。
不要为了变绿改数据、改读数或代签；做不到就报 blocker。
```

## 1. 当前真实状态（2026-11-20 00:30 +08:00）

### 1.1 台账

`npm run check:79` 最新输出：

```text
[79] 台账 11/11 · pass 3 / partial 8 / blocked 0 / fail 0 / n/a 0
[79] 签字状态：pending-human
[79] 提示：发布未就绪：3/11 全绿（partial 8，blocked 0）
[79] 证据台账自洽：计数、维度、路径、指纹、读数、签字边界均通过
```

判定口径：

```text
固定数据 && 真实浏览器 == pass && 真实云端 == pass
三类齐才 pass；partial 不算过；n/a 不能顶 pass。
```

### 1.2 已全绿

| 用例 | 结论 | 已有证据 |
| --- | --- | --- |
| #1 空白项目 + 组合需求 + 地图确认地点及范围 | pass | 正式站 `house-da2w2xf6`：5 条候选（UI 3 条）→ 12 点边界 → `PUT /outdoor-plans` 200 → 云端重开 boundary 12/766B |
| #2 两个同名地点选其一 | pass | 第三轮 4 条同名并存、各点各的、零写 |
| #7 待预览时说“等等”/过时确认 | pass | 旧提案消失、零写；重发得到新提案 |

### 1.3 仍 partial 的 8 条

| 用例 | 当前 | 主要缺口 |
| --- | --- | --- |
| #3 有范围、已选设施，发明确小改 | browser partial / cloud blocked | 没有拿到“小改前后”的路线候选；云端 revision 未复跑 |
| #4 无范围先发设计句，再改预算/人数 | browser partial / cloud pass | 人数变更已不误拦；但第一条设计句仍以范围红卡呈现，不是中性待续提示 |
| #5 地图部分、离线或无路网 | browser partial / cloud blocked | 离线窗口有 2 条 `GET /studios 200` 疑缓存；Agent 失败文案未抓到；“地图部分”未完全验到 |
| #6 未登录、功能关闭、额度不足、网络超时 | browser partial | 只有“未登录”；A1 功能关闭已于 11-20 云端取证并回滚；B1 额度不足 / C1 超时按 §六 豁免口径由离线单测 + 源码走查覆盖，不另备公网桩，口径见 §11 更新注记 |
| #8 应用中刷新、双点确认、切项目 | browser partial / cloud partial | 8b 双点确认已过；8a 刷新、8c A→B→A 未跑 |
| #9 确认后撤销，重开旧草稿 | browser pass / cloud blocked | v2 撤销链有本机证据但两次 PUT 404；v3 应用前后本机没变、未捕获同轮 PUT，末次 GET 401 |
| #10 一条真实模型失败，一条纯本地成功 | browser partial / cloud partial | 缺 01:54 同轮 UI 失败卡逐字对照；缺纯本地成功同窗 0 请求样本 |
| #11 普通聊天、室内布局、导出与旧云 Agent Run | browser partial | 效果图/PDF 未完成；旧 run 界面打开路径未走完 |

### 1.4 当前代码与部署

- 工作树：`C:\幕景\Scendance2026\.worktrees\79-case9`
- 远端 `main`：`4fd11fe2`
- 关键提交：
  - `d10eb066`：按句子识别“只改人数”，补正式站 #1/#4 证据
  - `febcdfdb`：记录 #4 部署后复跑与 #1 正式站全绿
  - `4fd11fe2`：更新 #4/#9 截图
- 正式站：`https://scendance-scene-planner-ewz.pages.dev/`
- 最新观察到的构建号：`4k4_IcaP3PoG_xnPIWpyc`
- 已验证：Cloudflare 自动构建生效；`PUT /outdoor-plans` 200；#1 正式站全链路通过。

> 新 agent 先复核 `git rev-parse HEAD` 和站点构建号。不要假设构建号永远不变。

## 2. 安全边界与工作纪律

### 2.1 权限

- 当前用户此前授权过“推 main、让 Cloudflare 自动构建”，**不等于**新 agent 自动获得部署授权。
- 新 agent 推送、部署、改云端环境变量前，必须在当前轮到用户明确确认。
- `AGENTS.md`：不自动合并、不打 tag、不发 release、不做部署，除非人明确要求。
- 不 force push；不 `git add -A`；只显式 add 本次证据文件。
- 不提交 `.env.local`、token、cookie、session、`node_modules`、`.next`、`out`。
- 根 `.env.local` 由 `.temp/dev-local.mjs` 静默读取；不要 cat、不要复制、不要写进证据。

### 2.2 证据纪律

- 本地通过 ≠ 正式站通过；正式站通过 ≠ 云端写读通过。
- 每次结论必须能回答：
  1. 固定数据是什么？
  2. 真实浏览器里看到了什么？
  3. 真实云端请求/响应是什么？
  4. 失败时原始错误是什么？
- 不用“应该可以”“看起来成功”代替 netlog、JSON、截图。
- 任何一条只要 browser/cloud 有一个不是 pass，就保持 partial。
- 不为了让 `check:79` 变绿而改台账；台账只记录已经发生的证据。
- 不代签；最后必须是人的签字。

### 2.3 环境与代理

PowerShell 示例：

```powershell
cd 'C:\幕景\Scendance2026\.worktrees\79-case9'
$env:SCENT_PROXY='http://127.0.0.1:7897'
$env:HTTPS_PROXY='http://127.0.0.1:7897'
$env:HTTP_PROXY='http://127.0.0.1:7897'
$env:NO_PROXY='127.0.0.1,localhost'
$env:no_proxy='127.0.0.1,localhost'
$env:NODE_USE_ENV_PROXY='1'
```

- 走查账号：`walkthrough-79@scendance.test`
- 登录态从真实浏览器/应用刷新，不用旧 token 直接打 API。
- 旧 session 调云端 API 可能 401；这不等于云端不可用，改用浏览器内刷新或云端弹窗行版本。

### 2.4 已知测试基线

- 定向测试：45/45 通过（涉及 `place-search`、`venue-intent`、`outdoor-headcount-adjustment`、confirm cards 等）。
- `npm run typecheck`：通过。
- `npm --prefix frontend run build`：通过。
- 完整 `use-outdoor-agent-workflow.react.test.tsx`：**17 failed / 99 passed**，是上游既有基线，不要把它当成本次改动新引入；但也不要声称“全绿”。
- `npm run check:79`：当前退出 0，只代表台账自洽，不代表 11/11。

## 3. 推荐顺序

```text
P0  #4  第一条设计句中性留存（最接近全绿）
P1  #9  同轮 apply → undo → reapply → 云端重开
P1  #8a/#8c  刷新中应用、A→B→A 切项目
P2  #3  有范围/设施的小改前后候选
P2  #5  离线与地图部分
P3  #10 真实模型失败 + 纯本地成功同窗
P3  #11 效果图/PDF/旧 Agent Run
#6 额度不足/超时：按 §六 豁免口径，离线单测 + 源码走查为准，不再 BLOCK 于公网桩（功能关闭 A1 已取证回滚，见 §11 注记）；豁免生效待人工确认
```

不要同时开多个浏览器跑会写云端的用例；会互相污染项目、revision 和 netlog。

## 4. P0：#4 第一条设计句中性留存

### 目标

空白无范围时先发设计句：

```text
做200人发布会，签到台放西侧入口，留出通道
```

应当：

- 记下这句话和 `guests=200`；
- 不伪造分区/边界；
- 不显示“这一步没做成”的红色失败卡；
- 给出中性下一步：“先在地图上选点/手画活动范围”；
- 随后“人数改为 150 人，保持现有分区”不再误拦，plan 仍 0/0/167B。

### 现状

`d10eb066` 已修复第二条人数变更；正式站复跑第二条不再红卡：

- `docs/evidence/79/04/2026-11-19-v10-blank-probe.json`
- `afterHeadcount`：plan 0/0/167B，无 `outdoor-plans` 写

但第一条设计句仍以范围红卡呈现：

- 任务卡：“这一步没做成 · 核对具体活动范围”
- 不是“这句话先留着，下一步选地点”的中性提示

### 建议实现

在 `use-outdoor-agent-workflow.ts` 的 `act` 中，范围守卫前增加“无空间动作的澄清”分支：

```text
如果 !requireScope(plan)
且 turn 没有 zones/routes/entrances/objects/boundary 等可执行 operation
且 reply 是要求补充范围/入口/尺寸
→ persist 现有 brief（保留 guests/uses/notes）
→ askForDetails(reply) 或中性 status
→ return，不进入 NO_BOUNDARY_NOTICE 红卡
```

注意：

- 不要把所有 `ask` 都放行；只有“没有空间操作、只是要信息”的回合才走中性分支。
- `headcountOnlyAdjustment` 已有句子识别，不要改回依赖 `action` 标签。
- 不要改动云端写法；这是纯前端状态机修复。

### 验证

先用本地：

```powershell
npm --prefix frontend run typecheck
npm --prefix frontend run test -- --run \
  frontend/components/room-organizer/hooks/use-outdoor-agent-workflow.react.test.tsx \
  frontend/components/room-organizer/lib/outdoor-headcount-adjustment.test.ts
```

再跑正式站 `.temp/case04-v10-blank.mjs`，必须记录：

- 第一条：无红卡、brief 保留原句、无 `outdoor-plans` 写；
- 第二条：无红卡、`brief.guests=150`、plan 0/0/167B、无 `outdoor-plans` 写；
- 截图：设计句后、人数后各一张；
- build id。

### 完成条件

`browser=pass`、`cloud=pass`，且第一条不再是红卡。满足后才把 checklist 和 ledger 的 #4 改为 pass。

## 5. P1：#9 同轮撤销与云端重开

### 目标

在一个**真正改变画布**的预览上完成：

```text
生成预览 → 确认并应用 → Ctrl+Z 撤销 → 重做/重新应用 → 云端重开
```

要拿到同轮的：

- 应用前 plan 计数；
- 应用后 plan 计数；
- 撤销后 plan 计数；
- 再应用后 plan 计数；
- 每次对应 `PUT /outdoor-plans` / `PUT /outdoor-history` 的 status；
- 云端 revision 或重开后的 boundary/zones。

### 为什么 v3 不算

`docs/evidence/79/09/v3/2026-11-19-case09-v3.json` 的问题：

- step 4 的“重试出预览”已经把 zones 4/2340B **写进画布**；
- `apply1` 前后相同、writes 为空；
- `undo`/`reapply` 也没产生变化；
- 末次 GET 401。

所以它只能证明“手画边界到 4 分区”，不能证明同轮 apply/undo/revision。

### 建议做法

1. 新建干净项目，不要复用 `house-lrvrntin` 的正式云草稿。
2. 手画一个闭合边界（4–6 点）。
3. 发一条能生成**可应用预览**的需求；确认预览卡出现且画布尚未改变。
4. 点击“确认并应用这一版”，等 `PUT /outdoor-plans` 200。
5. 在画布按 Ctrl+Z，确认 zones/objects 回退、boundary 保留。
6. 重做或重新应用，确认恢复到应用后状态。
7. 从云端重新打开同一项目，确认状态与重做后一致。
8. 把每步的 `slot`、`projectId`、`planLen`、counts、writes 原样写 JSON。

### 需要重点排查

- “确认并应用”是否因为服务端自动应用而变成无操作；
- 撤销是否只改本机、没有对云端写；
- 重开时是否读取了旧 revision；
- 是否有 401/404，若有，先修复 session 或路径，不要用 SQL 旁证替代同轮写读。

### 证据

建议新建：

```text
docs/evidence/79/09/v7/2026-11-20-case09-v7.json
docs/evidence/79/09/v7/2026-11-20-case09-v7.md
docs/evidence/79/09/v7/*.png
```

不得把 `08/2026-11-19-cloud-revision.json` 的 3→4 算进 #9（那是 #8b 的 `house-3ik2jdf2`）。

## 6. P1：#8a 刷新中应用、#8c A→B→A 切项目

### 8a 应用中刷新

- 在应用请求发出后、落盘完成前刷新；
- 记录刷新前后的 plan、按钮状态、netlog；
- 期望：不重复写、不丢已确认内容、界面从云端/本地一致恢复。

### 8c A→B→A 切项目

- A 项目有未应用预览或刚应用的状态；
- 切到 B，再切回 A；
- 记录 A 是否被 B 覆盖、是否有迟到写入、是否出现“幽灵提案”。

### 证据

复用 #9 的同轮 netlog 结构；每一步都记录 projectId，不要只记全局 counts。

## 7. P2：#3 有范围、已选设施的小改

### 目标句

```text
主通道改走场地北侧的仁和路，别沿湖滨路走
```

### 前置

- 项目必须有合法边界；
- 已选至少 1 个设施/物料；
- 最好有现成路线或分区，才能做“小改前后”对照。

### 需要拿到

- 小改前的路线/分区 counts；
- 小改后的候选（不是直接静默应用）；
- 候选卡上的文案与地图位置；
- 确认/取消后的 plan 差异；
- 云端 `PUT` 或“未写”的证据。

### 避免

- 不要用 0 分区项目硬发小改；模型没有可比对象，必然只能追问。
- 不要把 `conversation-api` 200 当成小改成功；200 只证明模型通道可用。

## 8. P2：#5 地图部分、离线或无路网

### 已有

- CDP `context.setOffline` 真离线；
- 离线窗口内地点检索无候选；
- 本机 plan 零变化（分区 0，红线 12 保留）；
- 无写请求；
- 恢复网络后无静默重放。

### 还缺

- “地图部分”：只让瓦片/路网失败，地点检索仍可用时的行为；
- Agent 回合失败文案；
- 2 条 `GET /studios 200` 是否为缓存命中；
- 云端 revision 未复跑（当前 cloud blocked）。

### 建议

- 用 Playwright route 只拦截瓦片域名，保留 `/api/amap-place`；
- 记录页面是否明确提示“地图不可用/仅显示已加载范围”；
- 不把页面级 offline 和 CDP offline 混为一种证据；
- 失败文案要逐字入 JSON。

## 9. P3：#10 真实模型失败 + 纯本地成功

### 已有

- 服务端日志可读（新 logs 入口，ClickHouse SQL）；
- 00:00–05:00Z 只有 1 条真实 `assistant_chat_failure`：
  - `01:54:29.450Z`
  - `slot=openai-next`
  - `reason=invalid_shape`
- 同路径前后有 POST 200 与一次重试；
- #1 invalid 窗口两次 POST 200、0 条分类事件，符合模型前输入校验。

### 还缺

- 01:54 同轮 UI 失败卡的逐字文本；
- 一条“纯本地成功”的同窗 0 请求样本；
- turnId 不出浏览器，只能做时间窗 + 分类一致性弱关联，不能按编号查全链。

### 做法

1. 用失败窗口的准确时间复现或找到对应 UI 截图；
2. 同时在另一个浏览器上下文做纯本地操作（如切图层/改名称），记录该窗口 0 条 assistant 请求；
3. 把 UI 文本、网络请求、服务端日志三列并排写进 MD；
4. 明确“弱关联”边界，不要伪造 turnId。

## 10. P3：#11 导出与旧 Agent Run

### 已有

- 户外 CSV：157B
- 户外 GeoJSON：1444B
- CSV/JSON/GLB/DXF/HTML 第五轮证据
- 旧云 Agent Run：4 条历史 run（2026-11-11；3 complete + 1 failed/AGENT_DEADLINE）
- 项目在新账号“所有方案”可见

### 还缺

- 效果图导出弹窗未确认完；
- PDF 打印对话框需人工另存；
- 旧 run 的界面打开路径未走完；
- 线上 scene-api 无 `GET agent-runs` 列表端点（404），只能 DB/UI 两头对。

### 做法

- 效果图：在导出面板选效果图，等到真实图片落盘，记录尺寸/路径；
- PDF：调起打印对话框后由人另存，记录“人工步骤”，不要声称自动导出；
- 旧 run：双击进入已定位项目，记录 run 状态、时间、错误文案，与 SQL 读数对照。

## 11. #6 功能关闭 / 额度不足 / 网络超时（早期 BLOCK 叙述；现行口径见上方 2026-11-20 晚更新注记与清单 §六）

> **2026-11-20 晚更新（以下历史叙述之前）**：A1 功能关闭已在真实云端取证并安全回滚（`06/2026-11-20-case06-a1-disabled.json`，503 `CONVERSATION_API_DISABLED`，指纹复核一致、探测键清除）；授权通道已验证可用。**B1 额度不足 / C1 网络超时改按 §六 异常分支豁免口径**：以离线分支单测 + 源码走查为证据，不要求真实云端受控故障样本、不另备公网 https 桩；豁免是否生效、#6 档位可否转 pass 由人工签字确认，agent 不自动升 pass。早期桩方案（只换 `AGENT_CHAT_BASE_URL`、KEY 不动、回滚 digest 复核）保留为若不豁免时的备料。当前口径以 `2026-11-20-79-closure-runbook.md` §#6、清单 §六 与台账 `walkthrough.json` 为准。下段「当前没有明确授权 / 缺公网桩」为早期状态，保留作历史。

### 现状

只有“未登录”已单独取证：

- 零认证调用；
- 零模型请求；
- 界面如实退回，不假装成功。

### 为什么不能直接做

“功能关闭 / 额度不足 / 网络超时”需要改云端函数环境变量或服务端配置，属于部署级动作；当前没有明确授权。

### 正确路径

1. 先向用户说明需要改哪些云端配置、影响范围、回滚方式；
2. 得到明确授权后再改；
3. 每次只改一个开关，记录函数版本；
4. 恢复原配置并验证；
5. 如果不获授权，保持 partial/blocked，不要用本地 route mock 冒充“功能关闭”。

## 12. 每条用例的交付物模板

每个用例至少留下：

```text
docs/evidence/79/<case>/<date>-case<NN>-<slug>.md
docs/evidence/79/<case>/<date>-case<NN>-<slug>.json
docs/evidence/79/<case>/<date>-case<NN>-<slug>-<step>.png
```

JSON 至少包含：

```json
{
  "ranAt": "ISO-8601",
  "account": "walkthrough-79@scendance.test",
  "site": "https://scendance-scene-planner-ewz.pages.dev/",
  "build": "页面构建号/commit",
  "projectId": "house-...",
  "steps": [
    {
      "name": "步骤名",
      "message": "用户原句",
      "assistant": "回复原文或摘要",
      "plan": {
        "counts": { "zones": 0, "routes": 0, "boundary": 0 },
        "planLen": 0
      },
      "writes": ["PUT 200 /functions/v1/scene-api/outdoor-plans"],
      "screenshots": ["...png"]
    }
  ],
  "consoleErrors": [],
  "gap": "没有做到的部分"
}
```

不要只交截图；不要只交 network；不要只交 SQL。

## 13. 更新台账的顺序

每完成一条：

1. 写该条 evidence MD（含原始请求/响应、counts、截图、失败与缺口）；
2. 更新 `docs/evidence/79/walkthrough.json` 对应 ledger：
   - `browser`
   - `cloud`
   - `conclusion`
   - `evidence`
   - `readings`
   - `gap`
3. 更新 `docs/evidence/79/2026-11-19-signoff-checklist.md` 对应行；
4. 更新 `counts`；
5. 运行：

```powershell
npm run check:79
```

6. 只有 `check:79` 退出 0 且计数自洽，才提交证据：

```powershell
git status --porcelain
git add <明确的证据文件>
git commit -m "docs(79): 补齐 #N <一句话>"
```

不要 `git add -A`。

## 14. 完成定义

只有同时满足以下条件，才可以对用户说“#79 完成”：

- [ ] 11 条用例全部 `conclusion=pass`；
- [ ] 每条都有真实浏览器证据；
- [ ] 需要云端的用例有真实 `PUT/GET` 或云端重开证据；
- [ ] `npm run check:79` 输出 `pass 11 / partial 0 / blocked 0 / fail 0`；
- [ ] `docs/evidence/79/walkthrough.json` 的 `signoff.status` 由人签字；
- [ ] 没有任何“agent 代签”；
- [ ] 明确列出仍未做的事（如果有）。

## 15. 新 agent 开工检查清单

```text
[ ] cd 到 worktree
[ ] git status --porcelain 干净
[ ] git log -3 --oneline 含 d10eb066 / febcdfdb / 4fd11fe2
[ ] 站点可打开，记录 build id
[ ] 登录走查账号
[ ] npm run check:79 记录 3/11 基线
[ ] 读 #4 现有正式站证据
[ ] 先做 P0 #4，不先碰 #9 的旧 v3
[ ] 不推送、不部署、不改云函数环境变量，除非用户当前轮明确授权
```

## 16. 一句话交接

> 先把 #4 的第一条设计句从红卡改成“保留句子、中性要范围”，再把 #9 做成真正的同轮 apply → undo → reapply → 云端重开；之后补 #8a/#8c、#3、#5、#10、#11，#6 等云端配置授权。全程只认真实浏览器 + 真实云端证据，partial 不改成 pass，最后交人签字。
