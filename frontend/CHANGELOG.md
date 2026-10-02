# 前端版本记录

前端独立递增：修复使用 v0.2.1、v0.2.2，下一批功能使用 v0.3.0。后端版本不随前端升级。

## v0.2.1 — 2026-10-02

修复版本，无新功能，前端行为与 v0.2.0 一致。

- 前端阴影类型收口：`use-three-scene.ts` 的 `THREE.PCFSoftShadowMap` 改为 `THREE.PCFShadowMap`。r186 已移除前者，`WebGLShadowMap` 会在首次阴影渲染时告警并把它改写成后者，渲染结果不变。
- 根目录渲染器同步：`renderer-webgl.js` 与 `model-preview.js` 的 `PCFSoftShadowMap` 改为 `PCFShadowMap`（合并 `main`）。
- 新增 Windows 本地开发服务器 `serve.py`（合并 `main`），覆盖 `.js`、`.mjs`、`.cjs`、`.glb`、`.wasm` 的 MIME 映射。Windows 上 `python -m http.server` 会让 `mimetypes` 把 `.js` 推为 `text/plain`，浏览器对 ES module 的严格 MIME 校验会拒绝加载，页面会停在“正在加载”。
- 根 `README.md` 运行说明补上 Windows 的 MIME 注意事项。

## v0.2.0 — 2026-10-02

- 新增介绍/登录页面，与编辑器共享会话，可进入本地体验。
- 在现有物料区提供参考图片、文字需求和 Generate 入口；不新增独立栏目或灵感快捷按钮。
- 隐藏物料区底部“导入 JSON / 导出 JSON”，保留本地自动保存。
- 新增右下角助手及提案确认，建议不会自动写入场景；场景变化后拒绝旧提案。
- 三维场景使用真实氛围灯光与阴影，兼容既有 neutral/warm/cool 字段。
- 明确图片目前只在本机预览；扩展物料、完整创意生成和通用问答等待后端支持。
- 后端交接：[FRONTEND_V0.2_BACKEND_REQUIREMENTS](../docs/FRONTEND_V0.2_BACKEND_REQUIREMENTS.md)。

## v0.1.0

- 活动物料编辑、三维/二维视角、本地保存、云项目/租约及 GLB 加载接口配置。
