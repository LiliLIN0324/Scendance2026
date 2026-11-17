# 户外 Agent 回退手册与发布阻断条件（M7.3）

- 实测时间：2026-11-16 轮次 32，HEAD `f34d180e`
- 实测环境：Windows，15.8 GB 内存，`frontend` 依赖完整；方法是在**隔离 worktree**（`.temp/wt-r32`，detached HEAD、无用户 WIP）里试，不碰主工作树
- 本文件只回答两件事：**每一版怎么单独退回去、退回去以后什么仍然必须成立**；以及**哪些情况必须拦发布**

## 1. 结论先说

能单笔干净回退的只有 4 笔（`git apply -R` 零冲突）：

| 提交 | 内容 | 反应用实测 |
| --- | --- | --- |
| `a7c6bc38` | v4.15.2 一版预览只落一次（ApplyOnce 票号） | 通过 |
| `bb4b697c` | v4.15.3 刷新恢复逐项取舍 | 通过（并做了端到端复验，见 §4） |
| `935db271` | 新轮清掉思考卡 | 通过 |
| `3e9d2aba` | 保留可见步骤编号 | 通过 |

另外 6 笔反向应用会冲突，因为它们改的 `agent-panel.tsx` / `agent-panel.css` / `instruction-layers.ts` 之后被上游或用例继续改过：

| 提交 | 内容 | 实测冲突位置 |
| --- | --- | --- |
| `939b424b` | 分层指令解析层 | `lib/instruction-layers.ts:1` |
| `596f1735` | v4.15.0 分层指令接线 | `panels/agent-panel.tsx:135` |
| `ef578988` | v4.15.1 登录卡不再要求重选地址 | `panels/agent-panel.tsx:136` |
| `7ddafd31` | 先说再做（live work + 执行前询问） | `panels/agent-panel.tsx:4554` |
| `49af1360` | 回复卡放到思考后面 | `panels/agent-panel.tsx:4427` |
| `243ea858` | 拆开思考卡与批准卡 | `panels/agent-panel.css:962` |

这 6 笔回退要么按文件手工解那几处，要么回退后重做一行——**不是 `git revert` 一把梭**。

## 2. 回退怎么做（两种口径，都实测过）

### 2a. 仓库级回退（会带上 CHANGELOG 与进度文档，必然冲突）

```bash
git revert -n <sha>
# CHANGELOG.md、docs/plans/2026-11-16-outdoor-agent-progress.md 的冲突块取当前版本：
git checkout --ours CHANGELOG.md docs/plans/2026-11-16-outdoor-agent-progress.md
git add -A && git commit -m "revert(outdoor): 回退 <内容>"
```

实测：10 笔逐笔 `git revert -n`，只有 `935db271`、`3e9d2aba` 零冲突；其余都在文档或面板文件上停住（冲突文件清单见 §1）。

### 2b. 代码级回退（推荐，不碰文档，冲突最少）

```bash
# 只取该笔的代码改动，反向打到当前工作树
git diff <sha>^ <sha> -- <代码路径> > /tmp/rev.patch
git apply -R /tmp/rev.patch
# 验：类型零错 + 该版对应的定向测试
cd frontend && npx tsc --noEmit && npm test -- <对应测试文件>
```

先干跑再落地：`git apply --check -R /tmp/rev.patch`。

## 3. 回退后必须仍然成立的事（按版本对应验法）

| 回退到 | 必须仍成立 | 验法 | 会不会破坏已保存草稿 |
| --- | --- | --- | --- |
| 回退 `bb4b697c`（v4.15.3） | 刷新后仍能读回**结构完整**的草稿；未确认边界重出后仍要显式确认 | `npm test -- components/room-organizer/hooks/use-outdoor-agent-workflow.react.test.tsx` | **会**：缺 `brief.people` 的旧草稿会被整份丢掉（这是回退的代价，见 §4） |
| 回退 `a7c6bc38`（v4.15.2） | 同一版预览不会被双击确认落两次以外的重复写入 | `npm test -- components/room-organizer/lib/outdoor-apply-once.test.ts`（回退后该文件应消失，改为人工复验双击） | 不会 |
| 回退 `596f1735` + `939b424b`（v4.15.0） | 退回气泡仍说出唯一下一步 | `npm test -- components/room-organizer/lib/outdoor-layered-task.test.ts` | 不会 |
| 回退 `ef578988`（v4.15.1） | 范围已确认后不要求重选地址 | 人工浏览器复验（需登录态） | 不会 |

## 4. 端到端复验记录：把 v4.15.3 退回去

隔离 worktree 里反向应用 `bb4b697c` 的代码改动后实测：

```text
git -C .temp/wt-r32 apply -R .temp/r32-bb4b697c.patch   → 退出码 0
受影响：hooks/use-outdoor-agent-workflow.ts 改回严格 readState；
        lib/outdoor-flow-restore.ts 与 .test.ts 被删除
npx tsc --noEmit                                        → 0 行
npm test -- ...use-outdoor-agent-workflow.react.test.tsx → 41/41 全过
```

结论：**回退这一版能编译、既有 41 条用例仍绿**，但「没有 `brief.people` 的旧草稿」会重新读不出来。所以真要退，优先方案是**只退行为不退文件**：保留 `lib/outdoor-flow-restore.ts`，把 hook 里的 `readState` 改回严格校验即可（一行 import + 一个函数体）。

## 5. 发布阻断条件（命中任一条即不许发）

| 阻断条件 | 判定信号 | 现在能用什么验 | 缺口 |
| --- | --- | --- | --- |
| 分流无法定位 | 用户说改某处，系统不定位对象也不给缺项，或要求重选已确认的范围 | 固定数据：`lib/instruction-layers.test.ts`（9 条）、`lib/outdoor-event-turn.test.ts` | **真实浏览器一条都没验过**（M4 卡在登录门，证据在进度轮次 28） |
| 错误自动应用 | 未点确认就写入画布；或预览过期仍能确认 | 固定数据：`lib/outdoor-apply-once.test.ts`（6 条）、`lib/pending-brief.test.ts` | 双击确认、刷新中确认需浏览器 |
| 实际变更与回执不一致 | 回执说改了 N 项，画布与方案版本对不上 | 固定数据：`lib/turn-trace.test.ts`、`lib/outdoor-flow-restore.test.ts`（版本比对） | 真实回执需登录态跑一次真请求 |
| 跨项目泄漏 | 切换活动后读到上一个活动的草稿/预览 | 固定数据：`restoreOutdoorFlow` 的 `other_scope` 用例 | 切换活动的浏览器验收未做 |

## 6. 未覆盖项（不得当成已验）

1. 主流程浏览器验收（空白项目 → 组合需求 → 地图确认 → 预览 → 应用 → 撤销）：需 9222 已登录调试窗。
2. Edge 契约、权限与迁移检查：B 角色主责。
3. 真实云端请求与日志关联：需要一次真实请求（当前线下环境拿不到）。
4. 生产验证：需发布授权，本轮只登记「本地通过」。
5. 服务端查询说明（环境、编号字段、查询权限）：待 B 补；本地只能确认诊断编号里不含身份字段（`turn-trace` 用例）。

## 7. 复现本文件全部结论的最短路径

```bash
cd C:/Users/13266/.dsh/bot/workspace/Scendance2026
git worktree add --detach .temp/wt-r32 HEAD
# 逐笔干跑
git diff <sha>^ <sha> -- <代码路径> | git -C .temp/wt-r32 apply --check -R -
# 端到端一笔
git -C .temp/wt-r32 apply -R .temp/r32-bb4b697c.patch
cd .temp/wt-r32/frontend && npx tsc --noEmit && npm test -- components/room-organizer/hooks/use-outdoor-agent-workflow.react.test.tsx
# 收尾
git worktree remove --force .temp/wt-r32
```
