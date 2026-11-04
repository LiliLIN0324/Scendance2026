# 贡献与自动化约定

本仓库由「人 + agent」共同维护。规则的目的只有一个：**每个改动都可追溯、可评审、可回滚**。

## 三条硬规则

1. **main 必须走 PR**：任何改动（人、Renovate、superagent、其他 agent）都只能开 PR，不得直推 main。分支保护开启后这是强制的。
2. **合并权始终在人**：自动化只负责把 PR 开到"可评审"为止。Renovate 开启了 `automerge=false`；superagent 只开 PR 不合并。
3. **没有证据就不算完成**：说"通过"要给命令与原始输出；说"修好了"要给复现步骤的前后对比。

## 分支命名

| 前缀 | 用途 |
|---|---|
| `agent/` | agent 自动创建的工单分支（`agent/<任务名>-<工单号>`） |
| `feat/` `fix/` `docs/` `chore/` | 人工改动 |

## 提交信息

用约定式提交（Conventional Commits）：`type(scope): 一句话`，正文写"为什么"而不是"改了什么"（改动本身 diff 会说话）。

## 工单从哪来

- 人是需求方：用 issue 模板「给 agent 的工单」写清验收标准，然后在评论里 `@endtree-FDE` 提及；superagent 会把它变成工单并在独立目录执行，最后开 PR。
- 依赖升级：Renovate 自动开 PR，按「小版本合并成一个 / 主版本需在 Dependency Dashboard 手动确认 / 不自动合并」处理。
- 人 review：先看 PR 描述里的「验收对照」与「验证证据」，再决定合不合。

## 自动化工具清单

| 工具 | 职责 | 边界 |
|---|---|---|
| Renovate（Mend Community） | 依赖与 CI action 升级 PR | 不自动合并；主版本需人确认 |
| superagent（本地 WSL 常驻） | @提及 → 工单 → 独立目录执行 → PR | 不合并；不直推 main |
| GitHub Actions（check.yml） | 每次 PR 跑校验 | 只读检查，不改代码 |

## 给 agent 的额外要求

- 只修改验收标准里点名的文件；提交前用 `git status --porcelain` 自证范围。
- 不要 `git add -A`；不要强推；推送被拒就报告。
- PR 描述里如实标注哪些是已验证、哪些没验证。
