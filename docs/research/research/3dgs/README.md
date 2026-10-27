# 3DGS 调研 · 幕景 Scendance

> 定稿同步自 Cursor Page（2026-10-25）。splat = **观感层**；布置真相仍是 **glTF**。未点头不进产品代码。

## 一句话结论

多视角视频/照片经 COLMAP（或消费级 App）训成 3DGS → 以 `.ply` 为源、转 SOG/SPZ/.ksplat 压缩 → 用 Spark 或 SuperSplat 在浏览器播；进幕景只作静态场地背景层，「布置」物件仍走 glTF 网格。

依据：经典 3DGS 输出不可编辑实体网格；Three.js 侧 Spark 可与 mesh 同场景，但 splat 内无法像节点一样替换单件家具。

## 推荐 MVP

1. **采集**：手机环绕拍场地；或 Polycam Basic 拍 splat。
2. **重建**：Polycam / Postshot 出 PLY；自托管走 gsplat / nerfstudio。**勿商用 INRIA 原版。**
3. **压缩**：PLY → SOG / SPZ / .ksplat（勿直接上大 `.ply`）。
4. **Web 播**（候选）：幕景内嵌 [Spark](https://sparkjs.dev/)；或先 iframe SuperSplat 验观感。
5. **能否进布置**（候选）：仅锁定背景层；碰撞用粗糙代理 mesh；家具/展台仍 glTF。

## 不适合

- 整场 splat 当可布置场景图
- 用 splat 做精确动线 / 净空 / 碰撞
- 单图生成（DreamGaussian / LGM / Splatter Image）当场地真相
- 4D/动态 GS 做活动布置主路径
- 未授权商用 INRIA `gaussian-splatting`
- 期望 splat 内局部材质等价 glTF PBR

## ① 开源模型 / 管线

| 方案 | 输入 | 输出 | 许可 | 显存/时长 | 链接 |
|------|------|------|------|-----------|------|
| 经典 3DGS (INRIA) | 多图/视频 + COLMAP | `.ply` | 研究/评估非商用 | 论文质量约 24GB VRAM | https://github.com/graphdeco-inria/gaussian-splatting |
| 2DGS | 同 3DGS | splat + 可导 mesh | 同上游非商用习惯 | 待核 | https://github.com/hbb1/2d-gaussian-splatting |
| SuGaR | COLMAP / 已训 3DGS | hybrid mesh+Gaussians | 注意上游许可 | 提 mesh ~30min/单卡（作者） | https://github.com/Anttwo/SuGaR |
| Scaffold-GS | COLMAP | anchor + MLP | 跟随 3D-GS LICENSE | 待核 | https://github.com/city-super/Scaffold-GS |
| 4DGS (hustvl) | 时序多视角 | 动态 4D | Apache-2.0 | D-NeRF ~8min 等（作者） | https://github.com/hustvl/4DGaussians |
| 压缩 SOG/SPZ/.ksplat | 已训 `.ply` | 压缩格式 | 格式开放 | 体积见 PlayCanvas 文档 | https://developer.playcanvas.com/user-manual/gaussian-splatting/formats/ |
| DreamGaussian | 单图/文本 | `.ply`→mesh | 含 3DGS 衍生许可 | ~2min 量级（README） | https://github.com/dreamgaussian/dreamgaussian |
| LGM | 单图/文本 | `.ply` | MIT | 推理约 10GB | https://github.com/3DTopia/LGM |
| Splatter Image | 单图 | 3DGS/`.ply` | BSD-3 | 待核 | https://github.com/szymanowiczs/splatter-image |
| gsplat | 训练栈 | — | Apache-2.0 | MipNeRF360 示例约 3.5–3.8GB / ~16min（PR#208，非通则） | https://github.com/nerfstudio-project/gsplat |

## ② 产品 / 平台

| 产品 | 采集 | 实时? | 导出 | 浏览器播 | 价格档 | 链接 |
|------|------|-------|------|----------|--------|------|
| Luma 3D Capture | iPhone 视频 | 云端 | 待核完整扩展名 | 是 | Capture 单独价待核 | https://lumalabs.ai/ios |
| Polycam | 手机/Web | 云端 | Splat PLY；mesh glTF 等 | 是 | Free 无 splat；Basic $30/月；Business $400/年·人 | https://poly.cam/pricing |
| Postshot | Win 本地 | 本地 GPU | PLY / SPZ；HTML | HTML 可开 | Free 非商用；Indie/Studio 欧元待核 | https://www.jawset.com/shop/pricing/ |
| Nerfstudio | 自备图 | 研究管线 | Splatfacto→PLY | 训练侧 Web | Apache-2.0 | https://github.com/nerfstudio-project/nerfstudio |

## ③ Web 播放

| 播放器 | 引擎 | 格式 | 嵌 Three | 备注 | 链接 |
|--------|------|------|----------|------|------|
| Spark | THREE.js | ply/splat/ksplat/spz/sog | 是 | 幕景优先候选 | https://sparkjs.dev/ |
| GaussianSplats3D | THREE.js | ply/splat/ksplat | 是 | 作者推荐改用 Spark | https://github.com/mkkellogg/GaussianSplats3D |
| antimatter15/splat | WebGL1 | ply→splat | 弱 | 轻量 | https://github.com/antimatter15/splat |
| SuperSplat | PlayCanvas/WebGPU | ply/splat/spz/sog | 非原生 Three | 剪辑/发布旁路 | https://github.com/playcanvas/supersplat |

## 浏览器性能 / 观感硬闸（氛围调研补栏）

| 项 | 闸 |
|----|-----|
| 栈候选 | 网格+只看 splat → Spark；纯播可 SuperSplat Viewer |
| 交付格式 | 优先 `.sog` / compressed.ply / `.spz` |
| LOD | SuperSplat 用 `budget`；禁默认 `fullload` 大场景 |
| 观感禁 | Bloom / 强体积光 / 大片粒子；雾勿糊掉 splat 边缘 |
| 交互 | 只看不编；碰撞仅 glb/体素参考，不写 SceneV2 |
| 验收 | 目标机拖一圈无白闪、不卡成幻灯；与 mesh 叠深度不错乱 |
| FPS/显存 | docs 无写一律**待核、目标机实测** |

## 与队友边界

1. 几何/CAD、平面图→可布置空间 → 平面图转3D  
2. 灯光氛围、实时观感 → 场景氛围  
3. 本目录：splat 管线 + 背景层 vs 布置层边界  

## 仍待核

- Postshot Indie/Studio 欧元现价  
- Luma Capture 与 Dream Machine 定价关系  
- 幕景内 Spark 与点选/导航深度实测  

## 来源

- https://github.com/graphdeco-inria/gaussian-splatting  
- https://developer.playcanvas.com/user-manual/gaussian-splatting/formats/  
- https://poly.cam/pricing  
- https://sparkjs.dev/  
- https://www.jawset.com/shop/pricing/  
