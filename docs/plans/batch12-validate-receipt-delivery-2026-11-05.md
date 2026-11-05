# 第 12 批交付：校验回执从「通过/不通过」升级为「差多少、哪一条」

日期 2026-11-05｜来源：并行调研（Voyager / MAC / I-Design / Holodeck / SWE-agent / OpenAI Agents SDK 等）的排序第 1 条

## 为什么要它

幕景的 `validate_candidate` 原来只回 `{valid:true, warnings, objectCount}`，失败就抛 `{code,details,hint}`。两类真实事故因此被吞掉：

1. **合法但不可用。** 不重叠、不越界，但通道只剩 0.82 米，推车进不去。布尔回执说「通过」，模型接着往下排，人到现场才发现。
2. **一份候选五到十条命令，只说「不合法」。** 模型不知道是哪一条，于是整份重写或逐条试——6 轮预算里最贵的浪费。

对照：MAC（Multi-Agent-CAD）回的是特征级测量值而不是 pass/fail；I-Design 的关系函数返回区间盒而不是布尔；SWE-agent 把「成功但有问题」做成 `ok:true, warnings:[...]` 的独立状态。

## 改了什么

| 位置 | 改动 |
|---|---|
| 新模块 `_shared/clearance-report.ts` | `clearanceReport(scene, ids)`：给每个物件量「到最近物件/墙/柱子/场地边界」的净距（米，三位小数），并说明最近的是谁 |
| `_shared/scene-digest.ts` | 导出 `wallPolygons` 与 `venuePolygon`，供净距复用同一套几何，不另写一份 |
| `_shared/agent-runner.ts` | `validate_candidate` 通过时回 `clearances`；不通过时回 `{valid:false, failedCommand, commandCount, issues:[{code,details,hint}], message}`，不再只抛错 |
| 同上 | `description` 与系统提示词补：主通道按 1.2 米、次通道按 0.9 米判断，`failedCommand` 指向第几条命令，只改那一条 |

回执长这样：

```json
{ "valid": true,
  "warnings": [],
  "objectCount": 4,
  "clearances": [{ "id": "…", "gap": 2.6, "nearest": { "kind": "wall", "ref": "…" } }] }

{ "valid": false, "failedCommand": 2, "commandCount": 2,
  "issues": [{ "code": "OBJECT_NOT_FOUND", "hint": "先 search_resources…" }],
  "message": "第 2/2 条命令没有通过；只改这一条，其他命令保持原样。" }
```

## 一个几何坑（写进代码注释了）

净距不能用「多边形相交判定」来量到场地边界的距离：物件在场地**里面**，包含关系会被 SAT 算成相交，于是「离边界多远」永远是 0，整份报告失去意义。改为 `boundaryGap`——顶点到边界线的最短距离，越界才算 0。

同理，净距算的是**真占地**（按旋转后的 footprint），不是包围盒：同一个 1.2×0.6 的桌子，旋转 90° 后到最近墙的距离从 4.7 米变 4.4 米，测试锁住了这个差。

## 验证

- `tests/clearance-report.test.ts` 7 例：真占地（0.35 米）、重叠报 0、无墙时量到边界、柱子优先于远墙、旋转后净距跟着变、只量点名物件、多边形净距函数本身。
- `tests/agent-space-tools.test.ts` 新增 1 例，跑真实 `executeAgentRun`：两份候选，第一份第二条命令删不存在的物件 → 回执 `valid:false` 且 `failedCommand===2`；第二份只有一条合法命令 → 回 `valid:true` 且 `clearances[0].gap>0`。
- 后端全量 727 例：并发满载下偶有 2–7 例既有负载敏感用例超时（`config` / `library-assets` / `local-auth` / `local-persistence` / `activity-task-context-bridge`），单跑或四个合跑 34/34 全过。

## 顺带修的

`20261105130000_agent_run_steering.sql` 的 `alter table … add column` 改为 `if not exists`：同一批里曾出现一个重复的 `20261105140000_agent_run_phase.sql`（内容是把改道迁移整份复制再加一个 `phase` 列），两个文件先后执行会让列重复报错、把本地服务与依赖它的四个测试文件全打挂。重复文件已删除；改道迁移本身加幂等守卫，避免同类事故再打挂一次。

注意：改道迁移的 checksum 变了。用持久化 dev 数据目录（`SCENDANCE_DEV_DATA`）跑本地联调时，夹具会报 `Local fixture migration changed`——按提示换一个新目录即可，原有数据不动。
