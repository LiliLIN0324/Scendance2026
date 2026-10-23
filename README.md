# 幕景 Scendance · 3D 活动场景编辑器

给活动策划用的网页版 3D 场地编排工具：拖入家具模型、摆好动线、存成项目，再让 AI 帮你出一版方案。

**在线试用：<https://scendance-scene-planner-ewz.pages.dev>**

![工作台预览](preview.jpg)

2026 年学军黑客松作品。当前仓库是 2026-10 的静态导出版本。

---

## 能做什么

- **3D 编排**：添加 / 选中 / 旋转 / 缩放 / 复制 / 锁定，支持撤销重做
- **模型库**：550 个 GLB 家具与装置模型，带中文标签与授权信息
- **AI 场景规划**：用自然语言描述需求，Agent 调用 DeepSeek 生成候选操作，后端逐步校验后才落盘（最多 6 次工具调用 / 90 秒）
- **模板**：10 套预设场地布局，可直接改
- **协作**：邮箱登录；工作室 → 项目；编辑租约与版本校验，避免多人互相覆盖；可生成只读分享链接
- **重建预览**：从平面图 / 照片预览空间重建结果（实验中）
- **家具生成**：`tools/blender` 下的参数化脚本，批量产出模型族

## 技术栈

前端 Next.js 15（静态导出）· React 18 · three.js · zustand · Tailwind / Radix
后端 Supabase（Postgres + Auth + Edge Functions）· Deno
AI DeepSeek · 测试 Vitest + PGlite

## 目录

```
frontend/            应用主体（工作台）
client/              分享客户端
supabase/
  functions/         scene-api、generation-worker、reconstruction-worker
  migrations/        19 个数据库迁移
assets/library/model 模型库（550 个 .glb）
scene/templates/     10 套模板
tools/               Blender 与平面图工具
docs/                设计与契约文档
introduction.html    介绍页
```

## 本地开发

```bash
cd frontend
npm install
npm run dev
```

需要复制根目录 `.env.example` 为 `.env.local` 并填写 Supabase 地址与匿名 key。数据库结构用 `supabase/migrations/` 初始化。

## 构建、检查、发布

```bash
cd frontend
npm run build          # 静态导出到 frontend/out
npm run test           # Vitest
```

部署在 Cloudflare Pages，监听 `main` 自动构建，输出目录 `frontend/out`；Supabase Edge Functions 单独部署。

## 边界与现状

- HY-3D 生成服务已下线，相关入口返回 410
- 模板目前只能本地使用，不支持云保存与 AI 改模板
- AI 规划有调用次数与时长上限，不是无限额度的免费服务
- 自动化测试覆盖的是关键路径，不等于生产环境验证

## 许可

模型库中部分资产来自第三方，授权信息记录在模型元数据中；使用前请逐个确认。
