# 零照片链路 · 产品化文案与口径（2026-11-19）

> 这份文档只讲两件事：**这套链路该怎么对用户说**，以及**哪些话不能说**。
> 不改任何前端/后端代码，不动 git。
>
> **口径分层**（本文每条结论都按这三层标注）：
> - **代码事实** —— 有文件:行号可查，本文逐条给出。
> - **实测事实** —— 本轮或近期在生产环境真跑出来的读数，标注样本量。
> - **建议** —— 本文作者的产品判断，**不是**已实现的事实。
>
> **基线**：本文基于 `main`（`origin/main` = `b703f746`，本地 HEAD = `81d7824e`）的工作树状态写成。
> 文中所有行号对应**本轮读到的工作树**；`supabase/functions/_shared/providers.ts`、`generation-lane.ts`、
> `supabase/migrations/20261119150000_published_assets.sql` 在本轮未被改动，行号即提交态行号。
>
> **供应商名不出现**：凡是给用户看的话，一律不出现生成服务的供应商品牌与接口名。代码里那些名字是实现细节，
> 不是产品承诺。§5 会逐条列出被禁止的说法。

---

## 0. 先把「零照片」这件事说清楚（这是全文的地基）

**平台已经具备「一句话 → 3D，零照片」能力，普通用户完全不知道。** 证据：

| 环节 | 位置 | 说明 |
| --- | --- | --- |
| 文生 3D 通道 | `supabase/functions/_shared/providers.ts:76` | 请求体 `{prompt, version:'G1', faceCount:30000, outputFormat:['zip','glb']}`，**prompt 真正生效** |
| 图生 3D 通道 | `supabase/functions/_shared/providers.ts:73` | 请求体 `{img, version:'G1', faceCount:30000, outputFormat:['zip','glb']}`，**根本没有 prompt 字段** |
| 选路 | `supabase/functions/_shared/generation-lane.ts:46-48` | 请求显式声明 `provider:'aholo'` 时走该通道，覆盖 `text` 与 `image` 两种 kind |
| worker 投递 | `supabase/functions/_shared/worker.ts:77` | `provider.submit(job.prompt, {imageUrl, sourceUrl})` —— 有图走图生端点，无图走文生端点 |
| 前端入参 | `frontend/lib/backend-session.ts:2017-2018` | `createGenerationJob(prompt, requestId, {kind, provider})`，`kind:'text'` 不需要任何图片 |
| 户外原位生成入口 | `frontend/components/room-organizer/components/outdoor-facility-generate.tsx:137-149` | 设施行 → 原位生成 → `provider:'aholo'`（:139）→ `kind:'text'`（:149）→ 生成件绑定回该设施 |
| 创作面板文生入口 | `frontend/components/room-organizer/panels/creation-entry.tsx:270-281` | 文生模式只有一个描述框，无任何图片输入 |

**两条通道的能力差异是产品级事实，不是实现细节**：

> 在**图生**通道里，用户填的「补充描述」**不会被发给生成服务**（`providers.ts:73` 的请求体里没有 prompt），
> 因此**在图生模式下改提示词对生成结果没有任何影响**。
> 在**文生**通道里，描述是唯一输入，**真正生效**（`providers.ts:76`）。
>
> 公开接口的参数表也印证这一点（`docs/39-Aholo能力与用途评估-20261108.md:179-180`）：
> `text-to-3d` 的参数含 `prompt` / `style`；`img-to-3d` 的参数只有 `img | imgs[]` / `version` / `faceCount` / `outputFormat`。
>
> **产品后果**：图生模式界面上那个「补充描述」框（`frontend/components/room-organizer/panels/generation-sheet.tsx:498-501`）
> 现在会让用户误以为「是我描述写得不对」。这条列为 §4 的 B6。

**本轮实测（样本量必须写清）**：

| 项 | 读数 | 证据级别 |
| --- | --- | --- |
| 文生 3D 成功 1 次 | 签到台；描述写「长约 1.8 米、宽 60 厘米、高 75 厘米」；产物实测 **1.8 × 1.147 × 0.924 m** | 实测，**样本量 1**；该条来自本轮口述交接，仓库内尚未落台账 |
| 图生 3D 失败 2 次 | 供应商只回 `status:4`，**零原因字段**：`{"f":null,"c":"0","m":"","d":{"bizId":"LUX_3D","status":4,"taskId":8416344}}` | 实测；同型已出现 3 次（`docs/plans/2026-11-19-contest-wedding-next-plan.md:908-915`） |
| 图生 3D 成功一批 | 「干净单主体 + 纯白背景」参考图 **6/6 成功** | 实测（`docs/plans/2026-11-19-contest-wedding-next-plan.md:474-486`） |
| 计费 | 文生与图生同为 **20 credits/件**；多模态生图（做参考图）**12 credits/张**；**失败件 `consumedCredits=0`** | `docs/39:205`、plan `:672-682` |
| 端到端耗时 | **5.8–7.1 分钟** | 实测（plan `:512`） |
| 公共物料库 | 36 件 ready 的 GLB 全部已公开；`GET /assets` 返回带 **1 小时**签名预览地址 | 实测（plan `:779-789`、`:902-905`） |

---

## 1. 面向用户的文案稿

### 1.1 户外工作区「不用拍照也能生成」

**落点**：户外工作区左栏户外流程卡的顶部（`frontend/components/room-organizer/components/outdoor-workflow-card.tsx`，
`ap-card-head` 之后、`ap-task-caption` 那一行）；CTA 按钮在同文件 `:739-741`（现文案「准备原位生成（另行确认费用）」）。

| 位置 | 首选 | 备选 |
| --- | --- | --- |
| **主标题** | **不用拍照，也能把物料做出来** | 没照片，先用一句话开工 |
| **副文案** | **选中草坪上的一个设施，写一句话描述它，我们生成 3D 模型后放回这个位置。** | 不用等拍摄。写一句话，3D 模型生成好会回到这个设施上。 |
| **CTA** | **用一句话生成这个设施** | 不拍照，直接生成 |

**CTA 按钮的完整写法**（保留既有费用口径，不要把「另行确认费用」删掉）：

> `用一句话生成这个设施（另行确认费用）`

**写法理由**：

- 主标题落在「不用拍照」这个**用户已有的心理负担**上（普通用户以为必须有照片才能开始），
  不落在「AI」「智能」这类空词上。
- 副文案只承诺**三件确实会发生的事**：选设施、写描述、模型回到这个位置。
  **不承诺即时、不承诺准确、不承诺尺寸对**（实测 5.8–7.1 分钟，尺寸实测只有 1 个轴对上）。
- CTA 用「这个设施」而不是「生成」：户外场景里生成物的**归属位置**是最关键的信息，
  「生成」听起来像生成整个场地，容易被理解成「一键生成场地」。
- 「另行确认费用」必须留着：平台所有生成入口都是**勾选额度才提交**
  （`outdoor-facility-generate.tsx:189` 的 `确认扣额度后才会提交`）。

**同源改法**（避免两处各写一套）：创作面板文生模式的引导句现在是
「描述一件要放进场地的物件。」（`frontend/components/room-organizer/panels/creation-entry.tsx:237`），
建议与户外副文案同源；若只改一处，先改户外（缺口更大）。

### 1.2 Agent 面板「用一句话描述物件」提示词模板

**先说一个硬约束**（这条决定模板放在哪、怎么措辞）：

> `frontend/components/room-organizer/panels/agent-panel.tsx:21` 明写：
> 「物件与场景生成不在这里：物料生成属于物料对话，场景属于空间栏，Bingo 只谈布置与方案。」

所以 Agent 面板**不能**变成「让助手直接给你生成物料」的入口。正确形态是**引导句**：
Agent 面板给一句可点击的话，点一下把人带到真正能生成的地方（创作面板的文生 3D / 户外设施的原位生成）。

**模板本体（3 条，婚礼/活动场景）** —— 统一句式：**是什么 + 什么配色材质 + 多大 + 干什么用**：

| # | 模板文案 | 为什么这么写 |
| --- | --- | --- |
| 1 | **一张白绿配色的婚礼签到台，长约 1.8 米、宽 60 厘米、高 75 厘米，台面铺米色桌布** | 直接对应本轮唯一一次文生成功（签到台）；尺寸写进去，让模型至少有比例概念 |
| 2 | **一座金色圆弧花艺拱门，高 2.4 米、宽 1.8 米，缠满白玫瑰与绿叶，用在迎宾入口** | 「用在迎宾入口」给模型用途线索；婚礼核心品类 |
| 3 | **一组户外甜品台摆件：白瓷三层点心架配浅粉花艺，桌高约 80 厘米，放在茶歇区** | 复合摆件类；「桌高约 80 厘米」把真实约束交给人，不指望模型算 |

**落点（三处，优先级从高到低）**：

1. **创作面板文生 3D 的描述框下方**（`frontend/components/room-organizer/panels/creation-entry.tsx:270-281`，
   现在只有一个 placeholder「一句话描述物件，如：一把户外折叠椅」（:277））——
   把 3 条做成可点示例，点一下填进描述框。**这是最重要的一处**：真正能生成的地方。
2. **户外设施的原位生成表单**（`frontend/components/room-organizer/components/outdoor-facility-generate.tsx:187`
   的描述框，输入框初值现在是设施名 `:60`）——按设施名给最贴切的那一条模板。
3. **Agent 面板**（`frontend/components/room-organizer/panels/agent-panel.tsx:4028` 挂载的
   `frontend/components/agent-task-examples.tsx`）——**只放引导句，不放生成承诺**：
   > 「要一件没准备照片的物料？去户外设施里点「用一句话生成」，写一句描述就行。」

**不要**在 Agent 面板写「帮我生成一张签到台」这类句子模板 —— 那是让用户提一个平台当前接不住的请求。

### 1.3 「生成结果要不要进公共物料库」的产品化口径

#### 推荐：**默认公开（提交前可见、可一键退订）** —— 附一条硬前置

**硬前置（P0，不做完就不成立）**：

> 公开目录的条目**不得携带用户原话**。
> 现状：`supabase/migrations/20261119150000_published_assets.sql:64-73` 的 `assets.list` 返回 `a.*`（只去掉 `storage_path`），
> 含 `metadata`；而 `metadata.originalPrompt` = 用户当时的完整描述，由
> `supabase/functions/_shared/worker.ts:114-115` 写入。
> Edge 侧 `supabase/functions/_shared/api.ts:58-67` 的 `assetPreviewView` 只把 `previewPath` 换成签名地址，**不删 `originalPrompt`**。
> 公开后，任何有工作室身份的用户 `GET /assets` 就能读到别人的原话。

**推荐理由**：

1. **和仓库里已有的用户口径一致**：2026-11-19 用户明确「我的生成都放到平台上，让更多普通用户都能看到」
   （plan `:695`）。默认私有会让每件物料都要多点一次，公共目录起不来。
2. **公开成本不对称**：撤下是**既成能力**且即时生效（`api.ts:731-736` 的 `POST/DELETE /assets/{id}/publish`；
   迁移 `:46-63` 只允许物主操作、只允许 `format='glb'`），所以「先公开、后撤下」的代价远小于「先私有、永远没人公开」。
3. **默认私有会让「物料库」变成只有管理员能用的功能**，与「让普通用户都能看到」的目标相反。

**但默认公开必须配三道闸**：

| 闸 | 内容 | 落点（文件 / 函数，不写代码） |
| --- | --- | --- |
| ① 事前可见 | 提交表单上，额度勾选旁边并列一个**默认勾上**的「放进公共物料库，任何注册用户可见可取用」勾选项，旁边一行小字说明它默认是开的 | 创作面板：`frontend/components/room-organizer/panels/creation-entry.tsx`（`CreationEntry` 第二张「生成 3D 模型」卡，`gs-create-credit` 那一行，:293-296）；物料/设施来路：`frontend/components/room-organizer/panels/generation-sheet.tsx`（`submitFromCard` :362-366 与 `submitModel` :207 之后的提交路径） |
| ② 事后一键 | 生成完成的任务卡上直接给「放进公共物料库」按钮，不必回物料库面板找 | `frontend/components/room-organizer/panels/generated-model-library.tsx`（任务卡，`ready` 态分支，参照 `:301-302` 的「加入场地预览」按钮位置） |
| ③ 原话不外泄 | 公开条目不带用户原话（见上面的硬前置） | 服务端：`supabase/migrations/<新迁移>.sql` 的 `scene_rpc('assets.list')` 返回体 + `supabase/functions/_shared/api.ts` 的 `assetPreviewView` |

**单一真源**：`默认公开` 这条规则只能有一处定义。建议放在 `frontend/lib/assets-api.ts`
（`GENERATION_BUSY_NOTICE` 已在 `:84`，该文件注释已写明「统一生成面板与物料库面板都读这一句，别各写各的」）。

**若 ③ 不做**：退到**默认私有**。理由只有一条 —— 会把用户原话暴露给其他注册用户。
这个备选不是「更保守所以更好」，是「在原话泄露修掉之前默认公开不成立」。

**注意**：默认公开的开关如果要做到「提交即公开」，需要把公开意图传到 worker 落库那一刻
（`supabase/functions/_shared/worker.ts:125-131` 的 `assetRecord` 之后写 `published_assets`），
**这要改 Edge Function 契约与迁移，按 AGENTS.md 第七条需要人 review**；
如果本轮不想动契约，退一步的做法是**只在客户端做「提交后自动调一次 publish」**，
不改后端契约，但服务端要有幂等保护（`assets.publish` 已是 `on conflict do update`，迁移 `:55-57`，重复调用安全）。

### 1.4 两条通道对用户怎么说（产品语言）

**统一前提**：两条通道的对外名称里**不出现供应商品牌与接口名**。
代码里的 `engineLabel`（`frontend/components/room-organizer/lib/model-generation.ts:21-23`）返回的是 `'Aholo Lux3D'` / `'HY-3D'`，
这两个字符串是给排障看的，**不能出现在用户界面**。对用户只说「3D 生成服务」。

#### 通道一：描述生成（文生 3D）

- **对用户叫**：**描述生成**（现有界面按钮是「文生 3D」，建议在户外工作区改成「描述生成」，创作面板可保留原名）
- **说什么**：
  > 「写一句描述，我们按这句话做出一件 3D 物件。描述里写清楚：是什么物件、什么颜色材质、多大、给谁用。」
- **用户能控制什么**：**形状与品类**（颜色/材质会跟随描述，但不稳定）。
- **用户控制不了什么**：**绝对尺寸**（见 §2 与 §5）。
- **成功口径**：本轮实测 1 次成功（签到台），**样本量 1**；实测耗时 5.8–7.1 分钟。
- **失败口径**：「这次没做出来，换个说法再来一次。」——**不能说**「供应商拒绝了」这种内部归因（生成失败原因字段是空的，见 §5）。

#### 通道二：参考图生成（图生 3D）

- **对用户叫**：**参考图生成**
- **说什么**：
  > 「上传一张参考图，我们照着它做出一件 3D 物件。参考图要**主体单一、背景干净**。」
- **用户能控制什么**：**外观与配色**（形状由参考图决定）。
- **用户控制不了什么**：
  1. **描述无效** —— 图生通道不把描述发给生成服务（`providers.ts:73`）。
     所以界面上那行「补充描述」（`generation-sheet.tsx:498-501`）要么删掉，
     要么改成「给这件模型起个名字（不影响生成结果）」。
  2. **尺寸** —— 同通道一。
- **参考图的硬要求**（这段是本轮最贵的经验，必须写进界面）：
  - 只收 PNG / JPEG，单边 128–4096 px，≤ 5 MB
    （`supabase/functions/_shared/generation-input.ts:11-13`：格式与归属校验在 :12，体积与边长校验在 :13；
    已在 `docs/plans/2026-11-19-contest-wedding-next-plan.md:636-641` 记录）。
  - **单主体 + 干净背景**。失败与成功的差别不在链路、账号、额度，而在参考图形态：
    带水印的复杂场景裁片 1 分钟内被判失败（`PROVIDER_FAILED`）；
    同一套链路换成「干净单主体 + 纯白背景」后 **6/6 成功**（plan `:456-457`、`:474-486`）。
  - 41 张小红书参考照实测 **0 / 41** 可直接喂模型（plan `:545-546`）——所以推荐路径是
    **「用文字生成白底单主体图 → 再图生 3D」**，而不是「拿照片直接喂」。
- **失败口径**：「这次没做出来，换一张参考图再来。」——**不能说**「生成服务没做完，再生成一次试试」
  （这句是 `frontend/components/room-organizer/lib/generation-failure.ts:52` 的通用兜底，
  在图生场景里会把用户引向「再试一次同一个坏参考图」，白白消耗一次额度）。

#### 两条通道的对照（可作为界面里的选择器说明）

| | 描述生成 | 参考图生成 |
| --- | --- | --- |
| 需要图片吗 | **不需要** | 需要一张参考图 |
| 描述影响结果吗 | **影响** | **不影响**（描述只用于命名与备注） |
| 形态由谁决定 | 描述 | 参考图 |
| 尺寸可信吗 | 否 | 否 |
| 本轮实测 | 成功 1 次（样本量 1） | 失败 2 次；另一批干净参考图 6/6 成功 |

---

## 2. 零照片链路的能力清单

### 2.1 能做什么

| # | 能力 | 入口 / 证据 |
| --- | --- | --- |
| C1 | **一句话 → 一件 3D 物件，零图片输入** | `creation-entry.tsx:270-281`（创作面板）、`outdoor-facility-generate.tsx:137-149`（户外设施原位） |
| C2 | **生成件绑定回指定设施**（原位生成） | `outdoor-plan-overlay.tsx:594` 的 `openGenerate` → `openGenerationSheet({task:'model',scope:'facility',source:kind})`；候选合并在 `outdoor-plan-overlay.tsx:593` |
| C3 | **点候选即换该设施的 3D 模型与占地** | `frontend/components/room-organizer/hooks/use-outdoor-agent-workflow.ts:2143-2176`（写 `modelOverride` 与 `size:{width,depth}`） |
| C4 | **生成件进物料库，可公开给其他注册用户取用** | 迁移 `20261119150000_published_assets.sql:25-36`（`can_use_asset`）、`:46-63`（`assets.publish`/`unpublish`）、`:64-73`（`assets.list` 含公共目录）；Edge `api.ts:731-736` |
| C5 | **物料库卡面有预览图**（1 小时签名地址） | `api.ts:58-67`（`assetPreviewView`，`backend.sign(previewPath, 3600)`）、`api.ts:711-713`（`GET /assets`）；线上 34/34 覆盖（plan `:779-789`） |
| C6 | **生成件在任务卡里可一键加入场地** | `generated-model-library.tsx:301-302`（「加入场地预览」）、`:155-168`（本面板提交的任务 ready 后自动落画布） |
| C7 | **有参考值尺寸**（包围盒 + 启发式归一化） | `supabase/functions/_shared/assets.ts:71-89`（最长边 ≥20 判厘米）、`models.ts:122-124`（取包围盒） |
| C8 | **失败不自动重派付费请求**（防止重复扣费） | `outdoor-facility-generate.tsx:111-127`（准备新一轮需重新确认额度）、`generation-failure.ts:88-96` |

### 2.2 不能做什么（边界，**这些是硬边界，不是「暂时没做」**）

| # | 边界 | 为什么 | 证据 |
| --- | --- | --- | --- |
| L1 | **不能做真实场地重建** | 零照片链路产出的是**物件**，不是场地。真实场地要靠拍摄/扫描重建链路；单图→3DGS 场景的公开接口实测 **2/2 失败**，且产物是 splat 不是可摆放 GLB | `docs/39:115-116`、`docs/39:20`（「Aholo 对我们是『道具工厂 + 人物动画外包』，不是『场景工厂』」） |
| L2 | **不能出可编辑分件** | 产物是**单网格、单材质** GLB。「纱幔帐篷 + 桌椅」不能一次生成再拆；部件拆分接口实测 **3/3 失败** | `docs/39:60`、`docs/39:98`、`:117-119`、plan `:881` |
| L3 | **尺寸不可信** | 只有包围盒 + 启发式，没有米制真值。实测：餐盘高度差 **33 倍**、刀叉高度差 **3 倍**；本轮文生 1 件，描述写「长 1.8 米、宽 60 厘米、高 75 厘米」，产物 1.8 × 1.147 × 0.924 m —— 三个轴里只有一个数字对得上（**样本量 1，不能当规律**） | `assets.ts:71-89`、`supabase/functions/_shared/scene-resources.ts:16-17`（"Raw GLB bounds are not a statement of real-world dimensions"）、plan `:826-832`、`:879` |
| L4 | **朝向不可控** | 生成服务没有朝向语义，平台只能整体绕 Y 转一个角度，说不了「花艺拱门正面朝主舞台」 | plan `:880` |
| L5 | **不能保证一次成功，失败也没有原因** | 失败只回状态码，没有 reason/failCode/credits/outputs 字段。平台能落库的只有 `error_code=PROVIDER_FAILED` | `providers.ts:83-85`、实测响应原文 plan `:908-915` |
| L6 | **图生通道里描述不生效** | 请求体没有 prompt 字段 | `providers.ts:73` |
| L7 | **不能说「按你给的尺寸做出来的」** | 见 L3；生成件的 `width/depth` 会直接写进户外设施占地（`use-outdoor-agent-workflow.ts:2167`），错的尺寸会直接画进 2D 平面图 | 同 L3 |
| L8 | **生成件是会话级记录** | 模型记录带 `sessionOnly: true`，持久化过滤掉它（`facility-generated-models.ts:85-87`、`:523-527`）；刷新后靠任务身份重新取件，**换设备/换项目不保证自动回填** | `facility-generated-models.ts:523-531`、plan `:883` |
| L9 | **同一时刻每个账号只有 3 个生成槽位** | 第四单会被 `GENERATION_BUSY` 挡住 | `frontend/lib/assets-api.ts:84`、迁移 `20261119130000_per_owner_concurrent_generation.sql` |
| L10 | **不能承诺「免费」或「失败必退」** | 生成服务侧失败件 `consumedCredits=0`（`docs/39:205`），但平台自己的账本按「已派发」记预留额，界面口径是「失败不代表未收费」 | plan `:503`、`:676`、`outdoor-facility-generate.tsx:49` |

---

## 3. 给丽丽（婚礼策划方）的一页操作指引

> 场景：花家山庄开阔草坪婚礼游园会，丽丽侧负责方案与布置，我方提供物料。
> 这页只讲**能自己做的四步**，不涉及内部流程。

### 第 1 步 · 挑一个位置

打开项目 → 左轨「**户外规划**」→ 在草坪上选中/添加一个设施（例如「迎宾签到台」「主舞台」）。
> 提示：设施是「东西该在哪儿」，模型是「东西长什么样」。先定位置，再定模型。

### 第 2 步 · 用一句话描述

选中设施后点「**用一句话生成这个设施**」（或直接对助手说「给迎宾签到台生成一个」），
在描述框里写一句话。**建议照这个句式写**：

> **是什么 + 什么颜色材质 + 多大 + 干什么用**
> 例：`一张白绿配色的婚礼签到台，长约 1.8 米、宽 60 厘米、高 75 厘米，台面铺米色桌布`

**写尺寸有用但不精确**：本轮实测写「长 1.8 米、宽 60 厘米、高 75 厘米」，
生成的模型实测 1.8 × 1.147 × 0.924 m —— 一个数对得上，另外两个对不上。
**所以尺寸要在物料详情里校准（见第 4 步），不要拿模型上的尺寸当采购依据。**

### 第 3 步 · 等它生成完（5–8 分钟）

提交前会要你**勾选「消耗额度」**（每件 20 点）。提交后：

- 生成期间可以继续做方案，**不用守着**。
- 成品会出现在「**物料 → 我的生成**」里，状态从「生成中」变成「模型已就绪」。
- 生成失败**不扣点**，但**不会自动重试**——需要你换一个描述或换一张参考图，手动再发一次。

### 第 4 步 · 取件、摆位、校尺寸

1. **取件**：「我的生成」里点「**加入场地预览**」，模型就进画布了。
2. **摆回设施**：回到户外规划，选中那个设施 → 候选列表里点刚生成的那件 → 确认替换。
3. **校尺寸**：生成模型的尺寸是**按模型本身推算的**，不是实物尺寸。
   - 要精确到厘米的东西（签到台、桌花、指示牌），**以你手上有���实物为准**，
     在物料详情里把宽/深/高改成真实米数；
   - 没校准的生成件，**方案里不要引用它的尺寸**，只当摆放占位。
4. **给团队复用**：物料库里点「**公开**」，任何注册用户都能在物料库看到并取用；
   不想公开就点「撤下」，立刻生效。

### 什么时候该用「参考图生成」而不是「描述生成」

- **描述生成**：手上没有照片、也不需要精确还原某件东西的时候。**零照片，最快。**
- **参考图生成**：你有一张**主体单一、背景干净**的物件照，想照着做同款。
  - 参考图要求：PNG / JPEG、单边 ≤ 4096 px、≤ 5 MB。
  - **复杂场景照、带水印、多个主体的照片会失败**（本轮失败 2 次都是这个原因）。
  - 想用照片而手上没有干净版本，**更稳的路子是先用文字生成一张白底单主体图，再拿它做参考图**。

### 一句话记住三条边界

| | |
| --- | --- |
| 生成的模型**不能还原你的真实场地** | 真实场地要现场拍摄重建 |
| 生成的模型**不能拆成零件** | 一件就是一件 |
| 生成的模型**尺寸不可信** | 精确尺寸请自己填 |

---

## 4. 待实现的体验断点清单

> 排序依据：**能不能让普通用户用上「零照片」** > **能不能把生成物变成可复用的资产** > **口径修正**。
> 每条只写「改哪个文件 / 改哪个函数」，不写实现代码。所有涉及 Edge Function 契约或数据库迁移的，都标了「需人 review」。

### P0-1 · job 终态回写对话 / 对话侧轮询

- **缺口是什么**
  用户在对话里发起生成后，**对话侧没有任何终态回写**。生成进度只在「我的生成」面板里，
  靠 30 秒轮询看得到（`generated-model-library.tsx:101-116`）。对话与生成之间目前是断的：
  用户只能自己切面板去看。平台**没有**「说话 → 看到结果」的闭环。
- **改哪里**
  - 复用既有端点，**不需要新端点**：`GET /jobs`（`frontend/lib/backend-session.ts:2045-2047`）已返回任务列表；
    单个任务 `GET /jobs/{id}`（`:2040-2044`）。
  - `frontend/components/room-organizer/panels/agent-panel.tsx`：在既有生成等待机制附近
    （`generationWait` / `generationFollowups` / `generationQueued`，见 `:846-849`）加一个「生成任务状态订阅」，
    把终态写成一条对话气泡。
  - `frontend/components/room-organizer/panels/agent-bubbles.tsx`：加一张「生成结果卡」组件。
  - 失败文案复用 `frontend/components/room-organizer/lib/generation-failure.ts`，不要另写一套。
- **验收口径**
  1. 对话里提交生成 → 气泡里出现任务号；
  2. 任务 ready 后，**同一条气泡自己**变成「已生成，去我的生成取件 / 已加入场地」，不需要用户切面板；
  3. 失败时显示人话原因，且**不自动重发付费请求**（口径对齐 `outdoor-facility-generate.tsx:111-127`）；
  4. 刷新页面后仍能读到该任务的终态；
  5. `frontend/components/room-organizer/panels/agent-panel.react.test.tsx` 有对应用例。

### P0-2 · 生成结果自动落画布（户外设施原位）

- **缺口是什么**
  「自动落画布」目前**只存在于一个入口**：在「我的生成」面板里自己提交的任务，
  ready 后自动进画布（`generated-model-library.tsx:155-168`，`:183` 置 `autoAdd`）。
  **户外设施原位生成走的不是这条路** —— 它的产物只进设施的候选列表
  （`outdoor-plan-overlay.tsx:593` 合并 `listGeneratedFacilityModels`），
  用户还得自己去点一次候选才会换模型（`use-outdoor-agent-workflow.ts:2143-2176`）。
  另外生成件记录是会话级（`facility-generated-models.ts:526` 的 `sessionOnly: true`），
  刷新或换设备后 `modelOverride` 悬空。
- **改哪里**
  - `frontend/components/room-organizer/lib/facility-generated-models.ts`：
    在 `resolveFacilityGenerateLink`（`:488`）拿到 `imported` 之后直接回填设施的 `modelOverride`，
    并去掉 `sessionOnly` 或补一条按任务身份重建的持久化路径（当前持久化过滤在 `:85-87`）。
  - `frontend/components/room-organizer/components/outdoor-plan-overlay.tsx:593`：
    把已 ready 的生成件置顶并默认选中（现在是合并后 `.slice(0,5)`）。
  - `frontend/components/room-organizer/hooks/use-outdoor-agent-workflow.ts`：
    `choose-model` 分支（`:2143`）允许「自动选中即应用」，不需要用户再点一次。
- **验收口径**
  1. 提交一次描述生成 → 完成后回到户外规划，选中该设施，**模型已经是生成的那件**（不再手动点候选）；
  2. 刷新页面后仍是同一件；
  3. **生成失败时不替换**现有模型（设施保留原模型）；
  4. 换设备/换项目后不出现「模型丢了但占地还在」的半截状态。

### P0-3 · 公共目录条目不得携带用户原话（默认公开的前置）

- **缺口是什么**
  `assets.list` 返回 `a.*`（只去 `storage_path`），含 `metadata.originalPrompt`（用户原话，
  由 `worker.ts:114-115` 写入）；Edge 侧 `assetPreviewView`（`api.ts:58-67`）只换 `previewPath` 不删原话。
  公开之后，别的注册用户 `GET /assets` 就能读到这段原话。
- **改哪里**
  - `supabase/migrations/<新迁移>.sql`：`scene_rpc('assets.list')` 返回体剔除 `metadata.originalPrompt`
    （对非物主剔除；物主自己仍可见自己的原话）。
  - `supabase/functions/_shared/api.ts:58-67`：`assetPreviewView` 同步剔除。
  - ⚠️ **迁移 + Edge 契约，需人 review**（AGENTS.md 第七条）。
- **验收口径**
  1. 用另一个账号 `GET /assets`，公开条目的响应里**没有** `originalPrompt`；
  2. 物主 `GET /assets/{id}` 仍能读到自己写的那句；
  3. 预览图签名地址仍正常（1 小时有效期不变）。

### P1-4 · 「公开到物料库」按钮（生成完就能一键公开）

- **缺口是什么**
  现在公开入口只有物料库面板里的「公开 / 撤下」按钮
  （`frontend/components/business/assets-panel.tsx:140-147` 的 `togglePublish`、`:236-239` 的按钮），
  **生成完成的当下没有一键入口**。本轮 36 件是**脚本批量公开**的，不是用户点出来的
  （plan `:930`）。
- **改哪里**
  - `frontend/components/room-organizer/panels/generated-model-library.tsx`：
    `ready` 态任务卡加「放进公共物料库」按钮（位置参照 `:301-302` 的「加入场地预览」）。
  - 走**既有端点** `POST /assets/{id}/publish`（`api.ts:731-736`），**不新增契约**。
  - 默认值（默认公开还是默认私有）与提交前的勾选**同源**：放在 `frontend/lib/assets-api.ts`
    （与 `GENERATION_BUSY_NOTICE` `:84` 同处），避免两处各写一套。
- **验收口径**
  1. 任务卡点一下 → 按钮变「已公开」；
  2. 另一个账号刷新 `GET /assets` 能看到该条，且带可用的 https 预览地址；
  3. 物主点「撤下」后，另一个账号立刻看不到；
  4. **参考图与平面图不出现该按钮**（只有 `format='glb'` 可公开，迁移 `:54` 抛 `ASSET_NOT_PUBLISHABLE`）；
  5. 未公开的条目在别的账号那里**完全不可见**（不只是没有徽标）。

### P1-5 · 尺寸标定入口（人工填真实米数）

- **缺口是什么**
  生成件尺寸只有包围盒 + 启发式（`assets.ts:71-89`），产品侧**没有「人工填真实米数」的口子**
  （plan `:893` 明确记录为未建）。而生成件的宽/深会**直接写进户外设施占地**
  （`use-outdoor-agent-workflow.ts:2167` 的 `size:{width,depth}`）—— 也就是说，
  一个错的包围盒尺寸会**直接画进 2D 平面图**，进而影响通道与分区判断。
- **推荐做法**：**人工填真实米数为必填，包围盒值只作占位显示**
  - 理由一：包围盒归一化会给出 33 倍级别的错误（餐盘实测，plan `:830`），这种数字进方案会直接误导甲方；
  - 理由二：人工填一次成本极低（宽/深/高三个数），而活动策划方**本来就知道**签到台该多宽、桌花该多高；
  - 理由三：户外设施本来就有自己的尺寸（`PlanFacility.size`），人工校准正好把两套尺寸对齐，
    而不是让模型的猜测去覆盖策划的尺寸。
  - 备选（不推荐）：「接受包围盒归一化值，只标『尺寸待核实』」——把一个已知会差 33 倍的数放进方案，
    比让人填一次更危险。
- **改哪里**
  - 写入侧：`frontend/components/room-organizer/lib/facility-generated-models.ts`：
    生成件记录（`:31-35` 的 `width/depth/height`、`:523-527` 的构造）旁加一个「按实物校准」小表单，
    校准值存到资产的 `metadata.dimensions`（服务端归一化在 `supabase/functions/_shared/assets.ts:71-89`，
    写入需确认是否属于契约面 → **可能需人 review**）。
  - 展示侧统一：`frontend/components/room-organizer/panels/material-candidates-panel.tsx:26`
    已经写着「展示的是模型标称尺寸。实物规格、库存和价格还需核实。」——在它旁边加
    「**已按实物校准 / 未校准**」标记。
  - 导出侧：方案导出里对**未校准**的生成件不写尺寸（只写「待核实」）。
- **验收口径**
  1. 未校准的生成件在候选列表里标「**尺寸待校准**」，方案导出里**不出现**它的尺寸；
  2. 校准后显示用户填的三个数字并标「已校准」，物料库详情与户外候选**显示一致**；
  3. 校准后设施占地用校准值重新计算，且 2D 平面图同步更新；
  4. 未校准的生成件**不允许**被当作采购依据导出（导出行里带提示）。

### P2-6 · 图生通道「补充描述」框的口径修正

- **缺口是什么**
  物料/设施来路的模型表单在图生模式下有「补充描述」输入框
  （`frontend/components/room-organizer/panels/generation-sheet.tsx:498-501`，placeholder「按照片做同款，哑光白桌面」），
  提交前还会因为没填而拦一句「先写一句补充描述。」（`:212`）。
  但图生通道**不把描述发给生成服务**（`providers.ts:73`），**改描述对结果没有任何影响**。
  用户会以为是自己写错了，然后反复改描述重试（每次都是付费请求）。
- **改哪里**
  - `frontend/components/room-organizer/panels/generation-sheet.tsx:498-501`：
    这行改成「**给这件模型起个名字（不影响生成结果）**」或直接移除；
  - `:212` 的拦截文案同步改（若保留输入框则不再拦）；
  - `frontend/components/room-organizer/panels/generation-sheet.tsx:362-366`：
    创作卡路径本来就把**文件名**当描述用（现注释已写「图生没有补充描述框，提示词用参考图文件名」），
    对齐成同一口径；
  - 文案单一真源建议放 `frontend/lib/assets-api.ts`。
- **验收口径**
  1. 图生模式下，界面上**没有任何文案**暗示描述能改变生成结果；
  2. 图生提交后，物料详情里的名字 = 用户填的名字或参考图文件名；
  3. 现有测试 `frontend/components/room-organizer/panels/generation-sheet.react.test.tsx`
     对应断言更新后仍通过。

---

## 5. 口径红线：哪些话不能对用户说

> 判据只有一条：**这句话在今天的技术事实下能不能被证伪。** 能被证伪但我们没验证的，不说；
> 已经被证伪的，反着说。

| # | ❌ 不能说 | 为什么不能说 | ✅ 正确说法 |
| --- | --- | --- | --- |
| R1 | 「照片级还原」「一比一还原你的场地」 | 零照片链路**不重建场地**；单图→3DGS 场景公开接口实测 2/2 失败；「道具工厂不是场景工厂」（`docs/39:20`、`:115-116`） | 「按你的描述生成一件可摆放的 3D 物件」；真实场地要「现场拍摄重建」 |
| R2 | 「尺寸精确」「按你说的 1.8 米就做成 1.8 米」 | 只有包围盒 + 启发式（`assets.ts:71-89`）；实测餐盘高度差 **33 倍**（plan `:830`）；本轮 1 件只有 1 个轴对上 | 「模型尺寸是按模型推算的，只能作参考；真实尺寸请在物料详情里校准」 |
| R3 | 「已生成 300+ 真实道具」 | 台账是 **36 件 ready**（37 件清单里 1 件失败），且**全部来自同一个账号**，不是 300+（plan `:902-905`） | 「本次已生成并入库 36 件婚礼物料，已放进公共物料库，可直接取用」 |
| R4 | 「1 分钟出模型」 | 实测端到端 **5.8–7.1 分钟**（plan `:512`） | 「一般 5–8 分钟，生成中可以继续做方案」 |
| R5 | 「失败会退积分 / 失败不收费」 | 生成服务侧失败件 `consumedCredits=0`（`docs/39:205`），但平台账本按「已派发」记预留，界面口径是「**失败不代表未收费**」（`outdoor-facility-generate.tsx:49`） | 「这次没生成出可用的模型」+「请核对生成任务记录与费用」——**不替平台承诺扣费** |
| R6 | 「生成一定成功」 | 失败时供应商**只回状态码，零原因字段**（`providers.ts:83-85`、实测响应原文） | 「这次没做出来，换个描述 / 换一张参考图再来」 |
| R7 | 「改描述就能改模型」（在图生模式下） | 图生通道不把 prompt 发给服务（`providers.ts:73`） | 图生模式那行只改名字；「想改变形态请换一张参考图」 |
| R8 | 「零照片 = 什么都不要」 | 图生通道仍需参考图；只有**描述生成**是零输入 | 「用描述生成不需要任何图片」 |
| R9 | 「一件顶三件，能拆开用」 | 产物是单网格单材质（`docs/39:60`）；部件拆分 3/3 失败（`docs/39:98`） | 「一件就是一件，不能拆成零件」 |
| R10 | 「还原了真实道具的样子」 | 生成物是**按描述或参考图做的**，不是量出来的实物；尺寸与颜色都不承诺 | 「按你的描述做了一件同类型的 3D 物件，实物颜色与规格请另行核对」 |
| R11 | 「公共物料库 / 官方精选库」（把公开目录说成官方认证目录） | 公开目录里是**用户自己生成的东西**（本轮 36 件全是脚本批量公开），没有审核、没有质量背书（plan `:930`） | 「公共物料库：任何注册用户都可以公开自己的生成物料，大家互相取用」 |
| R12 | 对用户说出生成服务商的**品牌名 / 接口名 / 版本号** | 实现细节，不是产品承诺；且 `engineLabel`（`model-generation.ts:21-23`）会直接把 `'Aholo Lux3D'` 打到界面上 | 「3D 生成服务」；确实要提引擎时只说「当前 3D 生成引擎」 |
| R13 | 「已上线」「已验收」（对没做过的事） | AGENTS.md 第六条：没有证据不算完成 | 只写实测过的；本轮文生成功要写「**实测 1 次成功（样本量 1）**」 |
| R14 | 「参考图随便一张照片就行」 | 失败与成功的差别在参考图形态：复杂场景照/带水印 → 失败；干净单主体白底 → 6/6 成功（plan `:456-457`、`:545-546`） | 「参考图要主体单一、背景干净；复杂场景照会做不出来」 |
| R15 | 「物料库里有的都是能直接用的现货」 | 物料候选来自随包模型目录，**不代表云端物料库存**（`material-candidates-panel.tsx:28` 已写这句话）；生成件尺寸不可信 | 「候选来自随包模型目录，不代表云端物料库存」+「模型标称尺寸，实物规格、库存和价格还需核实」 |

---

## 附录 A · 本文核实过的关键文件:行号清单

| 文件:行号 | 核了什么 |
| --- | --- |
| `supabase/functions/_shared/providers.ts:73` | 图生 3D 请求体**无 prompt** |
| `supabase/functions/_shared/providers.ts:76` | 文生 3D 请求体**含 prompt** |
| `supabase/functions/_shared/providers.ts:83-85` | 状态映射；未知状态当「仍在跑」；`status 4` → `PROVIDER_FAILED`，**无 reason 字段** |
| `supabase/functions/_shared/generation-lane.ts:12, 41-49` | 通道列表与选路：`provider:'aholo'` 且 kind≠texture 时覆盖 text/image |
| `supabase/functions/_shared/worker.ts:77` | `provider.submit(job.prompt, {imageUrl, sourceUrl})` —— 有图走图生、无图走文生 |
| `supabase/functions/_shared/worker.ts:100-101` | FAIL → `failed`；否则 `processing` |
| `supabase/functions/_shared/worker.ts:113-115` | `metadata.generation` 与 `metadata.originalPrompt = job.prompt`（原话入库） |
| `supabase/functions/_shared/worker.ts:125-131` | 资产落库：`name: generatedObjectName(job.prompt)`、`license: provider-terms` |
| `supabase/functions/_shared/generation-input.ts:11-13` | 参考图规格：格式 png/jpeg、边长 128–4096、体积 ≤ 5 MB |
| `supabase/functions/_shared/assets.ts:71-89` | 尺寸归一化启发式（最长边 ≥20 判厘米、z 轴判定） |
| `supabase/functions/_shared/models.ts:122-124` | 包围盒取尺寸；`MAX_PROVIDER_GLB_BYTES` 上限（`:14`） |
| `supabase/functions/_shared/scene-resources.ts:16-17` | "Raw GLB bounds are not a statement of real-world dimensions" |
| `supabase/functions/_shared/api.ts:58-67` | `assetPreviewView`：1 小时（3600 秒）签名预览地址；只签 `previewPath` |
| `supabase/functions/_shared/api.ts:711-713` | `GET /assets` 列表 |
| `supabase/functions/_shared/api.ts:731-736` | `POST/DELETE /assets/{id}/publish` |
| `supabase/migrations/20261119150000_published_assets.sql:25-36` | `can_use_asset`：公共目录物料对有工作室身份的用户可用 |
| `supabase/migrations/20261119150000_published_assets.sql:46-63` | `assets.publish`/`unpublish`：仅物主、仅 `format='glb'`（`:54`）、`on conflict` 幂等（`:57`） |
| `supabase/migrations/20261119150000_published_assets.sql:64-73` | `assets.list` 返回 `a.*`（含 `metadata`）+ `published_at` |
| `frontend/lib/backend-session.ts:2017-2018` | `createGenerationJob(prompt, requestId, options)` |
| `frontend/lib/backend-session.ts:2040-2047` | `getGenerationJob` / `listGenerationJobs` |
| `frontend/lib/assets-api.ts:84` | `GENERATION_BUSY_NOTICE`（「3 个生成任务」）—— 文案单一真源惯例 |
| `frontend/components/room-organizer/components/outdoor-facility-generate.tsx:60, 137-149, 187-194` | 描述框初值=设施名；`provider:'aholo'`；`kind:'text'` 提交；额度勾选与「提交生成」 |
| `frontend/components/room-organizer/components/outdoor-facility-generate.tsx:49-51, 111-127` | 「失败不代表未收费」；新一轮需重新确认额度、不自动重发 |
| `frontend/components/room-organizer/components/outdoor-plan-overlay.tsx:593-594` | 候选合并（含 `modelOverride`）；`openGenerate` → 统一生成面板（facility scope） |
| `frontend/components/room-organizer/components/outdoor-workflow-card.tsx:715, 739-748` | 「选择模型」动作；「准备原位生成（另行确认费用）」/「上传图片准备生成（另行确认费用）」 |
| `frontend/components/room-organizer/panels/creation-entry.tsx:237, 270-281, 282-297` | 文生引导句、描述框与 placeholder、生成按钮 + 消耗额度勾选 |
| `frontend/components/room-organizer/panels/generation-sheet.tsx:207-213, 362-366, 498-501` | 提交前校验；创作卡图生用文件名当描述；图生模式的「补充描述」框 |
| `frontend/components/room-organizer/panels/generated-model-library.tsx:101-116` | 30 秒轮询读任务状态 |
| `frontend/components/room-organizer/panels/generated-model-library.tsx:155-168, 183, 301-302` | 本面板提交的任务 ready 后自动落画布；「加入场地预览」按钮 |
| `frontend/components/room-organizer/lib/model-generation.ts:14-23, 67-73` | `engineLabel` 暴露供应商名（须在产品文案里替换）；`submitModelJob` 入参 |
| `frontend/components/room-organizer/lib/facility-generated-models.ts:85-87, 488, 523-531` | 持久化过滤 `sessionOnly`；`resolveFacilityGenerateLink`；生成件记录带 `sessionOnly: true` |
| `frontend/components/room-organizer/lib/generation-failure.ts:50-55, 88-96` | `PROVIDER_FAILED` 的人话兜底 |
| `frontend/components/room-organizer/hooks/use-outdoor-agent-workflow.ts:2143-2176` | `choose-model` → 写 `modelOverride` 与 `size:{width,depth}`（尺寸进 2D 占地） |
| `frontend/components/room-organizer/panels/agent-panel.tsx:21, 4028` | 「物件与场景生成不在这里」；`AgentTaskExamples` 挂载点 |
| `frontend/components/agent-task-examples.tsx` | Agent 面板示例句的数据结构与挂载方式 |
| `frontend/components/room-organizer/panels/material-candidates-panel.tsx:26, 28` | 「模型标称尺寸」免责声明；「不代表云端物料库存」 |
| `frontend/components/business/assets-panel.tsx:140-147, 186, 236-239` | `togglePublish`；`canPublish`（仅物主 + glb）；公开/撤下按钮 |
| `docs/39-Aholo能力与用途评估-20261108.md:20, 60, 62, 98, 115-116, 179-180, 205` | 道具工厂口径；单网格单材质；计费；拆分 3/3 失败；3DGS 2/2 失败；端点参数；credits 与失败 0 扣 |
| `docs/plans/2026-11-19-contest-wedding-next-plan.md:456-457, 474-486, 512, 545-546, 674-682, 779-789, 826-832, 879-883, 902-915, 920-932` | 干净参考图 6/6；端到端耗时；0/41 参考照可用；credits 与失败不扣；预览图 34/34 + 1 小时签名；尺寸实证；三个硬伤；36 ready/1 failed；失败响应原文；零照片链路真相表 |

## 附录 B · 本文的边界（刻意没做的事）

- **没改任何代码**：`frontend/`、`supabase/`、`client/` 一行未动。
- **没动 git**：没 `git add`、没 commit、没建分支。
- **没注册进 `docs/INDEX.md`**：该文件由脚本扫盘生成（见 `docs/README.md:3`），本文不在其维护范围内。
- **没核实的事**：本轮文生成功那 1 件（签到台，1.8 × 1.147 × 0.924 m）来自口述交接，
  **仓库内尚无台账记录**，本文按「实测 1 次成功、样本量 1」标注；
  图生失败 2 次的具体参考图文件名，本文未逐字复核（只采信 plan `:908-915` 的响应原文）。
- **没做的产品决策**：§1.3 的「默认公开」是一条**建议**，不是已实现的事实；
  它依赖 P0-3（公开条目不带用户原话）先落地，否则应退回默认私有。
