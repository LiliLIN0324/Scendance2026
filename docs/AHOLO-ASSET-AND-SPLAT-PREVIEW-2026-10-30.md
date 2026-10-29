# 任务一 · 任务二：GLB 本机资产与 3DGS 环境预览（2026-10-30）

> 仓：`C:\Users\13266\.dsh\bot\workspace\Scendance2026`
> 页面：`http://localhost:3001/editor`（本轮 :3000 那个 dev 进程卡死，另起了 :3001）
> 代理：`node tools/aholo/lux3d-dev-proxy.mjs`（127.0.0.1:3199，密钥只在仓库根 `.env.local`）
> 全程只读复用历史任务号，**没有新建任何扣额度的生成任务**；未 commit / push / 发布。

## 总览

| 项 | 结果 |
|---|---|
| 任务一 · 落盘代理层 | **PASS** — 签名产物落本机，稳定地址 `http://127.0.0.1:3199/asset/<uuid>.<ext>` |
| 任务一 · 图纸只存 AssetID | **PASS** — 序列化里不含 `glbUrl`，反序列化按资产号回源本机 |
| 任务一 · GLTFLoader 接入拖拽与保存 | **PASS** — 真机：摆进 → 拖动 → F5 回开，20 条探针断言 |
| 任务一 · 物料抽屉「生成物件」入口 | **PASS** — 左轨第二枚图标，列表可反复摆同一件 |
| 任务二 · 单包 `.spz` 加载 | **PASS** — 4,388,248 B / **262,991** 个高斯点，真机解码并渲染 |
| 任务二 · 渲染栈隔离 | **PASS** — 点云在自己的 Scene + SparkRenderer，两趟渲染当背景层 |
| 任务二 · 相机同步 | **PASS** — 共用同一台相机与 OrbitControls；进场站进场景内，退出机位原样还回 |
| 任务二 · LOD 根块截断降级 | **未做** — 按她给的「优先方案」走单包 `.spz`，见 §4 |
| 门禁 | 代理 195/195 · splat 11/11 · placement 10/10 · lux 面板 71/71 · 抽屉 16/16 · 相关套件 51/51 · `tsc --noEmit` 与 `eslint` 无输出 |

> 全量回归 `npx vitest run components/room-organizer --maxWorkers=2`：**2805 通过 / 1 失败**，唯一那条是 `three/scene-presets.test.ts:93`，见 §5.8 —— 与本轮改动无关，本轮之前就在红。

## 1. 任务一：落盘、资产号、图纸

- 落盘文件名就是资产号（UUID），所以本机地址由记录本身推出，**任何会过期的链接都不进存储**。注册表 `scendance:aholo-assets`，上限 40 条，只存 `assetId / kind / name / bytes / savedAt / taskid`。
- 同一任务号重复点只复用本机文件：探针台账里第二次起就没有 `POST /asset`，只有 `GET /asset/<id>.glb`。
- 图纸 `scendance-editor-local-v1` 里那条物料只有 `assetId`；断言直接读 `localStorage` 确认 `glbUrl` 不在。
- 入口两处：Aholo 面板的「放进 3D 场景」（首次）与物料抽屉左轨「生成物件」图标（以后每次）。两者走同一条 `placeCatalogItem`，所以撤销、拖拽、吸附、方案保存全都沿用原管线。

## 2. 任务二：3DGS 环境预览

`@sparkjsdev/spark@2.4.0`（peer `three >= 0.180`，本机 three 0.186），只在真正进预览时才动态 `import`，不进首屏 chunk。

- **取哪一份**：`outputs` 里优先 `.spz`，没有才退回 `.ply`；`lod-meta.json` 不是场景本体，不参与。
- **怎么摆**：先按分位数取稳健包围盒（离群 splat 不再把场地撑大），再按 `upAxis` 立起来，最后按**场地最长水平边**等比缩放、底面贴 y=0、水平中心对齐场地原点。
- **渲染栈**：点云待在自己的 `THREE.Scene` + 唯一一个 `SparkRenderer` 里。每帧两趟 —— 先画点云当背景（天空渐变临时挪到那一层，免得没盖到的地方发黑），再 `autoClear = false` 叠画布置场景。所以点云**不参与拾取**（`drag-handlers` 只 raycast `userData.type === 'furniture'`），也不会被 `removeTagged` 清掉。
- **场地壳体**：只在预览那两趟之间按原值临时隐藏，画完逐条还原。这样既看得见扫描里的家具，又不会和墙体剖切（`applyWallDisplay` 每帧改 `visible`）互相打架。退出时补一次静态阴影图。
- **相机**：共用现成的相机与轨道控制器，转视角时点云和场景天然对齐；进场用 `frameSplatView` 站到离地 1.6 m 的场**内**（从场外看只会是一块悬空的地板），退出把机位原样还回去 —— 探针用画面哈希验证：进入前 `91b20dab4497`，退出后仍是 `91b20dab4497`。

## 3. 朝向有实测依据，不是猜的

Aholo 的 `/world` 详情里这条任务**没有**给 `semanticsMetadata.upAxis`，所以代理侧加了透传（给了就照用），前端默认按 Z-up。判据来自那条历史 World 的 PLY：262,991 个顶点，三根轴的范围是 **x 23.38 / y 15.51 / z 3.57** —— 最短的是 z，房间高度本来就比地面短，所以竖直轴是 z。渲染结果（全景图里那间木地板宴会厅 + 摆进去的桌椅站在地板上）与之一致。

## 4. 没做的那一半降级

她给的是「优先方案：直接实现单包 `.spz` 加载器，跳过 `lod-meta.json` 的多级分块解析」，本轮按这条走完了。LOD 根块 Fetch 截断那套**没有实现**：单包路径已经能开，而截断要先解析 `lod-meta.json` 才知道根块在哪，等于把跳过的解析又捡回来。首开性能靠稳健包围盒 + 分位采样 + render-on-demand 兜着。

## 5. 已知限制与未验证项

1. **扫描没有天花板**：3DGS 常见缺陷，画面上半截是天空渐变，不是本站画错。
2. **真实米数未知**：Aholo 不报场景实际尺寸，比例只能跟着场地最长边推算。场地 10×8 时扫描被拉成 10 m 宽；家具与扫描之间可能略有出入。要精确对位得让她手填一个比例输入，本轮没加（她说「逻辑我们以后改」）。
3. **预览期间壳体不投影**：进出各补一次阴影图，退出后画面已验证回到原帧。
4. **场景包不能从界面删除**：和 GLB 同一遗留 —— 注册表能撤，本机文件还在 `.cache/aholo/`，要删得代理侧加删除接口。
5. **云端发布仍带不了本机资产**：`LOCAL_ASSET_NOT_UPLOADED`，物件与场景同理。
6. **刷新后立刻点卡片**：以前会报「3D 场景还没就绪」，现在改成排队，WebGL 一起来就自动补上；本轮实测第一次点即成功（探针日志没有走重试分支）。
7. 探针跑在无头 Chrome + SwiftShader 上，帧率与真机独显不同；本轮只用来验功能与画面结构，没有做性能测量。
8. **一条与本轮无关的旧红**：`three/scene-presets.test.ts:93` 断言 `state.objectRows`，但全仓（含 `supabase/functions/_shared/jev.ts`）已经没有 `objectRows` 这个字段，只有这条测试还在引用它 —— 测试比代码旧，不是本轮改坏的。要修就得先决定那段压缩编码到底还回不回来，本轮没动它。

## 6. 证据

- `docs/evidence/aholo/world-3FO4K4QI6N4V/probe-2026-10-30.log` — 20 条断言全 PASS 的原始输出（含请求台账，可核对「没有创建请求」）。
- `docs/evidence/aholo/world-3FO4K4QI6N4V/aholo-splat-full.png` — 站进扫描里的整页画面：木地板大厅 + 摆进去的两桌三椅一盆栽。
- `docs/evidence/aholo/world-3FO4K4QI6N4V/aholo-splat-shelf.png` — 抽屉「环境预览」档：状态行报 262,991 个高斯点，卡片标住正在预览的那条。
- 只读复用的历史任务：Lux `4425274`（GLB）、World `3FO4K4QI6N4V`（SPZ/PLY）。

## 7. 复现命令

```text
cd frontend && npx next dev            # 本机 :3000 卡死时会自动换 :3001
node tools/aholo/lux3d-dev-proxy.mjs   # 127.0.0.1:3199

curl "http://127.0.0.1:3199/world?worldId=3FO4K4QI6N4V"   # 只读，返回 status/progress/outputs/panoUrl

node --test tools/aholo/lux3d-dev-proxy.test.mjs                                # 195 pass
npx vitest run components/room-organizer/three/splat-preview.test.ts             # 11 pass
npx vitest run components/room-organizer/lib/aholo-model-placement.test.ts       # 10 pass
npx vitest run components/room-organizer/panels/lux3d-direct-test.react.test.tsx       # 71 pass
npx vitest run components/room-organizer/panels/scendance-workspace.react.test.tsx     # 16 pass
npx tsc --noEmit && npx eslint <改过的文件>                                        # 无输出
```
