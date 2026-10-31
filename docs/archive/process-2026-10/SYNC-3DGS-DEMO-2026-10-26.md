# 同步备忘 · 3DGS Demo 与产品仓边界（2026-10-26）

> 定位钉全文：`docs/PRODUCT-POSITIONING-2026-10-26.md`  
> 对侧镜像：`3dgs-demo/docs/SYNC-SCENDANCE-BOUNDARY-2026-10-26.md`

## 产品定位（钉死）

- **卖**：活动场景方案 = 布置物料策划 + 文案/交付专业感。
- **不卖**：3D 空间重建能力本身。
- 重建外包（Viggle 约 $0.06–0.14/次或国内约 ¥50/月包），**有客户再充**；物件生成几乎零成本；信息差 + 全流程服务赚差价。
- 成功样板：场景重建（假或外包）+ 单体布置 + 物料 + 文案产出。
- Scendance **优先 AI-native**（对话布置 T-02 等）；平面图→3D / 重建继续调研、**不挡主线**；未说「开 T-02」不猛改码。

## 产品仓 Scendance2026 在改什么

- 分支：`T-01-venue-shell`（tip 与 main 同为 `e84c101`，工作区有大量未提交改动）
- 脏文件重心：T-01 壳体/入口门钉 + T-02 向的 `agent-proposal` 预览→确认、`agent-panel`、晴光头像资源
- 群结论：T-01①够开下一卡；**等用户亲口说「开 T-02」**；平面图转3D 同学停手，转圈不是他们引起的
- 本机同时跑着 Qoder / Trae / ZCode 多进程——界面转圈优先查 IDE agent 卡长任务，勿两工具同改一仓

## 3DGS Demo（另一目录，勿串）

路径：`C:\Users\13266\.dsh\bot\workspace\3dgs-demo\`

- **假对接**跑通观感层为主线：splat 房间观感 + glTF 布置（图一）；禁平面贴地灰墙壳体当主交付
- 供应商文档**第三位**：选型用；**MeTop 未实测**不当结论
- 上传方案修订版（执行确认后才写码）：最长边(米)输入、`placement.rebase`、新建再 dispose 旧 mesh、`fileBytes`+`fileType`、Provider 单文件默认 mock、失败路径+150MB
- 方案文件：`3dgs-demo/docs/DEMO-UPLOAD-PROVIDER-PLAN.md`

## 请执行同学

1. Scendance：未听到「开 T-02」前停改产品代码；主线是 AI-native 布置方案，不是重建能力
2. 3DGS：只在 `3dgs-demo`；假对接优先；用户对执行说「按修订版写」后再实现真上传链路
