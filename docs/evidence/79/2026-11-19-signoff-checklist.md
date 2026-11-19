# #79 户外发布门禁 · 第六轮验收与签字清单（2026-11-19）

> 本文件是**给人签字用**的，不是结论。结论口径：一条用例 = 固定数据 ✅ **且** 真实浏览器 = `pass` **且** 真实云端 = `pass`。
> `partial` 不算过；`blocked` 是**维度状态**，不是用例结论；`n/a` 不能顶 `pass`。2026-11-19 部署缺口已修复（`scene-api` v64，当前 v65；+ 两条户外迁移）：#7 已转 **pass**；#8b 云端已 pass（2 条写：`outdoor-history` + `outdoor-plans`），但 8a/8c 未跑；#9 云端仍 `blocked`（该轮 `house-7jblibyk` 两次 404，部署后未重跑；#8b 的 CAS 3→4 不计入）；#1 / #3 / #4 / #5 待复跑；#10 服务端日志已可读（真实 `invalid_shape` 已找到），但同轮 UI 对照/纯本地样本仍缺。**agent 不能代签。**
>
> 机器校验见 `docs/evidence/79/README.md`：日常 `npm run check:79`，发布闸门 `npm run gate:79`。

## 一、本轮做了什么（台账快照）

| 项 | 值 |
| --- | --- |
| 走查对象 | 正式站 `https://scendance-scene-planner-ewz.pages.dev/`（真实部署 + 真实云端 + 真实浏览器） |
| 云端项目 | Supabase `wkhfvnzgopjdzxlmycks` |
| 账号 | 走查专用账号 `walkthrough-79@scendance.test`（本轮新建，只用于走查） |
| 登录态做法 | Supabase 管理 API 换会话 → 按 `@supabase/ssr` 真实格式注入 **cookie**（此前五轮注 localStorage 无效） |
| 台架 | `docs/evidence/79/tools/`（Playwright + HAR + CDP 离线 + 管理 API 只读 SQL） |
| 取证产物 | 每条用例一个目录：`docs/evidence/79/<case>/`，含原始 JSON、截图、脚本 |

## 二、11 条用例当前状态（详见 `walkthrough.json`）

| # | 用例 | 固定数据 | 浏览器 | 云端 | 结论 | 本轮新增 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 空白项目 + 组合需求 + 地图确认地点及范围 | ✅ | 部分 | ⛔ | partial | 2026-11-19 本地构建 v9：完整地名保留成功，真实 3199 返回 5 条候选（界面 3 条）→ 选第 1 条 → 12 点 / 341.2×550.5 m / 99936 ㎡ 边界 → 手画入口可见 → 应用后 boundary 12 / 766B；组合句由真实模型解析，但真实轮廓含水/围栏禁区，摆放守卫拒绝写入。正式站尚未部署，云端无 revision 读数；证据 `01/2026-11-19-case01-v9-local.md`、`01/2026-11-19-v9-local-probe-v3.json` |
| 2 | 两个同名地点选其一 | ✅ | ✅ | ✅ | **pass** | 沿用第五轮证据，未重跑 |
| 3 | 有范围、已选设施，发明确小改 | ✅ | 部分 | ⛔ | partial | 模型通道已恢复（此前 provider_error），小改对照未跑完 |
| 4 | 无范围先发设计句，再改预算/人数 | ✅ | 部分 | ⛔ | partial | 2026-11-19 本地构建 v9：修补「保持现有分区」被 `matchZoneCommand` 抢先路由的问题；在真实云端草稿夹具（4 分区/4 边界/2340B）上发「人数改为 150 人，保持现有分区」，真实 `assistant/chat/stream` 200，回复「已记下活动人数为 150 人，现有分区保持不变」，plan 4/4/2340B 未变，云端写 0。正式站未部署、云端未写，仍 partial；证据 `04/2026-11-19-case04-v9-local.md`、`04/2026-11-19-v9-local-headcount.json` |
| 5 | 地图部分、离线或无路网 | ✅ | 部分 | ⛔ | partial | CDP 级真离线 + HAR（此前只能页面级注入，瓦片验不到） |
| 6 | 未登录 / 功能关闭 / 额度不足 / 网络超时 | ✅ | 部分 | n/a | partial | **未登录分支单独触发并取证**；另三类需改云端环境变量 |
| 7 | 待预览时说「等等」或过时的「确认」 | ✅ | ✅ | ✅ | **pass** | 说「等等」→ 旧提案消失、零 `outdoor-plans` 写、本机不动；第 3 步只有 1 条模型 POST |
| 8 | 应用中刷新 / 双点确认 / 切项目 | ✅ | 部分 | 部分 | partial | 双点确认：只应用一次（0→2，574→1440B，2 条写：`outdoor-history` 200 + `outdoor-plans` 200，plans 仅 1 条）；8a/8c 未跑 |
| 9 | 确认后撤销，重开旧草稿 | ✅ | ✅ | ⛔ | partial | 撤销整批 + 再应用一次（2/1438B → 0/574B → 2/1438B，撤销期间零云端写）；该轮 `house-7jblibyk` 两次 `PUT /outdoor-plans` 均 404，部署后未重跑；#8b 的 CAS 3→4 不计入 |
| 10 | 一条真实模型失败 + 一条纯本地成功 | ✅ | 部分 | 部分 | partial | 日志已打通：01:54:29Z 真实 `openai-next / invalid_shape`；#1 `invalid` 窗口 0 条分类事件；仍缺同轮 UI 失败卡与纯本地 0 请求样本 |
| 11 | 普通聊天 / 室内布局 / 导出 / 旧云 Agent Run | ✅ | 部分 | n/a | partial | 导出与旧 run 取证（读数见 `11/`）；旧 run 数据已在库，缺的是 UI 打开路径，不是云端阻塞 |

> ⛔ = 该用例的云端栏仍未 pass；**不再是部署缺口**。2026-11-19 已把 `scene-api` 发到 v64（当前线上 v65），并应用 `20261117180000` / `20261117190000` 两条迁移；`PUT /outdoor-plans` 已由 404 变 200。仍为 ⛔/部分的：#1 / #3 / #4 / #5 待按各自流程复跑；#8b 云端已 pass 但 8a/8c 未跑；#9 云端 blocked（该轮两次 PUT 404，部署后未重跑）；#10 日志已可读但同轮 UI 对照/纯本地样本仍缺；#6 / #11 云端 `n/a`、浏览器仍 partial。证据：`docs/evidence/79/00/2026-11-19-deploy-resolution.md`。

## 三、签字前需要人做的三件事

| # | 事 | 为什么必须人做 | 做完之后 |
| --- | --- | --- | --- |
| 1 | ~~部署 `scene-api` + 2 条迁移~~ **已完成 2026-11-19** | 已按最小范围执行：`scene-api` v64（当前 v65）；只应用 `20261117180000` / `20261117190000`；其余 8 条缺失迁移未动 | #7 已转 pass；#8b 已见 2 条写请求（`outdoor-history` 1 + `outdoor-plans` 1）；#9 该轮两次 404、部署后未重跑（#8b 的 CAS 不计入）。剩余是复跑 #1/#3/#4/#5 和补 #9 同轮 revision，不是部署 |
| 2 | **确认「额度不足 / 网络超时」两类的触发方式** | 这两类要靠云端函数环境变量指向一个返 402 / 25s 不返回的上游，属于配置变更 | 两类可单独取证，#6 才可能从 partial 走向 pass |
| 3 | **在 `walkthrough.json` 上签字** | 门禁解除只能由人签字，agent 不能代签 | 11 条全绿才算解除；现在是 2/11（全绿 #2、#7） |

## 四、本轮**没有**做的事（如实列出）

- **已部署** `scene-api` v64（当前 v65），并应用 `20261117180000` / `20261117190000` 两条迁移；其余 8 条迁移与云端环境变量未动；
- 没有改产品代码；只改了 `docs/evidence/79/` 下的取证台架与证据文件；
- 没有重跑 #2（沿用第五轮证据）、没有跑 #8a（应用中刷新）/ #8c（切项目）/ #3 的小改对照；
- 没有为 #10 做服务端日志关联（需要云端日志权限）；
- 没有为了让台账好看而补任何假 `pass`。

## 五、复跑命令

```bash
npm run check:79   # 台账自洽（当前 2/11 应为 0）
npm run gate:79    # 发布闸门（当前应 exit 1，提示未齐 11/11）

node docs/evidence/79/tools/case-07-08-09-chain-v2.mjs          # #7 / #8b 链路
node docs/evidence/79/tools/case-07-08-09-cloud-revision.mjs   # 云端 revision / 冲突读数
node docs/evidence/79/tools/case-01-09-blank-undo.mjs           # #1 空白项目 + #9 撤销再应用
node docs/evidence/79/tools/case-05-offline.mjs          # #5 CDP 离线 + HAR
node docs/evidence/79/tools/case-11-exports.mjs          # #11 导出
node docs/evidence/79/tools/case-11-old-run.mjs          # #11 旧云 Agent Run
node docs/evidence/79/tools/case-06-notlogged.mjs        # #6 未登录分支
```
