# 幕景 Scendance · 项目规范（AI 与人共同必读）

本文件是仓库根目录的总约定。子目录若有自己的规范，以子目录为准并补充本文件：
`frontend/AGENTS.md`（前端所有权与契约边界）、`docs/README.md`（文档唯一入口）。

## 一、这是什么

面向活动的真实场景 3D 空间设计工作台：从扫描或生成的真实场地出发，在 2D/3D 里摆放物料、调整结构，再把同一份方案分享给客户、导出给执行团队。这是「幕景宇宙 / Scendance」产品线的代码主仓。

## 二、技术栈（以当前 package.json 为准）

- 前端工作台：Next.js 15 + React 18 + TypeScript + Tailwind CSS 3 + Zustand + three.js（`frontend/`，静态导出到 `frontend/out`）
- 后端：Supabase（Postgres + Edge Functions，Deno 运行时）；根目录脚本与测试为 ESM + TypeScript
- 素材与工具链：GLB 物料库、gltf-transform / gltf-validator、Blender 脚本、平面图与单位预览工具
- 运行环境：Node.js ≥ 24.15（或 ≥ 26）
- 测试：Vitest（根 `tests/` 与 `frontend/` 各自一套）、前端组件测试用 Testing Library + jsdom

## 三、目录结构

```
frontend/                    Next.js 工作台（静态导出）
  app/view/                  只读分享查看器
  components/room-organizer/ 编辑器：2D/3D 画布、面板、Agent、导出
  lib/share-snapshot.ts      分享快照编解码
client/scene-client.ts       前后端契约客户端
supabase/functions/          scene-api / generation-worker / reconstruction-worker
supabase/migrations/         数据库迁移
assets/library/              GLB 物料库
scene/templates/             场景模板
scripts/                     打包、dev 代理、配置校验
tests/                       后端测试（根 npm test）
docs/                        文档，入口 docs/README.md
miniprogram/                 小程序端
tools/                       平面图、单位预览、Blender 等离线工具
introduction.html            官网（构建时复制进 public/）
```

## 四、常用命令（不要自造命令，全部来自 package.json）

首次拉起：

```bash
npm ci
npm --prefix frontend ci
npm --prefix frontend run dev     # http://localhost:3000，同时拉起本机 3199 代理
```

验证与构建：

```bash
npm run typecheck                        # 根：tsc --noEmit
npm test                                 # 根：后端 tests/
npm run check                            # 根：typecheck + test
npm --prefix frontend run typecheck      # 前端类型检查
npm --prefix frontend run test           # 前端 Vitest
npm --prefix frontend run lint           # ESLint（app/components/lib）
npm --prefix frontend run build          # 静态导出到 frontend/out
```

配置与辅助：

```bash
npm run check:config                     # 核心环境变量校验
npm run check:config:full                # 全量校验（含 demo）
npm run check:changelog                  # CHANGELOG 校验
npm run check:edge                       # Edge Functions 的 deno check
npm run dev:floorplan                    # 本机平面图脚本
```

环境变量分两处：根 `.env.local` 供脚本与 Edge Functions，`frontend/.env.local` 只放公开配置；键名见根 `.env.example` 与 `frontend/.env.example`。

## 五、代码风格

- 全仓 TypeScript；前端组件 `.tsx`，文件名 kebab-case，组件 PascalCase。
- 前后端契约以 `supabase/functions/_shared/domain.ts` 与 `client/scene-client.ts` 为准，不得另起一套并行 wire schema。
- 编辑器适配层负责 origin / angle / dimension 换算；不得静默丢弃不支持的字段，不得编造云端资产 ID。
- 本地保存、mock 校验、真实云端验证必须分别汇报，不得互相冒充。
- 改动前先读相关 `docs/` 与目标目录局部规范；只改任务点名的文件，不做无关重构。

## 六、提交与 PR 规范

- `main` 必须走 PR：人、Renovate、superagent 或其他 agent 都只能开 PR，不得直推 `main`。
- 合并权始终在人；自动化只把 PR 开到「可评审」为止。
- 分支命名：agent 用 `agent/<任务名>-<工单号>`；人工用 `feat/` `fix/` `docs/` `chore/`。
- 提交信息用 Conventional Commits：`type(scope): 一句话`，正文写「为什么」。
- 没有证据就不算完成：PR 描述必须贴命令与原始输出，写清哪些已验证、哪些没验证，并列出刻意没做的事。
- 提交前用 `git status --porcelain` 自证改动范围。

## 七、禁止事项

- 不 `git add -A`，不强推，推送被拒就报告，不绕过。
- 不提交 `.env.local`、`node_modules`、`.next`、`out`、TypeScript 构建缓存或任何密钥。
- 不擅自改数据库迁移、Edge Functions 契约、根依赖或 CI/治理配置；这些改动需要人 review。
- 不伪造账号、生成任务或云端保存的降级路径；不把未执行的步骤算作通过。
- 不删除或篡改 `UPSTREAM-LICENSE` 与素材来源说明；保留上游授权与资产溯源。
- 不做自动化合并、不打 tag、不发 release、不部署，除非人明确要求。
