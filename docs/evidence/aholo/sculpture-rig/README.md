# 雕塑 humanoid auto-rig 实测记录

日期：2026-11-06（Asia/Shanghai）
对象：`docs/evidence/aholo/sculpture-img2-3d/4676340-unpacked/MODEL.glb`（985,424 B，md5 `0cde9c2eba8c1afd3962f536cc2254da`，Lux3D taskId 4676340）

## 结论

**绑骨失败，且是业务级拒绝，不是网络或鉴权问题。**

Aholo 先判定主体**是类人形**，再因**站姿不合格**拒绝：

```json
{"error":{"code":"MODEL_NOT_RIGGABLE","message":"主体为类人形角色，但双臂弯曲抱于身前，不符合可绑骨的T-Pose或A-Pose站姿要求。"}}
```

这意味着：拓扑不是问题，「拱手低头」的双手交叠姿势是问题。要绑骨，必须先把这个姿势改成 T-Pose 或 A-Pose（即手臂张开），而改姿势会破坏雕像原本的造型语义。

## 任务记录

| 项 | 值 |
|---|---|
| Endpoint | `POST https://api.aholo3d.cn/lux3d/v1/animations/rig/task/create` |
| 请求体 | `{"modelUrl":"https://holo-cos.aholo3d.cn/resource/platform/temp/2026/11/06/NLWVBDQKTK2RYAABAAAAADA8.glb"}` |
| 上传 | asset token → `ous/api/v2/single/upload` → status 轮询，2 次拿到 URL，耗时 2.5 s |
| 资产 ID | `3FO2QX9JMMQJ` |
| taskId | **4734738** |
| 创建响应 | `{"f":null,"c":"0","m":"","d":4734738}`，HTTP 200，188 ms |
| 轮询 | 38 次，间隔 5 s；status 0 → 1 → 4；`progress` 字段始终缺失 |
| 终态 | `status=4`（失败） |
| 总耗时 | 提交到终态 **191 s**（全流程约 194 s） |
| 积分 | **接口不返回**：create 与 query 响应体均无 credits/points 字段 |

## 四项核验

**全部无法执行——服务端没有产出 rigged GLB。**

- `skins` / `JOINTS_0` / `WEIGHTS_0` / `animations`：无产物
- 包围盒与坐标：无产物
- rest pose 是否保持拱手低头：无产物（但服务端明确要求改成 T/A-Pose 才能绑）
- 背面中缝是否被重拓扑放大：无产物，无法判断

## 连带阻塞

`/lux3d/v1/animations/retarget/task/create` 的必填字段是 `rigModelUrl`，本次没有 rig 产物，**retarget 无法提交**。

## 预设动作清单（来自官方 OpenAPI enum，85 个）

走路类确实存在：`Walk_Loop`、`Walk_Formal_Loop`、`Walk_Carry_Loop`、`Jog_Fwd_Loop`、`Sprint_Loop`、`Zombie_Walk_Fwd_Loop`。另有 `A_TPose` 可直接生成 T-Pose 参考。

## 文件

- `run-rig.mjs` — 实跑脚本（上传 + 提交 + 轮询 + 下载）
- `probe-rig-api.mjs` — 只读 endpoint 探针
- `rig-report.json` — 结构化结果
- `rig-run.jsonl` — 逐条时序日志
