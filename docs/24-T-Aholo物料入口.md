# T-AHOLO-ENTRY · 接回「物料建模 / Lux3D」入口 + 修招呼语字面 `\n`

> 开卡日期：2026-10-28
> 前置事实：Lux3D 真调已通（task 4425274：`MODEL.glb` 881 KB + 6 张 PBR；World `3FO4K4QI6N4V`：PLY 17.9 MB / SPZ 4.4 MB）；组件 `generated-model-library.tsx` 14 项测试通过。
> 缺陷：`openModelTools` 在全前端没有调用者，界面上进不到「物料建模 → 历史模型」，Lux3D 区块因此不可见。

## 背景（为什么现在做）

- 上一版 IA 把左栏工具收到 3 条（图纸尺寸 / 活动需求表 / 合同约定），`物料建模` 只剩 `toolsApiRef` 里一个没人调的方法。
- 用户要求：把入口接回界面（点名，2026-10-28）。
- 同一轮顺带修招呼语里显示成 `\n` 两个字符的问题。

## IN（本卡只做这些）

1. **左栏「活动简报 → 更多资料」新增「物料建模」入口**（文书组，`Icon: Boxes`），点击调 `openModelTools()`，打开左栏「活动资料 → 物料建模」。
2. **活动资料页头补「物料工具」切换链接**：位于现有「客户需求 / 图纸与照片」旁，`aria-pressed` 跟随 `businessMode==='model'`；进入后仍能点回前两个。（用「物料工具」而不是「物料建模」，避免与面板内的「物料建模 / 材质调整」两个工具页签撞名，屏幕阅读器也不会念出两个同名按钮。）
3. **修 `agent-panel.tsx` 招呼语的字面 `\\n`**：改为真实换行字符（`.ap-agent.is-long` 已是 `white-space: pre-line`），不再显示两个字符。

## OUT（本卡明确不做）

- 不动 14 键工具列、左轨三阶段图标、logo、主按钮「确认布置」。
- 不接真 API、不改 Supabase Edge、不新建 Aholo 生成任务、不消耗额度。
- 不做 M3 3DGS loader（PLY/SPZ 背景层）——另卡。
- 不修「项目 / 设置 / 头像都开素材库」——已知缺陷，另卡。
- 不改 `generated-model-library.tsx` 的生成逻辑与文案。

## 验收 checkbox

- [x] `npx tsc --noEmit` — 本次三处改动 0 error；**仓位里仍有 1 条既有错误**：`scendance-workspace.tsx(115,54) TS6133 'onLighting' 未使用`（上一版提交里就有，属「现场灯光未接线」问题，按用户指示本卡不动）
- [x] `vitest run` 定向：`creative-studio` / `generated-model-library` / `cloud-panel` / `scendance-workspace` → **4 files / 305 tests 全绿**
- [x] 浏览器：左栏「活动简报 → 更多资料」出现「物料建模」，点击后左栏切到活动资料 → 物料建模，`#agent-panel-model` 显示，页头「物料工具」按下
- [x] 浏览器：页头「物料工具」按下态正确，点「客户需求」回到策划视图，再点「物料工具」能回来（往返各一次）
- [x] 浏览器：招呼语内容不再含字面 `\n`（`textContent` 判定为 false，实际为真实换行）

### 补充说明（登录门控）

未登录时「历史模型」区显示「请先登录云项目。」，Lux3D 区块按 `capabilities.aholoTextToModel` 门控不出现——这是设计如此，不是本卡缺陷。要看到 Lux3D 区块需登录云项目；组件层已有 14 项测试覆盖（能力位隐藏 / 提交 aholo / 图生 / 空描述 / 失败保留草稿）。


## 落点

| 文件 | 改动 |
|---|---|
| `frontend/components/room-organizer/room-organizer.tsx` | `RAIL_TOOLS` 加 `model` 一条 + `Boxes` 图标导入 |
| `frontend/components/room-organizer/panels/creative-studio.tsx` | `cr-business-links` 补「物料工具」按钮 |
| `frontend/components/room-organizer/panels/agent-panel.tsx` | 招呼语 `\n` → `{'\n'}` |

## 自检记录（2026-10-28）

```text
tsc --noEmit        → 仅剩既有 1 条 onLighting TS6133（非本卡）
vitest（4 个文件）   → 305 passed / 0 failed
浏览器 DOM 校验      → 更多资料含「物料建模」；点击后 #agent-panel-model 显示、
                       页头「物料工具」aria-pressed=true；客户需求 ↔ 物料工具 往返正常
招呼语               → textContent 内不再有 "\n" 两字符
```

未 commit / 未 push / 未部署。

