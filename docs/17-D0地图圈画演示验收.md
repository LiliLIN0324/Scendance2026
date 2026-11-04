# D0 演示链路验收 · 地图圈画 + 历史 splat + GLB · 2026-10-30

> 仓：`C:\Users\13266\.dsh\bot\workspace\Scendance2026`  
> 规划真源 Page：`地图×高斯×Aholo 进 3D`（未改 Page）  
> **结果：PASS**（本机 Playwright 探针 + vitest）  
> 未 commit / push / tag；未新建任何扣额度的 Lux3D / World 任务。

## 必须看见

| 项 | 结果 |
|---|---|
| 地图立户外壳 | PASS · 「演示圈画 · 12×8 m」→ `createVenueFromPick` → 名称带「盐官潮乐之城 · 海宁盐官」 |
| 同一画布挂历史 `.spz` | PASS · 自动挂 `shipped-scendance-m3-mvp`（= World `3FO4K4QI6N4V`，262,991 高斯点） |
| 1:1 贴地 | PASS · splat scale=1；就绪后按高斯实测校准场地到 **23.8 × 16.1 m** |
| 放一件已落盘 GLB | PASS · 「生成物件」抽屉点「白色圆桌 / 中式木扶手椅」 |
| splat 不挡拖拽 | PASS · 点云走独立 Scene 背景层；探针拖拽尝试无硬错，选中框可见 |
| 无新建扣费 | PASS · 只用 shipped / 本机缓存，未调 create |

## 失败即停（均未触发）

- splat 挡住拖拽
- 比例明显错位（乱缩放）
- 新建扣额度任务

## 复现

```text
# 终端 1（可选：本 D0 走 shipped 同源路径，可不启代理；Aholo 面板/本机缓存需要）
node tools/aholo/lux3d-dev-proxy.mjs          # 127.0.0.1:3199

# 终端 2
cd frontend; npx next dev                     # :3000；卡死则 :3001

浏览器打开 http://127.0.0.1:3000/editor
1. 左轨「地图」→ 浮层顶栏「演示圈画 · 12×8 m」（或手画后「生成户外场地」）
2. 浮层自动收起；画布顶条出现「环境预览：Scendance-M3-MVP」
3. 底栏物料抽屉 →「生成物件」→ 点一件 shipped GLB
4. 可转视角；「退出预览」还原机位

自动化：
node .local-dev/d0-map-splat-probe.cjs
# SMOKE_URL=http://127.0.0.1:3001 可换端口
```

## 证据

目录：`docs/evidence/aholo/d0-map-splat-2026-10-30/`

- `01-map-open.png` · 地图浮层
- `02-shell-plus-splat.png` · 壳 + splat + 环境预览条（262,991 点）
- `03-generated-shelf.png` · 生成物件抽屉
- `04-shell-splat-glb.png` · 三层叠合 + 选中 GLB
- `05-after-drag-attempt.png` · 拖拽尝试后
- `probe.log` · PASS 断言原文

## 改动摘要（相对 WIP 收敛，未提交）

- `lib/shipped-assets.ts` · `DEMO_WORLD_SCENE_ID` / `DEMO_WORLD_TASK_ID`
- `panels/amap-venue-picker.tsx` · 「演示圈画 · 12×8 m」；按钮上移防被高德 canvas 挡住
- `panels/agent-panel.tsx` · `onHangDemoEnvironment`；立壳成功自动挂 splat 并收浮层
- `panels/agent-panel.css` · grow 任务区 `overflow: hidden`
- `room-organizer.tsx` · `hangDemoEnvironment` 接线
- `panels/scendance-workspace.tsx` · openTab 含 `generated`
- `panels/map-venue-overlay.react.test.tsx` · D0 用例
- `.local-dev/d0-map-splat-probe.cjs` · 本机证据探针

## 未做 / 下一步

- D1 流线：圈内画主客流线 → 站位沿流线加密 → 采集单（现采集单仍是边界站位）
- D2 真重建：本场素材上传换新 `.spz`（勿继续用宴会厅样例冒充本场）
- 手画多边形路径在真机已可走；探针为稳定复现用「演示圈画」
