# Aholo 3DGS 场景漫游（实验页）

在浏览器里直接走进 Aholo World 生成的 3DGS 场景：不登录、不调接口、不扣额度，只读
`frontend/public/showcase/assets/generated/scene/` 那三个随包的 `.spz`。

- 三个场景来自 `docs/evidence/aholo/`（`3FO4K4QI6N4V` / `3FO4K4RI3SQE`）与同批 `3FO4K4RHLLV9`
  （该源目录于 2026-11-04 裁剪，产物已随包复制为 `small-launch-hall.spz`，运行不依赖它），
  米制口径和 `frontend/components/room-organizer/three/splat-preview.ts` 一致：Z-up 转 Y-up，
  底面贴 `y=0`、水平中心归零、不缩放。
- 渲染用 `three` + `@sparkjsdev/spark`，直接以 ESM 从仓库 `frontend/node_modules` 引用，
  没有构建步骤，也就不进产品包。

## 跑法

```powershell
# 项目根目录
python -m http.server 8099 --bind 127.0.0.1 --directory .temp/walkthrough-site
# 浏览器打开
# http://127.0.0.1:8099/tools/aholo/walkthrough/
```

`.temp/walkthrough-site` 是给静态服务器用的最小根目录：`tools/aholo/walkthrough` 是页面本体，
另外两个目录是指向 `frontend/node_modules`、`frontend/public` 的 junction，避免把整个仓库
（含 `.env.local`、`.git`）暴露到 localhost。页面不在产品构建里，正式漫游入口是工作台的
「走一遍给客户看」。

## 操作

点击画面锁定鼠标 → `W A S D` 移动、鼠标转向、`Shift` 加速、`Esc` 释放鼠标。
站位固定在眼高 1.6 m，移动限制在点云包围盒内（没有碰撞体，贴墙不进墙靠包围盒钳制）。