# 3D 罗盘两侧转向箭头复刻计划（交接）

日期：2026-11-16  
范围：右下角 Google Maps 风格 3D 罗盘，仅处理圆盘外圈内的左右两枚「旋转 90°」箭头。

## 当前决定

- **本版暂时关闭两只转向箭头**：`SHOW_COMPASS_TURN_ARROWS = false`。
- 罗盘本体继续保留：Canvas 绘制、指针跟随地图方位角、拖动旋转、点击回正北。
- 不显示箭头时，点击罗盘任意位置都统一回正北；不再保留「点左/右半区转 90°」的隐藏热区。

## 目标

在 44px 的罗盘内，1:1 还原 Google Maps 3D 罗盘：

- 深色圆盘，红上白下细长指针。
- 左右各一枚弯曲转向箭头，箭头头部落在下方，分别指向左下、右下。
- 箭头弧线起笔靠近指针，向外鼓出后回收，不能像大括号、不能贴外缘。
- 左右严格镜像；指针旋转到 0°/90°/180°/270° 时都保持居中，不偏轴。
- 44px 实际尺寸下清晰，不糊、不发毛。

## 参考素材

- 用户在对话中提供的目标图：深色圆盘 + 红白指针 + 两侧弯曲箭头。
- 用户在对话中提供的失败状态图：指针横向、倒置时偏心，箭头弧度/头部不匹配。
- **重要：参考图目前只存在于对话中，未入仓。接手前先把高清原图或 4× 放大截图保存到 `docs/assets/compass/`，后续所有对比都基于同一张图。**
- 优先寻找 Google Maps 3D 罗盘的原始 PNG/SVG 或高分辨率官方截图。能找到原始资产时，不再手绘。

## 已尝试与失败原因

1. **手写 SVG 贝塞尔弧**
   - 左右镜像坐标正确，但弧线起笔、鼓出位置、箭头切向靠肉眼调，反复出现“大括号”“勾子”“角度不对”。
2. **SVG 标准圆弧 `A` + 镜像 `transform`**
   - 对称性解决了，但曲率和箭头朝向仍不匹配；用户明确否决。
3. **CSS `conic-gradient` 圆弧 + `clip-path` 箭头**
   - 角度可控，但 44px 下边缘发毛、箭头衔接差，未采用。
4. **Canvas `arc`/`ellipse`**
   - 当前保留方案，能用数值控制圆心、半径、起止角；但两侧箭头的最终形状仍未达到用户要求，所以先隐藏。
5. **现成图标库**
   - Material `rotate_left/right`、Lucide `rotate-ccw`、Phosphor `arrow-arc-left/right` 均为整圈/大弧，和 Google 这枚短月牙不一致。

## 推荐做法（按优先级）

### 方案 A：使用真实资产（首选）

1. 找到 Google Maps 3D 罗盘的原始位图/矢量，或截取 4× 以上高清图。
2. 只裁出**左右箭头**，做成透明 PNG（建议 176×176 画布对应 44px 显示）。
3. 作为 `background-image` 或 `<img>` 叠在圆盘上；指针仍单独绘制/旋转。
4. 优点：形状、角度、头部一次到位；不再靠代码拟合。

### 方案 B：在矢量工具里描摹后导出

1. 用 Figma / Inkscape 打开高清参考图，按 44×44 网格描出左右箭头。
2. 只画左侧，右侧用水平镜像复制，确保严格对称。
3. 导出 4× PNG 或清理后的 SVG；记录每个锚点坐标。
4. 不在代码里手调贝塞尔控制点。

### 方案 C：Canvas 椭圆弧重做（兜底）

- 用 `ctx.ellipse(cx, cy, rx, ry, rotation, startAngle, endAngle, anticlockwise)`。
- 左侧箭头单独绘制，右侧整体镜像。
- 箭头头部独立成三角形，不要用 `marker-end` 强行切向；头部应朝下并略向外。
- 当前基线（仅作起点，尚未验收）：
  - 圆盘：44×44，外圆 r=21 `#252220`，内盘 r=17 `#2d2926`。
  - 指针：红尖 `(22, 9.2)`，分界 `y=24.8`，白尖 `(22, 34.8)`，底宽 `16.8…27.2`。
  - 左箭头：椭圆中心 `(18.7, 25.5)`，`rx=11.8`、`ry=9.2`，从 `245.8°` 扫到 `138.6°`；头部尖 `(5.2, 36.2)`，底边 `(3.4, 31.3)–(10.5, 31.7)`。
  - 右箭头：以 `x=22` 镜像。
- 这些数值仍未达到目标，必须配合参考图做像素叠加校验，不能直接恢复。

## 代码位置

- `frontend/components/room-organizer/panels/scendance-workspace.tsx`
  - `SHOW_COMPASS_TURN_ARROWS`：当前 `false`。
  - `CompassDial`：Canvas 圆盘/指针/箭头绘制。
  - 罗盘按钮 JSX：左右箭头按钮仍保留在开关后面。
  - `finishCompassDrag`：当前点击统一回正北。
- `frontend/app/globals.css`
  - `.oc-gm-compass-wrap`
  - `button.oc-gm-turn.is-left/is-right`
- 相关测试：
  - `frontend/components/room-organizer/panels/scendance-workspace.react.test.tsx`
  - `frontend/components/room-organizer/components/outdoor-plan-overlay.merge.react.test.tsx`

## 恢复箭头时必须同步完成

- 将 `SHOW_COMPASS_TURN_ARROWS` 改回 `true`。
- 恢复左右按钮的 `onClick` 逻辑（各转 90°），并保证指针转向与相机方位一致。
- 恢复罗盘提示文案中的「两侧箭头各转 90°」。
- 指针旋转中心必须始终为 `(22,22)`；针尖上下等距，分界可略低于圆心。
- 左右箭头按钮点击区不能覆盖指针中心，不能抢走拖动事件。

## 验收标准

1. 在 44px 实际尺寸和 4×/8× 放大截图中，与目标图并排对比，轮廓、起笔、鼓出位置、箭头头部角度一致。
2. 左、右箭头严格镜像；不出现一高一低、一胖一瘦。
3. 指针在 0°/90°/180°/270° 四个方位都居中，没有偏心或“甩出去”的感觉。
4. 箭头不贴外缘、不穿过指针；头部方向明确朝下并略向外。
5. 拖动、点击回正北、左右 90° 按钮均可用，控制台无错误。
6. `npx tsc --noEmit` 通过；目标测试文件全部通过。
7. 至少在 1440px 桌面和 390px 手机截图验收。

## 验证命令

```powershell
cd C:\幕景\Scendance2026\frontend
npx tsc --noEmit
$env:NODE_OPTIONS='--no-experimental-webstorage'
npx vitest run components/room-organizer/components/outdoor-plan-overlay.merge.react.test.tsx components/room-organizer/panels/scendance-workspace.react.test.tsx
```

## 交接清单

- [ ] 将对话中的目标图和失败图保存到 `docs/assets/compass/`。
- [ ] 优先确认能否取得 Google 原始资产；能取得就采用方案 A。
- [ ] 若描摹，按 44×44 网格记录锚点，右侧镜像。
- [ ] 先在开关关闭状态下替换实现，截图对比通过后再打开。
- [ ] 恢复按钮后跑类型检查、目标测试和桌面/手机截图。
- [ ] 经用户确认后，再删除 `SHOW_COMPASS_TURN_ARROWS` 开关和旧绘制代码。
