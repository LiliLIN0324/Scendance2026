# Scendance（幕景）Taste & IA Memo — 2026-10-29

> **Scope**: public product references + opinionated KEEP/KILL for first-screen / IA. **Not** implementation.  
> **Owner nails (准)**: 「3D 活动方案全流程生成」· 结果=布置/物料/执行资料 · 主路径=选活动→定场地人数→生成→确认→导出 · 对话加速非必考 · 简如 tuijian · 气如 Viggle · 禁小碎乱 · scene/object/compose 仅内部层 · 冷石+品牌绿已定 · 深砍不三不四。  
> **Sources fetched**: viggle.ai / pinoc / jst2 / docs scene · Spline docs+UI tour · Dora marketing · Luma Dream Machine · Meshy workspace tour · Hyper3D WorldGen · Polycam Scenes help · memory + `ACTIVITY-FLOW-AI-NATIVE-FRAMEWORK-2026-10-27.md`.  
> **tuijian**: github.com/wustwyh/tuijian referenced by owner as「笨但好懂」card→pipeline；repo page thin/403 — pattern taken from owner nail, not reverse-engineered UI pixels.

---

## 1. Reference scorecards

Score axes (1–5): **Simple** (one obvious path) · **大气** (big canvas / quiet chrome / world-first) · **IA clarity** (modules map to user jobs) · **Fit to Scendance** (activity plan, not 3D toy).

| Product | One-line value prop | Main IA (tabs/modules) | What feels 大气 | What feels cluttered (AVOID) | S | 大 | IA | Fit |
|---|---|---|---|---|---|---|---|---|
| **Viggle PINOC / Scene** | Describe a place/clip → walk a 3D world; characters+motion for pros | App: **Scene mode** vs **Agent mode** (scenes+chars+motion); marketing stacks Photos→char / Video→motion / Text→motion / Auto-rig; API: pano→generate views→reconstruct | Huge explorable world as hero; few modes; “type what you want”; gallery of whole rooms not tool chrome; quiet research pages (JST-2) | Surfacing character / mocap / auto-rig / MCP / export formats on first breath; treating Scene+Agent as peer equal products for non-3D users | 4 | **5** | 4 | **4** (steal atmosphere + “describe→world”, not mocap stack) |
| **Spline V2** | Browser 3D/2D design + AI agent builds editable scenes | Home: prompt + create chips · Editor: **Agent / Objects / Assets** · stage **Preview \| Edit \| Code** · dense tool dock · right inspector (lights/fog/sky…) | Pale big viewport; Agent-first empty state (“Let's build!”); world fills the frame | Tool dock density; Objects/Assets/Code as co-equal first screen; inspector walls; “design tool” smell | 2 | 4 | 3 | 2 (steal big canvas emptiness only) |
| **Dora AI** | One prompt → full site; 3D/animated web without code | Magic prompt → generate site → tweak/publish; editor has 3D widget as *feature*, not product | End-to-end generate; atmospheric marketing (“sites beyond imagination”) | Editor still a design tool with 3D widgets, lights, keyframes — if that chrome becomes first screen, 大气 collapses | 4 | 4 | 3 | 3 (steal “one prompt → full deliverable”) |
| **Luma (Dream Machine → Agents)** | Ask → images/video (boards); newer: agent + infinite canvas for campaigns | Board/Ideas · conversational prompt · Describe/Modify/Keyframe/Reference · Brainstorm vs Create | Conversational flow; big results grid; “just ask” | Mode tabs (Describe/Keyframe/Reference/Modify) compete; infinite canvas + multi-model = creative desk, not venue plan | 3 | 4 | 3 | 2 (steal chat fluency; reject board sprawl as home) |
| **Meshy Workspace 3.0** | Instant AI 3D assets; task modes | Left modes: **Assets / Agent / Image / Model / Print / Animate** · center preview · right history | Strong when one model fills center | **Mode sidebar as product** = toolbox catalog; Print/Animate/Remesh on equal footing = small & busy | 2 | 2 | 2 | **1** (object-gen UI is anti-pattern for Scendance surface) |
| **Hyper3D Rodin / WorldGen** | Image → editable scene of separate meshes + splat BG | WorldGen: upload · auto-extract/box objects · FastGen/MaxGen env · Phys Correction / AI Render / Download | “Complete scene” promise; walkable result | Object list + New/Add/Remove + Sim-Ready + Fast/Max as **primary** = compose lab; good internal, bad first screen | 2 | 3 | 3 | 2 (internal: object/scene layers; never user-facing home) |
| **Polycam Scenes** | Merge captures into one environment | Create Scene → pick captures → layers panel · move/rotate/scale · snap · swap · export GLB | Honest spatial composer for captures | Layers/snap/swap as default = technician UI; splat+floorplan exclusions; not “generate a plan” | 2 | 3 | 3 | 2 (internal compose only) |
| **tuijian-style clarity** *(pattern, not 3D)* | Card → clear pipeline → result blocks | Card/choice → few steps → one generate → structured outputs | Clarity *is* the atmosphere: nothing fights the path | Multiple parallel entry chips; “advanced” siblings on home; chat-as-exam | **5** | 3 | **5** | **5** (owner: 笨但好懂 — binding) |

**Steal matrix (opinionated)**

| Steal from | What | Do NOT steal |
|---|---|---|
| Viggle/PINOC | World-first hero; Scene vs deep tools collapsed; describe → enter space | Character/motion/rig/MCP as peer modules |
| Dora | One prompt → full package | Site-editor chrome / 3D widget nesting |
| tuijian | Card → pipeline → result sections | Anything that needs a tutorial wall |
| Spline | Empty viewport breathing room | Agent/Objects/Assets + Code stage on day-0 |
| Luma | Natural-language iterate | Boards + mode tabs as IA spine |
| Meshy/Rodin/Polycam | *(nothing for surface)* | Mode rails, object extractors, layer composers as home |

---

## 2. Product north star (binding)

**Scendance / 幕景** = **3D 活动方案全流程生成**  
User-facing outputs (three result plates, not three products):

1. **布置** — venue layout on the big canvas  
2. **物料** — list tied to layout  
3. **执行资料** — export/handoff for build & client review  

**One user-facing generate path**  
`选活动 → 定场地·人数 → 生成 → 确认 → 导出`  
Chat = accelerator / refine, **not** the entrance exam.

**Internal layers (allowed, never marketed as tabs)**  
`scene shell · object assets · compose/layout` — pipeline guts behind one Generate. User never chooses “Scene Gen vs Object Gen vs Composer.”

Left rail stays **布置 / 评审 / 执行** only (never a fourth icon).

Visual tokens already exist — **cold stone** (`#F4F5F7` family) + **brand green** (`#4A7C59` + soft) + near-black ink + hairline. **Do not invent a new color system.**

---

## 3. KEEP / KILL / DEEP-HIDE

### KEEP (surface)

- One primary verb: **生成方案** (or equivalent short label) — single green accent when actionable; **idle = zero green primary**.
- Activity **card / template pick** (tuijian clarity) as cold start — not a blank “prompt playground.”
- Compact **场地 · 人数 · 尺寸** intake (brief chips or left live brief synced to chat) — no second form.
- **Big center canvas** as the emotional product (Viggle 大气); layout result owns the frame.
- After generate: **three result plates** 布置 · 物料 · 执行 — same plan, different views; not three apps.
- **建议 → 绿框预览 → 唯一确认** (确认布置 / 确认导出) — one decision per breath.
- Left rail **布置 / 评审 / 执行** only.
- 晴光 as living edge presence (not sticker card).
- Honest demo label when mock brain.
- Quiet cold-stone chrome; green only for the one confirm / generate moment.

### KILL (from user-facing IA / first screen)

- Peer tabs or home chips for: Scene Gen · Object Gen · Compose · Animate · Print · Remesh · Mood · 3DGS · WorldGen · Capture merge.
- Six-tab exec shell as default (`活动安排/物料工作单/制作计划/数量点验/导出/本机备份` smell).
- Wizard n/4, “下一步”, idle green export, dual confirm buttons.
- Button-side instruction paragraphs / AI footnote walls.
- Spline-like tool dock + Objects/Assets/Code as day-0 stage.
- Meshy-like mode sidebar as product map.
- “Describe anything” empty creative playground as the **only** home (chaos without card→pipeline).
- Fourth left-rail icon; tutorial-in-chrome.
- Marketing of internal vendors (Viggle/Meshy/Rodin) on surface.

### DEEP-HIDE (exist in code/pipeline; never first-class UI)

| Internal layer | When visible | How user meets it |
|---|---|---|
| Scene shell / floorplan→space / future rebuild | After a plan exists, advanced | Chat or 布置 deep affordance — not home tab |
| Object / furniture gen & library | Inside layout edit | “换这一件” / library drawer — not Mode=Object |
| Compose / snap / layers | Power edit | Selection → transform; no Polycam Scenes home |
| Exec six-tools | Export preview | Intent → preview card → 确认导出 |
| Review cloud link | 评审 mode | Client-ready package, no edit chrome |
| Agent / MCP / model pickers | Never for end user | Ops only |

---

## 4. First-screen proposal (before any deep tool)

**Goal**: tuijian-simple entry + Viggle-big room — user feels “this makes my event plan,” not “this is a 3D suite.”

```
┌──────────────────────────────────────────────────────────────┐
│  [logo 幕景]                              [项目] [账号]       │  ← hairline chrome, cold stone
├────┬───────────────────────────────────────────┬─────────────┤
│ 布 │                                           │             │
│ 置 │         BIG CANVAS / WORLD STAGE          │  活动简报   │
│    │     (empty venue shell OR last plan       │  名称       │
│ 评 │      atmospheric, not tool clutter)       │  人数 尺寸  │
│ 审 │                                           │  状态短词   │
│    │                                           │             │
│ 执 │                                           │  结果板块   │
│ 行 │                                           │  · 布置     │
│    │                                           │  · 物料     │
│    │                                           │  · 执行     │
├────┴───────────────────────────────────────────┴─────────────┤
│  FIRST BREATH (empty project):                               │
│  ┌──────── card row: 酒会 / 发布会 / 工作坊 / 空白场地 ────┐ │
│  │  场地·人数  chips   →   [ 生成方案 ]  (one green)       │ │
│  └─────────────────────────────────────────────────────────┘ │
│  Chat dock: optional refine (“再宽松一点”) — not required     │
└──────────────────────────────────────────────────────────────┘
```

**Rules for this screen**

1. Before generate: canvas can be quiet empty shell or soft atmosphere — **no** tool palette competing.  
2. Card → few chips → **one** Generate. That is the whole IA lesson.  
3. After generate: canvas fills with layout; right (or below) shows the three plates; chat continues as refine.  
4. Deep tools (object swap, snap, export internals) appear **only after** a plan exists and only in context.  
5. Idle right column: **zero** green primary. Green appears for Generate (pre-plan) or Confirm (preview).

---

## 5. Taste principles (≤10) — for later UIUX

1. **One path, three plates** — generate once; 布置/物料/执行 are views of one plan.  
2. **World eats chrome** — canvas ≥ ~60% of workbench; panels are thin hairline, not dashboards.  
3. **Card before chat** — tuijian cold start; chat accelerates, never gates.  
4. **Idle silence** — zero green primary; zero tutorial footnotes; status = short words only.  
5. **One decision per breath** — preview then single confirm; never two confirms.  
6. **Internal ≠ interface** — scene/object/compose stay pipeline nouns; UI speaks 活动/场地/方案.  
7. **Atmosphere without mood toys** — quiet cold stone + space; no weather/Bloom/mood strip as product.  
8. **Green is scarce** — brand green only for the moment that commits (生成 / 确认布置 / 确认导出).  
9. **No toolbox catalog on home** — if it looks like Meshy modes or Spline docks, cut it.  
10. **Owner taste wins** — references inspire; when conflict, Scendance nails above Viggle/Spline aesthetics.

---

## 6. Opinionated cuts vs current framework docs

Aligns with / hardens `ACTIVITY-FLOW-AI-NATIVE-FRAMEWORK-2026-10-27.md`:

| Keep from framework | Deepen / cut further |
|---|---|
| Left rail 三图标 | Unchanged |
| 意图→预览→一确认 | Unchanged; make Generate the *pre*-plan twin of Confirm |
| Ban button footnotes / idle green / six-tab default | **Also ban** any first-screen exposure of scene/object/compose |
| Chat-first story | Soften: **card→generate first**; chat not mandatory to start (owner 2026-10-28 nail) |
| 3DGS / mood Out this phase | Still Out for surface; hide as future internal |
| 卖方案不卖重建 | Surface copy must never say “重建/生成物件/WorldGen” |

**Decisive call**: Scendance first screen is closer to **Dora/tuijian generate** with a **Viggle-sized stage**, **not** a PINOC multi-mode studio and **not** a Spline editor. PINOC Scene is the *atmosphere* reference; tuijian is the *IA* reference.

---

## 7. CloudAgent / code rewrite brief (actionable)

> Hand this to CloudAgent or Cursor as the product gate for the next UI rewrite. **No new color system.** Prefer deep cuts over polish of clutter.

### 7.1 Mission

Rewrite workbench **first breath + IA labels** so a stranger understands in 5 seconds: *pick activity → set venue/people → generate plan → confirm → export*, with a big quiet canvas. Strip peer “3D studio” modules from surface.

### 7.2 In scope (do)

1. **Empty/first project state**  
   - Replace prompt-playground / multi-entry chaos with **activity cards + 场地/人数 chips + single 生成方案**.  
   - Chat dock present but secondary (placeholder refine, not required).

2. **Post-generate state**  
   - Canvas shows layout.  
   - Expose **布置 / 物料 / 执行** as result plates (same plan).  
   - Wire existing confirm preview pattern; idle = zero `btn-primary`.

3. **Deep-hide pass (UI)**  
   - Remove from default chrome / home / left rail / top tabs anything named or smelling like: Scene Gen, Object Gen, Compose, WorldGen, 3DGS, Mood, Animate, Print, Remesh, six-tab exec shell, n/4 wizard, dual confirms, button-side help walls.  
   - Keep capabilities behind contextual menus / chat intents / export preview only.

4. **Copy**  
   - User nouns: 活动、场地、人数、方案、布置、物料、执行、确认、导出.  
   - Ban surface nouns: 重建、高斯、splat、WorldGen、Object、Composer、模式库.

5. **Visual**  
   - Follow `docs/visual-2026/design-spec-2026.html` cold stone + brand green scarcity.  
   - Enlarge canvas proportion; thin side panels; no new palette.

6. **Acceptance screenshots** (must pass)  
   - [ ] First screen: cards + chips + one green Generate; no mode rail.  
   - [ ] Idle: zero green primary.  
   - [ ] After generate: big layout + three plates visible without opening “tools.”  
   - [ ] Left rail only 布置/评审/执行.  
   - [ ] No six-tab shell, no footnote wall, no Scene/Object/Compose tabs.  
   - [ ] Preview → single Confirm still works.

### 7.3 Out of scope (do not)

- New color system / rebrand / IP swap.  
- Real 3DGS / vendor wiring / floorplan rebuild production.  
- Rewriting layout geometry algorithms.  
- Fourth left-rail icon; tutorial product.  
- Spline/Meshy-style editor parity.  
- Push/deploy unless owner named it (sleeping override allows planning + local rewrite prep; **production push still owner-gated** unless separately authorized).

### 7.4 Suggested slice order

| Slice | Outcome |
|---|---|
| **A. First-screen IA** | Card→chips→Generate; kill competing entries |
| **B. Result plates** | 布置/物料/执行 as views of one plan |
| **C. Deep-hide sweep** | Grep/remove surface for KILL list strings & six-tab default |
| **D. Chrome quiet** | Canvas ratio, idle zero-green, footnote purge (upgrade T-UI) |
| **E. Walkthrough pack** | 4-step demo script for partners (no code required) |

### 7.5 Non-goals disguised as polish (reject PRs that…)

- Add “Advanced” home section for 3D tools “just collapsed.”  
- Add Mode switcher “for power users” on first paint.  
- Add explanatory sentences beside Generate/Confirm.  
- Split Generate into Scene Generate + Layout Generate.

---

## 8. One-paragraph synthesis

Scendance should feel like **tuijian taught you the path in one glance**, then **Viggle opened a quiet big room** where the plan lives — not like Spline/Meshy/Rodin/Polycam asking which 3D lab you want. Scene, object, and compose stay **internal machinery**. The only user-facing generate is **活动方案**; the only lasting structure is **布置 · 物料 · 执行** under **布置 / 评审 / 执行**. Cut everything else from the first screen hard.

— End memo —
