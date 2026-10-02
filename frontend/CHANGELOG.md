# 前端变更记录

## v0.4.1 兼容现有部署 — 2026-10-02

基于 [上游 v0.4.1 / 3da9090](https://github.com/LiliLIN0324/scendance/commit/3da909042d412e595f138ed1c7b4a29819bb53c1)，合入当前部署 d4d254b。

- 幕景品牌与介绍页、本地体验、标签式工作台、三维 AI 提案预览、照片预览及灯光氛围。
- 完整保留 234 个模型与 13 个分类，为每个模型固定 assetId、内容哈希与实际文件体积；云端保存只使用 ID，重开重新授权。
- 兼容旧的已知 CDN 模型草稿，保留模型尺寸、位置、角度、备注与缩略图。
- 保留当前 AuthProvider、六位验证码注册／找回密码、登录恢复、工作室自动加载；AI 明确失败时继续允许手动保存。
- 保留 Pages 配置、原构建命令和介绍页打包。原 Supabase 函数与业务接口不变；仅新增经授权的管理员公共模型登记与资产授权迁移。

本次为待审核的本地提交，未部署或向生产上传模型。验证证据、限制与后续顺序见 [v0.4.1 兼容记录](../docs/V041_COMPATIBILITY.md)。上游各版本历史见 [原始 CHANGELOG](https://github.com/LiliLIN0324/scendance/blob/3da909042d412e595f138ed1c7b4a29819bb53c1/frontend/CHANGELOG.md)。
