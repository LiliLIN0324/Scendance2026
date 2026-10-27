# 晴光 Agent 在场感调研

> 日期：2026-10-27（Asia/Shanghai）  
> 范围：Agent 本体呈现（收起/在场）；**不含**画布工具岛（T-06）  
> 约束：不改产品代码、不建仓、不 commit  
> Page：[晴光 Agent 在场感调研](https://cursor.com/canvas/store-3e5ed5f3-ba6e-4f35-a16b-76a7db04eca1/55210729-c5e7-4d93-92d5-acf7a58d9d98)

## 结论

**推荐默认：场边活体角色球。** 收起 = 圆形/半身晴光停在画布场边，状态靠换图或轻循环，点一下展开右栏。不要把默认头塞进带标题的信息卡。阶段/「本地演示」进 aria / 悬停 / 展开态。

根因不是 IP 稿不够，而是收起被实现成「缩小版状态条」。业界 companion 收起时仍是角色本体。

**推荐仓名：`LiliLIN0324/qingguang-presence`**（备选 `scendance-agent-presence`）。**暂缓 `gh repo create`**，先拍板方案 A + assets 出图清单。

---

## 1. 现状诊断

本机 `AgentReopenCard`：`frontend/components/room-organizer/panels/agent-panel.tsx`

- 注释：原来是一条 34px 竖排把手；现为浮窗卡片。
- 实现：`sc-agent-reopen` = 28×28 静帧 img +「晴光 Agent」+ 状态点 + 阶段小字（可含「本地演示」）。
- 样式：`frontend/app/globals.css`（约 829–849 行）——绝对定位右上、圆角边框、纸色底、轻阴影。

| 缺口 | 现状 | 为何像笨卡片 |
| --- | --- | --- |
| 隐喻错误 | 收起 = 缩小面板 | 期待角色离席到场边；得到控件缩略图 |
| 静帧塞卡 | 默认头 28px 贴进矩形 | 框住就变成徽章，不是在场体 |
| 信息过载 | 标题 + 点 + 阶段 + 演示标 | 像状态条，不像 companion |
| 无生命感 | 无呼吸/注视/微动 | 展开有头像、收起变死图 |
| 状态管线断 | ask\|done\|issue 有；busy/收起半身无 | 忙时无独立脸；收起无专用构图 |
| 与工具岛 | 浮右上、让开工具列 | 本报告专攻 Agent；T-06 另开 |

---

## 2. IP 资产与五态缺口（盘点事实）

### 源仓 `/workspace/ip-character/spotlight-plush/`

- 主头：`head_plush_{32|40|sq}.png`、`head_3d_master.png`
- 状态仅：`plush_{32|40}_{ask|done|issue}.png`
- **`flat_*` 全作废，禁入库**

### 已进产品 `Scendance2026/frontend/public/assets/assistant/`

- `qingguang-3d-{32|40}.png`（+@2x）
- `qingguang-3d-{32|40}-{ask|done|issue}.png`（`states/` 同套）

### 五态映射

| 五态 | 切图 | 动效 | 收起态后果 |
| --- | --- | --- | --- |
| 收起 | **无独立切图** | 无 | 默认头塞浮卡 → 笨卡片 |
| 旁观 ≈ 默认 | 有默认头 | 无 | 静帧可撑球，仍无生命感 |
| 忙 busy | **完全缺失** | 无 | 只能硬用默认/issue，语义假 |
| 完成 / 发现问题 / 提案中 | 有 ask\|done\|issue 静帧 | 无 | 换图钉仍对，但无微动 |

**动效规格目前零**：无 Lottie / sprite / 呼吸文档。

**给 IP 的出图最低清单**：idle 呼吸循环 + busy 微动 + 收起半身（半身/圆裁，不是再塞方卡头）。头像钉 32/40 毛绒 3D 不变。

---

## 3. 业界对照（可核验链接）

共性：收起保留角色本体；状态驱动表情/循环；点角色才开对话。Cursor 侧栏偏面板开关，是反例。

| 参考 | 形态 | 可借点 | URL |
| --- | --- | --- | --- |
| lil-agents | Dock 上走动角色 | 收起=场边角色 | https://github.com/ryanstephen/lil-agents |
| dsh-mascot | 可拖悬浮宠 | 会话态换脸；缩成小头像；reduced-motion | https://github.com/falser101/dsh-mascot |
| Vibebud | 浮宠 + dock | 多端在场 | https://github.com/Shellishack/vibebud |
| LuoXiaoHeiPet | 桌宠 | 10+ 动画态 | https://github.com/alertform/LuoXiaoHeiPet |
| floating-chat | 角标浮钮 | 收起=圆钮非卡 | https://github.com/ehauzman/floating-chat |
| rive-react | 状态机 runtime | 输入驱动 idle↔busy | https://github.com/rive-app/rive-react |
| dotlottie-web | Lottie 播放 | 资源与代码解耦 | https://github.com/LottieFiles/dotlottie-web |
| Interactive-Avatar-Rive | 示例 | 布尔态驱动 | https://github.com/Eyuvaraj/Interactive-Avatar-Rive |
| spine-runtimes | 骨骼 | 偏重，MVP 非默认 | https://github.com/EsotericSoftware/spine-runtimes |
| Rive Avatar 教程 | 设计→React | 产线参考 | https://rive.app/use-cases/avatar-creator-tutorial |
| Cursor 论坛 | 侧栏浮出需求 | 反例：面板 ≠ 在场 | https://forum.cursor.com/t/feature-request-make-the-ai-sidebar-a-floatable-detachable-panel/107208 |

---

## 4. 方向决策

### A · 场边活体角色球（**推荐默认**）

- Pros：收起仍是晴光；对齐 lil-agents/dsh-mascot；换图钉可续；信息下沉
- Cons：要收起半身 + idle；定位避工具列；替换 AgentReopenCard

### B · 仅头像浮标 + 微状态

- Pros：改动最小；现有静帧可撑
- Cons：仍偏按钮；busy 仍缺 — **仅紧急止血，非目标态**

### C · 轻量 Lottie / Rive 循环

- Pros：真呼吸/微动；成熟 runtime
- Cons：动效规格为零 — **适合叠在 A 上（M3），不阻塞纠偏**

落地顺序：A 构图 → 补 busy + 收起半身 → C 循环。

---

## 5. 单开仓蓝图

| 项 | 建议 |
| --- | --- |
| 仓名 | `LiliLIN0324/qingguang-presence` |
| 备选 | `LiliLIN0324/scendance-agent-presence` |
| 理由 | 强调 IP 在场层，避免被当成整颗 Agent/业务仓 |
| 边界 | 只做在场层（收起/展开过渡、状态机、资源、嵌入组件）；**不**吞布置/提案/导出 |
| 消费 | GitHub 依赖按 tag `#v0.x`；本地 `file:../qingguang-presence`。不推荐 submodule / 裸复制 |
| 立刻建仓？ | **否** — 先拍板 A + 出图清单 |

### 建议目录

```
packages/presence/          # React 组件 + 状态机
assets/                     # 唯一合法资源根；禁 flat_*
  still/head/               # 32|40|sq 主头 + @2x
  still/state/              # ask|done|issue（+ 待补 busy）
  still/collapsed/          # 收起半身 / 圆裁专用
  motion/idle/              # 呼吸循环（Lottie/dotLottie 或 sprite）
  motion/busy/              # 忙微动
  motion/manifest.json      # 态→文件、时长、reduced-motion 回退
docs/spec/                  # 在场感规格、五态表、接入协议
apps/demo/                  # 独立 demo，不依赖主应用
```

### 接入协议（宿主 props；presence 不读业务 store）

```ts
state: 'idle' | 'thinking' | 'ask' | 'done' | 'issue' | 'busy'
size: 32 | 40 | number   // 头像钉或收起球像素
onOpen: () => void
reducedMotion?: boolean  // 默认跟 prefers-reduced-motion
label?: string           // aria，默认「打开晴光 Agent」
```

宿主投影业务态 → `state`；presence 只换图/播循环。**禁止角标叠头**——状态靠资源。

---

## 6. MVP 三步（可验收，无实现代码）

1. **M1 纠偏收起隐喻**：demo 收起=场边角色球（静帧半身或圆头），无标题/阶段主视觉；`onOpen`；并排对比旧卡片；与 T-06 hit 区写清。
2. **M2 五态资源齐套**：目录落齐；IP 交付 busy 静帧 + 收起半身；manifest；`flat_*` CI 拒收；reduced-motion 回退。
3. **M3 生命感闭环**：idle 呼吸 + busy 微动；展开/收起身份不断；协议与 demo 验收（产品替换 AgentReopenCard 另开任务）。

### 检查清单（截至写报告时）

- [x] 调研 Page + 本机 md 落盘（2026-10-27）
- [ ] 拍板默认方案 A + assets 出图清单
- [ ] `gh repo create qingguang-presence`（人拍板后）
- [ ] M1 demo 角色球
- [ ] M2 busy + 收起半身入库
- [ ] M3 idle/busy 动效 + 宿主接入协议
