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
scripts/                     打包、dev 代理、配置校验
tests/                       后端测试（根 npm test）
docs/                        文档，入口 docs/README.md
miniprogram/                 小程序端
tools/                       平面图、单位预览、Blender 等离线工具
frontend/public/introduction.html  官网源文件（dev/build 直接消费，不再复制）
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

## 六、文件所有权与独占区（2026-11-21 由 `COLLAB.md` 并入）

多人或多个 AI 并行改同一仓库时，按「谁改哪块」切分。下面两块是**硬边界**：要动先登记，人确认后再动手——登记写进 `HANDOFF.md` 的《协作区变更登记》，写明意图、涉及文件、时间、提出方；未登记直接改的按回退处理，不进入评审。

**独占：渲染 / 导出链路（5 个文件，任一环变动都会让成图静默失效——不报错，只是图不对）**

- `frontend/components/room-organizer/hooks/use-import-export.ts`
- `frontend/components/room-organizer/hooks/use-splat-preview.ts`
- `frontend/components/room-organizer/three/splat-preview.ts`
- `frontend/components/room-organizer/room-organizer.tsx`
- `frontend/components/room-organizer/panels/scendance-workspace.tsx`

为什么：`room-organizer.tsx` 注入 `paintFrame`，`use-import-export.ts` 走同一条渲染路径出图，`scendance-workspace.tsx` 管档位与触发——三者协同的实测结论是成图 1920×1080、2,722,871 B，与「无点云」对照组逐像素 diff 69.24%。其中 `use-import-export.ts` 的 `resolution` 分支（固定 1920×1080 起算、导出时改 `camera.aspect` / `pixelRatio` 再还原）**没有单测覆盖**：改坏了 `typecheck` 与 `build` 照样通过，只有真出图才发现。要调导出尺寸、档位或点云合成顺序，先补测试再改。

**禁改：几何基线（2 个文件）**

- `frontend/components/room-organizer/three/scan-placement.ts`
- `frontend/components/room-organizer/three/furniture-builders.ts`

为什么：这两处承载米制尺度、贴地与朝向的唯一真值。现有基线已实测达标——**3° 斜场贴地残差 0.0 mm**、**69 件布置 0/69 超差**（证据 `docs/evidence/measure-2026-11-05/`）。改动会让所有历史方案的尺寸悄悄漂移，且不易被 UI 察觉。需要新行为时，在非基线的 `lib/` 侧加换算或选择器（例：`lib/scan-placement.ts` 的 `planPointFromWorld`），不要就地改基线。

**提交纪律**（配合 §七）：只按明确路径 `git add`，不用 `git add -A` / `git add .` / `git commit -a`；提交前用 `git status` 与 `git diff --stat` 自查有没有捎带别人的半成品；不提交 `.env`、任何密钥、`.temp/`、`exports/` 下新生成的产物与证据文件。反面案例：一次性把 108 个文件（付费、采集、导出、文档、台账、脚本）收进一个提交，把多条在途分支的边界全部打穿——不要重复。

## 七、提交规范

- 直接做在 `main` 上：不逐小改开分支、不开 PR；一处改动做完或一段任务收口，再一次性提交。
- 提交信息用 Conventional Commits：`type(scope): 一句话`，正文写「为什么」。
- 没有证据就不算完成：提交说明必须贴命令与原始输出，写清哪些已验证、哪些没验证，并列出刻意没做的事。
- 提交前用 `git status --porcelain` 自证改动范围。

## 八、禁止事项

- 不 `git add -A`。原则上不强推；历史重写确需强推时，须由仓库管理员明确授权、完成内容校验并确认协作者同步方案，且只能使用 `--force-with-lease` 推送指定分支，禁止 `--force` 与全分支/标签强推；其他推送被拒就报告，不绕过。
- 不提交 `.env.local`、`node_modules`、`.next`、`out`、TypeScript 构建缓存或任何密钥。
- 不擅自改数据库迁移、Edge Functions 契约、根依赖或 CI/治理配置；这些改动需要人 review。
- 不伪造账号、生成任务或云端保存的降级路径；不把未执行的步骤算作通过。
- 不删除或篡改 `UPSTREAM-LICENSE` 与素材来源说明；保留上游授权与资产溯源。
- 不做自动化合并、不打 tag、不发 release、不部署，除非人明确要求。

## 九、文案纪律（2026-11-21 用户拍板，硬规则）

依据：`docs/plans/2026-11-20-editor-copy-cut-review.md`（用户逐条批过、已执行；删完界面更清楚）。
界面文案只留会改变用户决定的信息。以下五类**默认不写**，要写必须先问用户：

1. **复述标题的副标题**——标题、按钮已经说过的，不再换句重说。
2. **免责声明**——「我会出错 / 可能不准 / 仅供参考」这类小字不放到输入区、任务卡等常驻位置。
3. **按钮旁的提示**——按钮文字已经表达动作的，不加解释句。
4. **空状态的长解释**——空状态只写「一句现状 + 一句下一步」，最多两行。
5. **同一句出现两次**——同一张卡只留一处，包括同一句被两个分支各渲染一次。

**必须保留**（不得以「减字」为名删掉）：钱与计费、提交/重提、外发与撤回、删除与覆盖、核对与通过与否、数据丢失、格式与大小限制、状态回执（未核对 / 待确认）。这些各留一句最短事实句。

执行口径：

- **按位置断言，不按句子断言。** 常驻提示必须带条件（排队 / 失败 / 未存盘 / 结果未知），并在测试里钉住「没有该条件时该位置不渲染」；只断言旧句原文等于没有护栏——换个话术就绕过了。
- **`docs/` 的对标条目不能覆盖用户的否决。** 用户否决过的 UI 件，必须在该条目上写明「用户否决，不落码」及日期；不得照文档再次落码。
- 改文案与改测试同批；提交说明写明删了哪一类、保留了哪些事实句。
