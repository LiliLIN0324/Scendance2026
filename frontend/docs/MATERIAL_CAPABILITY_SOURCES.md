# 物料能力检查的来源与边界

核对日期：2026-10-02。实现文件为 `frontend/lib/material-capabilities.ts`，测试文件为同目录的 `material-capabilities.test.ts`。

## 来源与许可证

本次阅读了 [TangSY/aedifex 的 ai-catalog-resolver.ts](https://github.com/TangSY/aedifex/blob/main/packages/editor/src/components/ai/ai-catalog-resolver.ts) 和该仓库的 [LICENSE](https://github.com/TangSY/aedifex/blob/main/LICENSE)。其根许可证为 MIT，版权说明列出 2026 Pascal Group Inc. 与 2026 Aedifex Inc.。上述链接指向会变化的 `main` 分支，记录的是本次查阅来源。

借鉴的设计原则是：区分目录中的准确命中、物料变体不匹配和仅可参考的建议，让调用方显式处理不能满足的需求。本项目未复制该文件的代码、物料数据、英文关键词表或评分算法；中文短语检查与结果结构重新编写。没有引入新的外部依赖，也没有复制第三方模型资产。若后续直接移植上游代码或模型，须另行保留相应许可及来源；本页不能替代具体资产授权。

## 唯一能力真源

可用 ID、名称和默认尺寸直接读取 `supabase/functions/_shared/domain.ts` 中的 `catalog`，当前包含椅子、桌子、签到台、背景板、展架、隔断、地毯、装饰道具八类。`supported` 只表示目录内存在基础模型类别，并不确认数量、材质、实际库存、具体外形或施工规格。

帐篷、天幕、拱门、串灯、灯带、圆桌等规则只标出当前内置目录缺项。它们没有 `materialId`，不构造资产 UUID，也不把 `table` 改名为圆桌。用户的私有资产和第三方模型库不在本函数的检查范围。

## 返回结构与 UI 接入

`inspectMaterialRequirements(text)` 返回：

- `supported`：找到真实目录类别。
- `missing`：词语明确指向缺少的类别或变体。
- `needsConfirmation`：存在可选表述、明显矛盾、具体规格或其他已识别的不确定性。
- `excluded`：识别到明确否定，不计为必需物料。
- `unrecognized`：检查规则未覆盖的剩余文字。它不是经过语义理解确认的物料名称，也不能因未识别而当作已满足。
- `requiresConfirmation`：存在缺项、不确定项或未覆盖文字。
- `notice`：供界面说明规则检查的范围。

每条物料结果保留 `matches` 与 `evidence`，便于用户核对原话；仅真实内置物料带有 `materialId` 与复制的 `catalogSize`。`suggestions` 是改变原需求的候选，每项均标记 `requiresUserConsent: true`；没有自动接受替代的路径。

函数为纯检查，不写 scene、不改 proposal、不请求模型，也不自动插入物体。若 UI 允许用户“先生成支持部分”，应明确保留未满足项，不能将这项同意解释为接受具体替代物料。

## 规则的实际限制

检查使用有限的中文短语、几个明确的英文 ID 和显式规则，不是语言模型或通用自然语言解析器。它能处理“不要帐篷”“无需帐篷”和简单列表否定；复杂否定、可选方案、具体规格等保守地要求确认。“圆桌讨论”不能据此认定需要实体圆桌。

未覆盖的表达会保留提示；剩余文字可能包含布局、风格或其他非物料要求，不能自动为其分配物料。需要新增别名或变体时，应同时核对真实目录与模型并补测试，而不是扩大模糊匹配来提高表面命中率。
