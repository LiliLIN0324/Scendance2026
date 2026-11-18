# C4 / C5 落地缺口（2026-11-18）

> 拍板已定（C4 A / C5 A），本页只写「为什么还不能直接落码」与「落地时插在哪」。
> 锚点：`origin/main @ 63b11ae1`。行号是参考值，开工时以当时 main 为准。

## 1. C4 旧云项目投影

### 1.1 现状链路（已核对）

| 环节 | 位置 | 行为 |
| --- | --- | --- |
| 打开入口 | `cloud-panel.tsx` 约 371 行 `openRequested.current = id => run(...)` | 校验 UUID → `getProject` → 加载资源 → `acceptScene` |
| 场景换入 | 同文件约 307 行 `acceptScene(...)` | `backendSceneToLayout` → `onLoadLayout(next)`，直接把旧 Scene 换进 `RoomLayout` |
| 只读置位 | 同文件约 115 行 `readOnlyProjects` | 只在 `projection.requiresOriginalSceneForWrite` 时置位；普通旧室内项目没有只读分支 |
| plan 草稿槽位 | `scendance-outdoor-plan-v1:<projectId>` | **一个 projectId 只有一个 plan 槽位** |

结论：现在打开旧项目 = 直接编辑旧 `RoomLayout`，没有「只读 + 显式复制」这一层。

### 1.2 唯一没定的产品问题：派生草稿的身份

「复制为 plan 草稿」点下去之后，草稿存哪、URL 怎么变、刷新回来是谁——三条路互斥：

| 选项 | 做法 | 代价 |
| --- | --- | --- |
| A1 同 projectId 槽位 | 显式确认后写入 `scendance-outdoor-plan-v1:<projectId>` | 简单，但与已有 plan 草稿**同槽**，覆盖不可逆；要二次确认 + 覆盖前备份 |
| A2 新本地草稿 id | 生成派生 id，不绑云项目 | 不覆盖，但项目身份、列表、URL、回收站都要多一套口径 |
| A3 新建云项目副本 | 走云端复制，得到真正派生项目 | 语义最干净，但产生云端写与配额，且要走新的后端接口 |

这三条不是实现细节，是产品语义；执行 agent 不能替定。**在身份定下来之前不写按钮**——否则就是用一个猜测的存储口径去兑现一个没定的承诺。

### 1.3 落地时的插入点（身份定了之后）

1. `acceptScene` 增加 `mode: 'edit' | 'readonly'`，只读时仍 `onLoadLayout` 但不置 `savedFingerprint`、不挂保存通路；
2. `openRequested` 对「无 plan 槽位且为旧室内 schema」的项目走只读分支；
3. 新增显式动作（按钮/横幅），**不在 `acceptScene` 里偷做投影**；动作内调迁移链（`migrateFacilities` + 边界/分区）生成 plan，按 §1.2 选定的身份落盘；
4. 迁移结果里的 `lossy` 直接展示给用户（C3 已提供 `result.lossy`），不静默丢字段。

## 2. C5 plan lease

### 2.1 已定口径（不重复讨论）

lease 只提供「谁有写权 / 项目归属 / 是否过期」；plan 落盘用 **plan 自己的 revision** 做 compare-and-set；冲突时拒绝并提示重载，不改写、不合并。理由见决策卡 §2：scene lease 的 `revision` 是 scene revision，plan 有独立 revision（`outdoor-plan-sync.ts` 的 `saveOutdoorPlan` 返回 `{conflict, revision}`），混用会恒真或误拦。

### 2.2 为什么现在不开 B3

`decouple-execution-plan` 把 B3（写守卫 plan 化）排在 B2（历史快照换 `SitePlanData`）之后，B1/B2 又挂 #79 flow 稳定。现在直接动 B3 会：

- 与 B2 的历史/回写改造撞同一批文件（`room-organizer.tsx`、`use-history` 调用点）；
- 出现两套守卫并存（layout 守卫 + plan 守卫），过渡期无法判断哪套是正源；
- 违反计划 §0.1「M3 不解耦，R2/R3 不得动」。

### 2.3 可以独立先做的

只做纯函数 `plan-write-guard`（capability + plan revision CAS）+ 单测，不接壳体；等 B2 落地后一次性接线。**不建议**在 B2 之前把它挂进 `assertLayoutWrite`。

## 3. 本轮结论

- C4：链路已核清，缺「派生身份」一个产品答案；不写按钮。
- C5：口径已定，B3 被 B2/#79 阻塞；不单独开写守卫接线。
- 已落地：C1 两处守卫（#176）、C3 lossy 标记（#177）。
