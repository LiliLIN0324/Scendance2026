# T-04 快速交付 · 任务卡

> 卡号：**T-04**（对话四步 ④ 快速交付）
> 用户点名：2026-10-26「开 T-04」。
> 依赖：T-01 可布置壳体、T-02 提案 → 预览 → 确认、T-03 快速优化（自检完成，待用户验收）。本卡不重开前三卡范围。
> 依据：`docs/AI-NATIVE-FOR-EXECUTORS.md` §3C / §4.1 / §4.2；`docs/AI-NATIVE-UPGRADE-v1.md` §4。

---

## 1. 一句话任务

把「客户评审」和「执行资料」两套叙事钉死：评审阶段能一眼看到**离线评审 HTML** 与**云端只读链接**两条如实出口，客户页只有看得见、没有可编的控件；执行阶段明确是**本机内部资料**；评审/执行字段可以由本机规则先填一版，但人可改、系统绝不代发客户链；左轨切换仍不丢画布。

---

## 2. 现状核对（开卡前已读代码）

| 蓝图要求 | 代码现状 | 本卡处理 |
|---|---|---|
| 评审 → `/view/` 或离线 HTML；分享可撤销 | 两者都在：`app/view/` 只读页 + `PublicationPanel` 撤销；`ProjectReviewPanel` 只做离线 HTML | **不删能力**；把云端链接入口放进评审阶段，文案写清何时用哪个 |
| 评审主路径一键到只读链接或等价 HTML | Agent 评审态按钮写「生成评审链接」，点开却只有离线 HTML；云发布藏在「项目 → 发布管理」 | **修入口与文案**；离线 HTML 仍是评审页主流程，云端链接给明确次入口 |
| 客户页无编辑控件 | `/view/` 已无编辑 UI、Agent、库、租约、内部备注 | **加回归断言**，不改页面能力 |
| 撤销分享后访问拒绝 | `/view/` 收到 `SHARE_NOT_FOUND` 后移除快照并提示 | 复用现有行为，自检留证据 |
| 执行导出至少一类内部文件且件数与场景一致 | `SceneDeliveryPanel` 已有活动安排 / 物料工作单 / 制作计划 / 点验 / CSV / JSON / GLB / 交接 HTML / 时间表 | **只补「本机内部资料」边界文案**，不重做导出 |
| 预填评审/执行字段，人改；禁代发客户链 | 执行侧已有任务建议（勾选后人才保存）；评审侧说明/待确认字段原本全空 | **新增评审参考预填（本机规则，可改，不覆盖手写）**；所有出口只下载/复制，不自动发送 |
| 左轨评审/执行切换不丢场景 | 同一工作台组件切 mode，画布状态不卸载 | 不改结构；真机切换留证据 |
| 左轨仍三图标；14 键不动 | 已满足 | **本卡零改动** |

### 待核 / 不替产品裁决

1. **主出口唯一策略未定**：`AI-NATIVE-MODULES.md` 把 `C.publish-dual-exit` 标为「in（叙事）」，主出口策略待 PM。本卡**不选边、不删任一出口**，只把两条路写清并放到评审阶段可达位置；等 PM 拍板后再另开小卡收口。
2. **「云端执行双人协作」未验收**：本卡不宣称、不新增；执行页继续写「本机」边界。
3. **电子签 / 收付款 / 开票 / 甲方意见回流闭环**：全部 out，本卡不碰。

---

## 3. In（本卡只改这些路径）

| 路径 | 改动 |
|---|---|
| `frontend/components/room-organizer/lib/review-copy.ts` | 新增纯函数：按活动类型、人数、场地面积、物料件数、必需项、风格/配色/氛围生成评审「方案简述」与「待确认项」参考；无 React / 存储 / 网络 |
| `frontend/components/room-organizer/lib/review-copy.test.ts` | 新增：按活动类型出文、无手写时填入、有手写不覆盖、长度上限、不出现合规/自动发送话术 |
| `frontend/lib/project-review-workflow.ts` | `ProjectReviewPanelActions` 只加可选 `prefill?()`；不改现有 prepare/capture 合同 |
| `frontend/components/room-organizer/panels/project-review-panel.tsx` | 顶部加「客户交付两条出口」说明；离线 HTML 为主流程，云端链接为次入口（打开项目 → 发布管理）；说明/待确认为空时显示「✦ 生成参考」并可点填入；人可继续改 |
| `frontend/components/room-organizer/panels/project-review-panel.css` | 只补出口块与参考按钮的必要样式 |
| `frontend/components/room-organizer/panels/project-review-panel.react.test.tsx` | 新增：两条出口文案、云端入口回调、参考填入后可改、有手写不覆盖、不自动发送 |
| `frontend/components/room-organizer/panels/agent-panel.tsx` | 评审态：去掉「生成评审链接」的假承诺，主钮改为「准备客户评审」并始终可用；写清离线 HTML 与云端链接的条件；执行态补「本机内部资料」 |
| `frontend/components/room-organizer/panels/agent-panel.react.test.tsx` | 更新评审/执行态断言：未登录也可进评审页、无「已发送」话术、执行标明本机 |
| `frontend/components/room-organizer/panels/cloud-panel.tsx` | 新增可选 `publicationRequest`：评审页点「打开发布管理」时切到「发布管理」并打开账户面板；未登录/未绑定云项目时给可执行的下一步，不假装能生成 |
| `frontend/components/room-organizer/panels/cloud-panel.react.test.tsx` | 新增：请求切到发布管理、未登录提示、正常打开时仍从「我的项目」起 |
| `frontend/components/room-organizer/panels/creative-studio.tsx` | 加 `onOpenPublication` 透传；给评审面板传入本机规则 `prefill`；执行区标题补「本机」 |
| `frontend/components/room-organizer/panels/creative-studio.react.test.tsx` | 新增/调整：评审面板拿到 prefill 与云端入口回调；执行标题文案 |
| `frontend/components/room-organizer/room-organizer.tsx` | 新增 `publicationOpenRequest` 状态，连到 `CloudPanel` 与 `CreativeAssistant`；左轨三图标与 14 键不动 |
| `frontend/components/room-organizer/panels/scene-delivery-panel.tsx` | 标题说明补「本机内部资料」，导出按钮与能力不动 |
| `frontend/components/business/publication-panel.tsx` | 只补一句：发布不会自动通知客户，链接由人复制发送 |
| `frontend/app/view/page.react.test.tsx` | 新增断言：客户页没有编辑按钮、Agent 输入、素材库、租约或内部备注 |
| `docs/T-04-SELF-CHECK.md` | 新增：验收 checkbox + 真机证据 + 待核 |
| `CHANGELOG.md` | 追加 T-04 一条 |

---

## 4. Out（明确不做）

- **不裁决主出口**：不删离线 HTML、不删云发布、不把「发布管理」迁出账户面板；主出口策略等 PM。
- **不代发客户链**：不接邮件 / 短信 / 微信 / 任何自动通知；只允许人点复制或下载后自己发送。
- **不做电子签 / 收付款 / 开票 / 甲方意见回流闭环 / 真实双账号执行协同**。
- **不宣称云端执行协作已验收**；执行页仍写本机边界，不写成现场履约系统。
- **不改客户页能力**：不加编辑、Agent、库、项目切换、内部备注；只加回归断言。
- **不改左轨三图标、不改 14 键工具列、不换 logo、不新增页面/表单**。
- **不动 T-01/T-02/T-03 的生成、预览、确认、体检逻辑**；不接真 AI / 新 API；不改 3dgs-demo。
- **不做氛围**：mood / 天气 / Bloom / 室内雨 / NPC 零改动。
- **不做合规结论**：参考文案只写几何与待确认事项，不写消防/疏散/无障碍/验收通过。

---

## 5. 交互与文案钉

1. **评审态不再说「生成评审链接」**：主钮统一为「准备客户评审」，未登录也能进；是否走云端链接在评审页里再选，不在右栏假装已经生成。
2. **两条出口各说清代价**：
   - 离线 HTML：不依赖登录，生成后下载，由人自己发给客户；文件冻结在生成时。
   - 云端只读链接：需要登录、把方案保存到云端并在「发布管理」发布；发布后由人复制链接；**系统不会自动发给客户**。撤销后链接失效，已下载的文件收不回。
3. **参考只填空字段**：说明/待确认已有手写内容时，不覆盖，提示「已有手写内容，参考没有覆盖；要先清空再生成」。填入后仍是普通可编辑文本，改了就要重新生成评审包。
4. **预填不是发送**：参考文案里不出现「已发送 / 已通知客户 / 客户已确认」；只写「参考」「待你核对」。
5. **执行区写明本机**：标题与导出说明都出现「本机内部资料」，不写「云端协作」「现场履约」。
6. **发布管理入口**：从评审页点「打开发布管理」直接切到「发布管理」；未登录时说清先登录，未绑定云项目时说清先打开并保存云项目。
7. **左轨三图标**：布置 / 评审 / 执行；评审、执行都属第 ④ 步，不新增第四颗图标。
8. **话术禁词**：「已发送给客户」「已通知甲方」「云端协作已验收」「消防验收」「合规」。

---

## 6. 验收 checkbox（PASS/FAIL）

- [ ] 评审态主钮为「准备客户评审」，未登录也能打开评审页；不再出现「点一下已生成链接」的假承诺。
- [ ] 评审页同时能看到「离线评审 HTML」与「云端只读链接」两条出口；云端入口能直接打开账户面板的「发布管理」。
- [ ] 未登录 / 未绑定云项目时，云端入口给的是可执行的下一步，不假装已生成链接。
- [ ] 方案说明 / 待确认项为空时，可点「✦ 生成参考」填入本机规则文案；填入后可继续编辑。
- [ ] 已有手写内容时，参考不覆盖，提示先清空；参考文案无合规结论、无「已发送」。
- [ ] 发布 / 下载都只由人触发；页面无自动发送、无「已通知客户」话术。
- [ ] 客户页 `/view/` 无编辑按钮、Agent 输入、素材库、租约或内部备注；撤销后刷新即拒绝访问。
- [ ] 执行页写明「本机内部资料」；至少一类导出文件件数与画布一致。
- [ ] 左轨布置 → 评审 → 执行来回切换，画布物料、选中与撤销栈不被清空。
- [ ] 左轨仍三图标；14 键、logo、主按钮「确认布置」未动。
- [ ] 新测试全绿；`tsc --noEmit` 干净；改动文件 eslint 0 error。
- [ ] 真机（`127.0.0.1:3026/editor`）跑一遍：评审页两条出口 → 参考填入 → 改一字 → 生成 → 切换执行 → 导出 → 切回布置；证据写进 `docs/T-04-SELF-CHECK.md`。

---

## 7. 自测命令

```bash
cd frontend
npx vitest run components/room-organizer/lib/review-copy.test.ts \
  components/room-organizer/panels/project-review-panel.react.test.tsx \
  components/room-organizer/panels/agent-panel.react.test.tsx \
  components/room-organizer/panels/cloud-panel.react.test.tsx \
  components/room-organizer/panels/creative-studio.react.test.tsx \
  components/business/publication-panel.react.test.tsx \
  app/view/page.react.test.tsx
npx tsc --noEmit
npx eslint components/room-organizer/lib/review-copy.ts \
  components/room-organizer/lib/review-copy.test.ts \
  frontend/lib/project-review-workflow.ts \
  components/room-organizer/panels/project-review-panel.tsx \
  components/room-organizer/panels/project-review-panel.react.test.tsx \
  components/room-organizer/panels/agent-panel.tsx \
  components/room-organizer/panels/agent-panel.react.test.tsx \
  components/room-organizer/panels/cloud-panel.tsx \
  components/room-organizer/panels/cloud-panel.react.test.tsx \
  components/room-organizer/panels/creative-studio.tsx \
  components/room-organizer/panels/creative-studio.react.test.tsx \
  components/room-organizer/room-organizer.tsx \
  components/room-organizer/panels/scene-delivery-panel.tsx \
  components/business/publication-panel.tsx \
  app/view/page.react.test.tsx
```

---

## 8. 交付纪律

- 未 commit、未 push、未部署、未开 PR；合入只由人。
- 只改 §3 列出的路径；发现蓝图与代码现状不符就停手标「待核」，不静默扩 scope。
- 做完先按 §6 自测，把结果写进 `docs/T-04-SELF-CHECK.md`，再向用户报告并停等验收。
- T-03 仍在等用户验收，本卡不重开 T-03 的行为；14 键与座位数算法仍挂下一轮。

版本 2026-10-26 · 用户点名 T-04 后开卡 · 实现 AI 只改本卡 In 列表。
