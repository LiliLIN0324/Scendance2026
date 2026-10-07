# tools/blender

用 Blender 的 Python 接口（`bpy`）做三维建模的可行性探索。

**结论：技术上可行，但不能放进请求路径。** Blender 5.2.2 LTS 产出的 GLB 能通过后端全部校验，几何与现有 TypeScript 生成器**完全等价**；但单次调用约 2.7 秒、工具体积 913 MB，比现有方案慢约 190 倍。适合的位置是**离线/异步预生成**，不是 Edge Function 里的实时建模。

## 实测数据（2026-10-07，Windows）

同参数（`table` 1.2 × 0.6 × 0.75 米，四腿）对比：

| | 现有 `buildParametricGlb`（`parametric.ts`） | Blender 脚本 |
| --- | --- | --- |
| 单次耗时 | **13.9 ms**（5 次：21.5 / 16.1 / 12.5 / 9.0 / 10.7） | **~2.7 s**（3 次：3003 / 2744 / 2580 ms） |
| 输出体积 | 8.1 KB | 7.9 KB |
| 三角面 / primitive | 60 / 5 | 60 / 5 |
| 运行时依赖 | npm 包（已装） | Blender 5.2.2，**913 MB** |

慢的部分不是启动：`blender --version` 只要 **277 ms**，其余 ~2.4 s 是 Python 初始化、glTF 导出插件加载与场景装配。

覆盖 6 个 family 的 11 个样例全部通过，共耗时 39.9 s（约 3.6 s/样例）：

```
PASS  table/rectangle/four          60 tris, 5 prims, 7.9 KB, drift 4.8e-8 m
PASS  table/round/four             172 tris, 5 prims, 14.0 KB, drift 1.9e-8 m
PASS  table/round/pedestal         248 tris, 2 prims, 14.7 KB, drift -2.9e-8 m
PASS  chair/backed                  72 tris, 6 prims, 9.4 KB, drift 2.5e-8 m
PASS  chair/stool                   60 tris, 5 prims, 8.0 KB, drift 1.3e-8 m
PASS  counter/straight              48 tris, 4 prims, 6.4 KB, drift 2.4e-8 m
PASS  counter/l                     72 tris, 6 prims, 9.4 KB, drift 9.5e-8 m
PASS  platform                      12 tris, 1 prims, 2.1 KB, drift 9.5e-8 m
PASS  backdrop                      24 tris, 2 prims, 3.4 KB, drift 2.4e-8 m
PASS  cabinet/open/no-shelves       60 tris, 5 prims, 7.9 KB, drift -3.8e-8 m
PASS  cabinet/closed/three-shelves 108 tris, 9 prims, 13.7 KB, drift -3.8e-8 m

11/11 passed (Blender 5.2.2 LTS)
```

`drift` 是导出后实测包围盒与请求尺寸的最大偏差，容差取 `parametric.ts` 里 `PARAMETRIC_BOUNDS_MISMATCH` 用的 **1e-5 米**。实测全部在 1e-7 量级，说明 Blender 的 Z-up → glTF Y-up 转换与浮点精度都不是问题。

## 用法

```sh
# 需要 Blender；用 BLENDER 指定可执行文件，或让它出现在 PATH
BLENDER="/c/Program Files/Blender Foundation/Blender 5.2/blender.exe" \
  node --experimental-transform-types tools/blender/verify-parametric.ts

# 只生成单个模型
blender --background --python tools/blender/build_parametric.py -- \
  --params params.json --out model.glb
```

`verify-parametric.ts` 是唯一的验证入口：它用共享的 `parametricParametersSchema` 校验参数、用共享的 `validateModel` 校验产物，再比对包围盒。参数与产物两端都走项目自己的契约，因此"通过"的含义与后端接受的含义一致。

## 为什么这些输出能被后端接受

`validateModel`（[models.ts](../../supabase/functions/_shared/models.ts)）的硬约束，以及 Blender 端的对应处理：

| 约束 | 处理方式 |
| --- | --- |
| 单一 scene、无相机/灯光 | `read_factory_settings(use_empty=True)` 起空场景 |
| 所有 primitive 必须是三角面 | glTF 只支持三角面，导出器自动三角化；由 `validateModel` 复核 |
| 无 animations / skins / `extensionsRequired` | `export_animations=False`；材质只用 Principled BSDF 的基础槽，不引入必需扩展 |
| 无外部 URI（必须自包含） | `export_format='GLB'` |
| 三角面 ≤ 10 万、primitive ≤ 200、节点 ≤ 500 | 盒子/圆柱，实测最大 248 面 / 9 primitive |
| GLB ≤ 10 MB、贴图 ≤ 2048 | 无贴图，实测最大 14.7 KB |
| 包围盒 = 请求尺寸 | 用单位立方体数据级缩放（±0.5 → ±w/2），不做 `transform_apply` |

坐标系：Blender 是 Z-up，导出器转 Y-up。脚本按 X=宽、Y=深、Z=高建模，导出后 X=宽、Y=高、Z=深，与 `parametric.ts` 的 `sourceSize` 约定一致。

## 架构选项与建议

现有生成链路跑在 Supabase Edge Functions（Deno）里，**装不下 Blender**，所以"Blender 以什么形态接入"是必须先定的问题：

| 方案 | 说明 | 代价 |
| --- | --- | --- |
| **A. 离线预生成**（建议） | 参数组合有限，用离线段把常用构型批量烘成 GLB 归档；运行时按指纹取用 | 需要维护资产归档；冷门参数要么覆盖要么回退到 TS 生成器 |
| B. 独立容器服务 | 把 Blender 放进容器，由 worker 异步调用 | 需要新服务与 913 MB 级镜像；队列延迟 ≥ 3 s/件 |
| C. 保留 TS 生成器 | 现有 13.9 ms、零外部依赖，几何已经够用 | 放弃 Blender 的表达力（倒角、UV、Geometry Nodes、烘焙） |

**建议 A + C 并存**：简单构型继续走 TS，把 Blender 留给"TS 手写网格表达不了"的东西——真正的价值不在复刻现有的六类盒子，而在更复杂的造型、更好的 UV/材质、以及用 Geometry Nodes 做参数化。

## 这个探索还没有验证的事

- **Geometry Nodes / 更复杂的造型**：本次只复刻了现有六类构型，没有触碰 Blender 真正的优势场景。
- **与 Hunyuan（HY-3D）生成流程的关系**：现有异形装饰走 HY3 单体生成，与 Blender 路线如何分工未评估。
- **资产优化**：仓库里 10 个模板 GLB（4–6 MB）与模型库能否用 Blender 压缩/减面，未实测。
- **确定性与版本漂移**：GLB 字节是否跨 Blender 版本稳定（是否可作为指纹/去重依据）未验证。`createParametricAsset` 目前用参数指纹去重，若改用 Blender 产物需要重新确认这点。
- **许可**：Blender 本体是 GPL，但**导出的 GLB 属于你**，不传染；本探索只调用命令行，不链接 Blender 代码。

## 本机环境说明

本机装了两种 Blender，任选其一（`BLENDER` 环境变量优先）：

- 便携版：`E:\tools\blender-5.2.2-windows-x64\blender.exe`（免管理员，913 MB）
- MSI 版：`C:\Program Files\Blender Foundation\Blender 5.2\blender.exe`

下载的 `blender-5.2.2-windows-x64.zip`（385.7 MB）留在 `E:\tools\`，可删。
