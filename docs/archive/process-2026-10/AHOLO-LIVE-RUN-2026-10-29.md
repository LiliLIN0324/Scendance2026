# Aholo 三项能力真机实测（2026-10-29）

> 仓：`C:\Users\13266\.dsh\bot\workspace\Scendance2026`
> 页面：`http://localhost:3000/editor` → 左轨「Aholo 接口测试」
> 代理：`node tools/aholo/lux3d-dev-proxy.mjs`（127.0.0.1:3199，密钥取仓库根 `.env.local`）
> 时区：Asia/Shanghai (UTC+8)。全程**未打印密钥**、**未 commit / push / 发布**。
> 本轮按用户授权实跑扣额度任务（「不要在意任务消耗」）。

## 总览

| 项 | 结果 |
|---|---|
| 文字建模 Lux3D text→3D | **PASS** — task `4475964`，产物 GLB + 6 张 PBR 已落地核验 |
| 图片建模 Lux3D image→3D | **PASS** — task `4476040`，产物 GLB + 6 张 PBR 已落地核验 |
| 场景生成 World 3DGS | **PASS** — worldId `3FO4K4RHLLV9`，全景图 + PLY/SPZ/LOD 元数据已落地核验，见 §1.3 |
| 历史记录按钮 | **PASS** — 真机验证：刷新保留、会话记录被清空后仅凭历史回查到产物、59 前端用例 |
| 界面上不再出现任务号 | **已改** — 按她「看任务号很蠢」的意见：历史行只读描述+状态+时间，手动输 ID 的入口删除，见 §4 |
| 上游契约缺陷（数字任务号被丢） | **已修 + 已回归** — 见 §3，本轮前已造成 2 次扣费任务丢失 |
| 新标签页丢任务 → 重复扣费 | **本轮实跑踩中并已补提示** — 见 §1.4 / §4 |
| 代理测试 | **PASS** — 189/189 |

## 1. 真实提交（计划内 3 次 + 踩中 1 次）

提交入口全部是她页面上的面板按钮（非脚本旁路），共扣 4 次额度：`4475964` / `4476040` / `3FO4K4RHLLV9` 为计划内三项，`4476239` 是 §1.4 那条流程缺陷诱导的重复提交。完成时刻用 20 秒间隔的只读轮询观测，故给区间。

### 1.1 文字建模 `4475964` — PASS

| 项 | 值 |
|---|---|
| 描述 | 一张中式躺椅 |
| 提交 | 20:04:32 |
| 状态推进 | 排队中/运行中 → 20:08:49 仍运行 → 20:09:12 已观测到成功 |
| 耗时 | ≈ 4 分 40 秒（±20 秒观测粒度） |
| 产物 | `result.zip`（COS 签名，2 小时过期）+ `textured.glb` 直链 |
| 落地核验 | `docs/evidence/aholo/4475964/unpacked/MODEL.glb` **1,051,484 B**，magic `glTF`，glbVersion **2**；几何 **29,800 三角面** / 1 mesh / 1 PBR 材质（与请求的 `faceCount: 30000` 对齐），generator `pygltflib@v1.16.5` |
| 贴图 | RawDiffuse 2,435,338 / RawFresnelIor 318,865 / RawReflect 857,300 / RawReflectGloss 661,942 / RawRefract 166,105 / RawRefractGloss 806,857 B |

### 1.2 图片建模 `4476040` — PASS

| 项 | 值 |
|---|---|
| 输入图 | 物料库单件参考图（木餐椅，512×512）转 PNG 后由页面「参考图片」上传；**未使用品牌资产、未使用个人照片** |
| 提交 | 20:07:35 |
| 状态推进 | 20:12:03 仍运行 → 20:12:26 已观测到成功 |
| 耗时 | ≈ 4 分 51 秒（±20 秒） |
| 落地核验 | `docs/evidence/aholo/4476040/unpacked/MODEL.glb` **932,516 B**，magic `glTF`，glbVersion **2**；几何 **29,548 三角面** / 1 mesh / 1 PBR 材质 |
| 贴图 | 同上 6 张 PBR（1,667,385 / 277,806 / 645,354 / 278,990 / 160,015 / 683,118 B） |

页面侧同时确认：上传后即时缩略图预览、提交后输入区禁用、完成后出「ZIP / GLB 模型」两条 https 链接。

### 1.3 场景生成 `3FO4K4RHLLV9` — PASS

| 项 | 值 |
|---|---|
| 名称 / 描述 | Scendance 场景测试 / 小型发布会场地，中央舞台，观众座椅环形排布，暖色灯光，木质地板 |
| 提交 | 20:06:38 |
| 状态推进 | `PREPROCESSING`（20:06:44）→ `RUNNING`，`progress` 长时间恒为 **0**（至 20:16 仍为 0，`panoUrl` 与 splat 产物均空）→ 20:23:27 产物已开始出现但状态仍 `RUNNING` → **20:23:41 页面轮询观测到成功** |
| 耗时 | ≈ 17 分（20:06:38 → 20:23:41），约为 Lux3D 的 3.6 倍 |
| 落地核验 | `docs/evidence/aholo/world-3FO4K4RHLLV9/` 四个文件全部有效：<br>`world.ply` **19,853,424 B**，头部 `ply format binary_little_endian`；<br>`world.spz` **4,837,840 B**，magic `1f8b`（gzip，SPZ 即压缩 splat）；<br>`panorama.jpg` **1,134,364 B**，magic `ffd8ff`，DOM 实测宽 **4096 px**；<br>`lod-meta.json` 1,025 B：`type: lod-splat`、`version 1.0`、`counts 291,956` 个 splat、`shDegree 0`、`levels 5`、`forwardBox` 约 2.9 × 10.9 × 3.6 m |
| 页面侧 | 成功态出「打开全景原图」+ PLY 场景 / SPZ 场景 / LOD 元数据三条 https 链接，并固定一行说明「暂不支持场景漫游或编辑」；进度条终态 100% |

World 的 `progress` 字段在 17 分钟里几乎全程返回 0，面板因此画了一根停在 0% 的实心进度条 —— 这是真实值不是假造，但观感上「像卡死」。见 §5.2。

### 1.4 第四次提交 `4476239` — 本轮实跑踩中的重复扣费（已补提示）

| 项 | 值 |
|---|---|
| 描述 | 一张中式躺椅（与 §1.1 同一句） |
| 提交 | 20:18:49 |
| 结果 | 成功，产物 `result.zip` + `textured.glb`，与 `4475964` 同类 |
| 是否本意 | **否**。她已授权「不要在意任务消耗」，但这一条不是计划内的第三次，是流程缺陷诱导出来的额外扣费 |
| 成因 | 任务号存在 **sessionStorage**（标签级），历史记录存在 **localStorage**（浏览器级）。换到新标签页 / 会话被清后重开页面 → `sessionStorage` 空 → 面板回到全新空态，既不提示「上一个任务还在跑」，生成钮又可用 → 再点一次即再扣一次。代理侧无任务列表接口（§2），页面上唯一的线索就是历史按钮里的 4 条记录 |
| 本轮处理 | 面板在生成钮下方加一条提示：本机存在未确认完成的同类任务时，先写明那条记录的最后更新时间 + 「再点生成会另起一个任务、再扣一次额度；先在历史记录里查看它的结果」。跟踪到任务或历史全为终态时提示自动消失 |
| 渲染验证 | 无头 Chrome 里放一条「文字建模 · 运行中」的历史记录并打开面板，实文：`本机还有一个未确认完成的文字建模（2026-10-29 20:21:25），再点生成会另起一个任务、再扣一次额度；先在历史记录里查看它的结果。`，整块面板文本内检索四个真实任务号 → 0 命中。她页面上那四条记录现已全部为终态，所以这条提示在现页面不再出现（属预期） |
| 未做的事 | **没有**把「有未确认任务」做成硬拦截。她明确说过不在意消耗，且上游无列表接口，历史行的状态只有在本页轮询过时才准 —— 拦截会因一条永远停在「运行中」的旧记录把她锁死在面板外。改成提示而非禁钮是有意的取舍 |

## 2. 接口契约实测（与代理实现一致）

| 环节 | 实测 |
|---|---|
| Lux3D 网关 | `https://api.aholo.ai/global`，鉴权头 `Authorization: <裸 key>`（**不是** Bearer） |
| 信封 | `{ c: '0', d: ... }`；`c !== '0'` 即失败，数据只在 `d` |
| 建任务 | `POST /lux3d/v1/generate/{text\|img}-to-3d/task/create`；body：`prompt`（或 `img` dataURL）+ `style: photorealistic` + `faceCount: 30000` + `outputFormat: ['zip','glb']` + `version: 'G1'` |
| 建任务返回 | `d` = **数字**任务号（实测 4475964 / 4476040） |
| 查任务 | `GET /lux3d/v1/generate/task/get?taskid=`；`status` 为数字，产物在输出 URL 数组 |
| World 建任务 | `POST https://api.aholo3d.cn/world/v1/generations`，body `name + prompt` → `worldId` 为**字母数字字符串** |
| World 查任务 | `GET https://api.aholo3d.cn/world/v1/{worldId}`；`status` 为**字符串**（`PREPROCESSING`/`RUNNING`/…），另有 `progress`（0–1 小数）、`assets.splats.urls.{plyPath,spzPath,lodMetaPath}`、`assets.imagery.panoUrl`、`semanticsMetadata.upAxis: 'Z'` |
| 状态语义 | 0 排队 / 1 运行 / 3 成功 / 4 失败 / 6 已取消 |
| 任务列表 | **无此接口** —— 任务号一旦丢了就找不回来（§3 的代价来源，也是历史记录按钮的存在理由） |
| 任务号对用户不可见 | `https://labs.aholo3d.cn/usage` 只列消耗，不列任务号（她本人核对）。所以任务号是**我们内部的凭据**，不该出现在她的界面上：本轮把它从面板与历史列表里全部去掉，只留「描述 + 状态 + 时间」，找回一律走「查看」按钮（§4） |
| 产物有效期 | COS 签名 URL 约 2 小时过期，故任何持久化都只能存任务号（作为内部凭据，不在界面显示），不能存链接 |

## 3. 本轮修掉的真实缺陷：扣了额度、任务号却被丢掉

- **现象**：页面点「直连生成」后，代理返回 `502 Aholo 返回的任务号无效`；Aholo 侧任务其实已创建并计费。
- **根因**：`tools/aholo/lux3d-dev-proxy.mjs` 的 `validId()` 只接受字符串，而 Lux3D 创建接口返回的 `d` 是**数字**，于是把合法任务号判成非法并丢弃。
- **代价**：扣费提交只留下 `pending` 记录、没有任务号，而上游无列表接口可回查。本轮 20:01:04 这次是修复前直接复现（面板报 502）；另有一条 18:58:24 的历史 `pending` 记录同样停在无任务号状态，症状一致但未经当时的日志证实。
- **修复**：只在 Lux 创建返回处做 `Number.isSafeInteger && >0 → String(...)` 转换；World 的字符串 `worldId` 契约与 `queryId` 校验保持不动（先前的全局放宽会破坏 `{"worldId":123}` 应判 502 的既有用例）。
- **回归**：`node --test tools/aholo/*.test.mjs` → **189 通过 / 0 失败**，含新增「数字任务号转字符串」与 9 个不可用值（`0 / -n / 1.5 / 2^53 / 空串 / 含空格 / 129 字符 / null / undefined`）判 502 的用例。
- **修复后首次真跑**即拿到 `4475964`，也就是 §1.1。

## 4. 历史记录按钮（本轮新增，并按她的意见去掉了任务号）

她的原话：「能不能跳过任务号。直接看记录？这个看任务号很蠢」。本轮据此把任务号从界面上全部移除：列表每行只读「能力 + 描述 + 状态 · 时间」，找回靠「查看」按钮，不再要求她复制粘贴任何 ID。

位置：面板抬头右侧，`历史记录（N）` ⇄ `收起历史`（原地折叠，故用「收起」并带 `aria-expanded` + `aria-controls`）。

| 行为 | 实测 |
|---|---|
| 记什么 | `kind / taskid / prompt / startedAt / status / label / at`，上限 30 条，按 `kind+taskid` 去重后最新在前。taskid 只作为内部凭据与去重键，**不渲染** |
| 不记什么 | 图片 base64、签名产物链接 —— 有专项断言禁止落盘 |
| 何时写 | 建任务成功即写「已提交」，之后每次轮询刷新状态（不追加新行） |
| 真机验证 | 四次提交后列表实时刷新；**F5 后记录仍在**；文字/图片行状态自动变成「生成完成」。现页面四条记录渲染文本逐行核对：`图片建模 / aholo-test-chair.png / 生成完成 · 2026-10-29 20:45:59 / 查看` 等，四个任务号在整块面板检索 **0 命中** |
| 会话丢失后的找回 | 本轮真实发生：页面换到新标签页后 `sessionStorage` 清空 → 面板空态 → 点历史里的「查看」→ **只发 GET** 接管 worldId `3FO4K4RHLLV9` → 直接显示全景图（`naturalWidth` 4096）+ PLY / SPZ / LOD 三条链接。这条路径是本轮唯一把已付费 World 产物找回来的入口 |
| 查看 | 切到对应 tab 并**只发 GET** 接管该任务。实测：删掉图片面板的 sessionStorage 任务记录 → 刷新 → 点历史里的「查看」→ 直接显示 ZIP/GLB；刷新后页面的代理请求路径只有 `/health`、`/task`、`/world`，**没有 `/image-to-3d` 创建请求**，即没有二次扣费 |
| 手动输 ID 入口 | **已删除**（原「查询已有任务（不扣生成额度）」折叠区 + `recover()`）。理由：上游既不列任务号、她的用量页也看不到任务号，这个输入框等于要求她抄一个界面上不再显示的东西；历史按钮已覆盖同一用途且只发 GET |
| 描述被刷空 | 本轮修掉：轮询回来的记录用当时输入框的描述覆盖，图片 tab 提交后清空输入框 → 再轮询就把该行描述写成空串、退化成「（无描述）」。`appendHistory` 改为同 `kind+taskid` 的旧描述非空而新的为空时保留旧值，配 1 条回归用例。她页面上 `4476239` 那条是在修复前被刷空的，仍显示「（无描述）」，属存量数据 |
| 清空 | 删 key 并收起；正在跟踪的任务不受影响，下一轮轮询会把它重新记回列表 |
| 未确认完成提示 | 本轮新增（§1.4）：同类任务存在非终态历史行且当前面板未跟踪任务时，生成钮下方给一条 `sc-warning`；跟踪到任务或全部终态即消失 |
| 完成后的计时 | 本轮修掉：任务已终态仍显示「已等 2302s」是噪声，`已等 N 秒` 只在未终态时渲染（生成中仍逐秒走，用例分别断言两态） |
| 视觉自查 | 无头 Chrome 1440×900 @2x，塞 4 条合成记录（含 24 字长描述、空描述、运行中）后截图核对：描述换行不裁切（`scrollWidth` 未超容器）、「查看」右对齐不被挤掉、说明行移出滚动区不再被 `max-height` 截成半句、页面横向滚动宽 1440 无溢出 |
| 用例 | `lux3d-direct-test.react.test.tsx` **59 通过**（含 10 条历史专项：默认收起、创建即记、轮询更新不追加、三能力顺序、30 条封顶丢最旧、脏数据过滤、GET-only 接管、清空后回补、非终态提示、终态不提示；另有「面板任何位置不出现任务号」「空描述保留原描述」两条） |

## 5. 能力边界与体验结论

1. **Lux3D 不给百分比**。面板如实写「Aholo 未提供百分比进度」，只给「已等 N 秒」+ 每 5 秒一次查询。约 4.7 分钟的等待期里这是唯一进度来源。
2. **World 慢且进度几乎不动**：17 分钟里 `progress` 全程 0，直到产物 URL 出现才跳到 1（实测 20:23:27 已有 PLY/SPZ 链接而状态仍 `RUNNING`，20:23:41 才报成功）。当前 0% 实心条读起来像死掉。建议 World 改用不确定态（或阶段文案 + 已等时长），别画停在 0 的实心条。
3. **产物链接 2 小时过期** → 任何「把模型存进方案」的路径都必须先下载或转存，不能存 URL。历史记录只存描述与状态（任务号仅作内部凭据）正是为此。
4. **切 tab 不打断任务**：面板首次访问后保持挂载、用 `hidden` 切换，后台任务继续轮询（实测三条记录在图片 tab 下同时刷新，World 行一路更新到 20:23:41 的成功）。未访问过的 tab 不挂载，也就不做恢复 —— 点该 tab 或点历史「查看」才接管。
5. **重复扣费保护只在同一标签页内有效**：提交后状态未知时按钮转「等待确认原任务」，不会重发；但换标签页 / 会话被清就失效（§1.4 已实测踩中并补提示）。
6. **任务号的持久化层级选错了**：任务号在 `sessionStorage`（标签级），历史在 `localStorage`（浏览器级）。上游没有列表接口，所以只要换标签页就没有自动找回；根治要么把在跑的任务号也写一份到 `localStorage`，要么代理侧落一条 taskid 日志（§6 待点名）。本轮先加提示，未改存储层级。
7. **未证实的能力没有接**：World 的图像生成没有可核验证据，面板里不存在该入口；World 成功态给的是全景图 + PLY/SPZ 文件，不是假装的可行走场景。
8. **3DGS 在编辑器里的真实渲染仍未接**（M3 前端 loader 缺失，见 `AHOLO-SMOKE-2026-10-28.md`）。本轮只证明「接口能拿到产物」，不证明「编辑器能显示产物」。`lod-meta.json` 里的 `counts / shDegree / levels / forwardBox` 就是将来接 loader 时要读的字段。

## 6. 遗留与未做

- **全量前端测试有 2 条既有失败，与本轮无关**（`npx vitest run` → 3757 通过 / 2 失败）：
  - `lib/project-review.test.ts > 30-person rehearsal review example > matches an actual offline HTML generated from the existing backup…`（评审包离线 HTML 与金样不一致）
  - `components/room-organizer/three/scene-presets.test.ts > editable scene archives > opens every gym fixture at its archived position and persists edits`（仅 gym 模板，其余 9 个模板通过）
  - 两条都是快照/存档位置比对，所测模块不引用 Aholo 面板、代理或 `globals.css` 的历史记录规则，故判为工作树里既有的偏差（含此前 Grok 改动），**本轮未动、未修**。
- `tools/aholo/world-mvp.mjs` 仍按 `output.splat` 取产物，与实测的 `assets.splats.urls` 不一致 —— 不在本轮范围（属 #66 那条 Lux3D 产物接入门禁）。
- `tools/aholo/world-dl.mjs` 是上一轮的一次性下载脚本，里面硬编码了已过期的签名 URL。
- 代理目前不记任务日志（扣费任务号只在浏览器本地）。是否在代理侧加一行「创建成功即落盘 taskid」的日志，能彻底避免 §3 与 §1.4 那两类丢失 —— 等她点名；同理「在跑的任务号是否也写一份 `localStorage`」等她点名，本轮只加了提示。
- 图片建模的参考图用的是物料库单件图；换真实客户物件照片的效果未测。
- `4476239`（§1.4 那条重复提交）的产物未下载取证，只做了只读回查确认成功；已多扣的这一次额度不退。
- 全部改动**未提交**（`git status`）：
  - 改：`frontend/app/globals.css`、`frontend/components/room-organizer/room-organizer.tsx`（左轨入口）
  - 新：`frontend/components/room-organizer/panels/lux3d-direct-test.tsx` 与其 `.test.tsx`、`tools/aholo/lux3d-dev-proxy.mjs` 与其 `.test.mjs`
  - 证据：`docs/evidence/aholo/{4475964,4476040,world-3FO4K4RHLLV9}/`（该目录整体在 `.gitignore` 内，只 `report.json` / 全景图一类可入库；World 的 `report.json` 已写好，产物 URL 去掉了签名查询串）

## 7. 复现命令

```text
# 页面
cd frontend && npx next dev            # http://localhost:3000/editor
node tools/aholo/lux3d-dev-proxy.mjs   # 127.0.0.1:3199

# 只读回查（不扣额度）
node tools/aholo/lux3d-mvp.mjs query 4475964
node tools/aholo/lux3d-mvp.mjs query 4476040
curl "http://127.0.0.1:3199/world?worldId=3FO4K4RHLLV9"     # 返回 status/statusLabel/progress/outputs/panoUrl

# 门禁
node --test tools/aholo/*.test.mjs                                  # 189 pass
npx vitest run components/room-organizer/panels/lux3d-direct-test.react.test.tsx   # 59 pass
npx tsc --noEmit && npx eslint components/room-organizer/panels/lux3d-direct-test.tsx   # 无输出
```
