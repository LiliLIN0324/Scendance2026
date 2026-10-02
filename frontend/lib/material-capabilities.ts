import { catalog } from "../../supabase/functions/_shared/domain";

export type BuiltinMaterialId = (typeof catalog)[number]["id"];
export type MaterialRequirementStatus = "supported" | "missing" | "needs-confirmation" | "excluded";
export interface MaterialSuggestion {
  materialId: BuiltinMaterialId;
  name: string;
  reason: string;
  requiresUserConsent: true;
}
export interface MaterialRequirementFinding {
  key: string;
  label: string;
  status: MaterialRequirementStatus;
  availability: "available" | "unavailable";
  matches: string[];
  evidence: string[];
  message: string;
  /** Present only for an actual built-in catalog entry, never for missing variants. */
  materialId?: BuiltinMaterialId;
  catalogSize?: { width: number; depth: number; height: number };
  suggestions: MaterialSuggestion[];
}
export interface MaterialCapabilityInspection {
  supported: MaterialRequirementFinding[];
  missing: MaterialRequirementFinding[];
  needsConfirmation: MaterialRequirementFinding[];
  excluded: MaterialRequirementFinding[];
  /** Uncovered text, not a claim that a semantic parser identified an asset. */
  unrecognized: string[];
  requiresConfirmation: boolean;
  notice: string;
}

interface MaterialRule {
  key: string;
  label: string;
  pattern: RegExp;
  materialId?: BuiltinMaterialId;
  suggestionId?: BuiltinMaterialId;
}
interface Occurrence {
  rule: MaterialRule;
  match: string;
  start: number;
  end: number;
  clause: string;
  intent: "required" | "uncertain" | "excluded";
  specification: boolean;
}

// Missing shape-specific assets have priority over a shorter generic noun such
// as 桌子. This table does not introduce scene IDs or fabricated cloud assets.
const missingRules: MaterialRule[] = [
  { key: "tent", label: "帐篷", pattern: /帐篷|帳篷|帐蓬|帐棚|\btents?\b/giu },
  { key: "canopy", label: "天幕／凉棚", pattern: /天幕|凉棚|涼棚|遮阳棚|遮陽棚|\bcanop(?:y|ies)\b/giu },
  { key: "arch", label: "拱门", pattern: /拱门|拱門|花门|花門|\barch(?:es)?\b/giu },
  { key: "string-lights", label: "串灯／灯带", pattern: /串灯|串燈|灯串|燈串|灯带|燈帶|\b(?:string|fairy)\s+lights?\b/giu },
  { key: "round-table", label: "圆桌", pattern: /圆(?:形)?(?:的)?(?:餐|会议)?桌(?:子)?|圓(?:形)?桌|直径[^，。；,;]{0,12}桌(?:子)?|桌子(?:需要|想要|要|用)?圆(?:形)?(?:的)?|\b(?:round|circular)\s+tables?\b/giu, suggestionId: "table" },
  { key: "stage", label: "舞台", pattern: /舞台|\bstages?\b/giu },
  { key: "sofa", label: "沙发", pattern: /沙发|沙發|\bsofas?\b/giu },
  { key: "lighting-fixture", label: "实体灯具", pattern: /落地灯|吊灯|聚光灯|射灯|台灯|\b(?:floor|pendant|spot)\s*lights?\b/giu },
];
const aliases: Record<BuiltinMaterialId, RegExp> = {
  chair: /椅子|座椅|单椅|單椅|桌椅|\bchairs?\b/giu,
  table: /桌子|(?:长(?:方形)?桌|長桌|方桌|矩形桌|普通桌)(?:子)?|桌椅|\btables?\b/giu,
  reception: /签到台|簽到台|接待台|\breception\b/giu,
  backdrop: /背景板|背景墙|背景牆|\bbackdrops?\b/giu,
  display: /展示架|展架|\bdisplays?\b/giu,
  partition: /隔断|隔斷|屏风|屏風|\bpartitions?\b/giu,
  carpet: /地毯|\bcarpets?\b/giu,
  decoration: /装饰道具|裝飾道具|\bdecorations?\b/giu,
};
const supportedRules: MaterialRule[] = catalog.map(item => ({ key: item.id, label: item.name, materialId: item.id, pattern: aliases[item.id] }));
const notice = "这是对现有八类基础物料的词语检查，不是完整语义理解或库存确认；未识别的要求仍需人工核对，替代物料须经你明确同意。";
const uncertainty = /是否|要不要|需不需要|可选|备选|待定|考虑|考虑中|也许|或许|可能|如果|或者|(?:^|[^如])或|不确定|不一定|不是不|并非不|不能不|不得不|不要没有|无需不|造型|风格|图案|效果图|像.{0,8}一样|.{1}状/u;
const specifications = /(?:\d+(?:\.\d+)?\s*(?:米|厘米|毫米|cm\b|mm\b|m\b))|直径|半径|尺寸|规格|定制|折叠|透明|木质|金属|充气|可伸缩|大型|小型|圆的|方的/iu;

function unique(values: string[]): string[] { return [...new Set(values)]; }

function classifyIntent(clause: string, start: number, end: number, rule: MaterialRule): Occurrence["intent"] {
  // Questions, alternatives and double negations require confirmation. A
  // "round-table discussion" is not proof that a round physical table is needed.
  if (uncertainty.test(clause) || /(?:不要|不需要|无需|不用|不必)(?:移动|删除|去掉|替换|更换|改变|调整|拆除|移除|遮挡)/u.test(clause) ||
      (rule.key === "round-table" && /圆桌(?:讨论|会议|论坛)|round\s+table\s+(?:discussion|meeting)/iu.test(clause))) return "uncertain";
  const before = clause.slice(0, start);
  const after = clause.slice(end).trim();
  const directives = [...before.matchAll(/不需要|不想要|不要|无需|不用|不放|不设置|不设|不搭建|不搭|不使用|不安排|不添加|不必|取消|去掉|省去|去除|不考虑|不打算用|需要|想要|要|安排|增加|加入|放置|摆放|配置|换成|改为/gu)];
  const last = directives.at(-1)?.[0];
  if (last && /^(?:不|无|取消|去掉|省去|去除)/u.test(last)) return "excluded";
  if (/^(?:都|也|暂时)?(?:不要|不需要|无需|不用|取消|不放)(?:了)?$/u.test(after)) return "excluded";
  // A final shared negation also applies to an explicit coordinated list.
  if (/^(?:\s*(?:和|与|及|、)\s*[^，。；]+)?(?:都|均)(?:不要|不需要|无需|不用)(?:了)?$/u.test(after)) return "excluded";
  return "required";
}

function collectOccurrences(clause: string): Occurrence[] {
  const hits: Occurrence[] = [];
  for (const rule of [...missingRules, ...supportedRules]) {
    // Use a fresh RegExp so repeated pure-function calls cannot share lastIndex.
    for (const match of clause.matchAll(new RegExp(rule.pattern.source, rule.pattern.flags))) {
      const start = match.index, end = start + match[0].length;
      const overlap = hits.some(hit => start < hit.end && end > hit.start &&
        !(match[0] === "桌椅" && hit.match === "桌椅" && rule.materialId && hit.rule.materialId));
      if (overlap) continue;
      hits.push({ rule, match: match[0], start, end, clause,
        intent: classifyIntent(clause, start, end, rule), specification: specifications.test(clause) });
    }
  }
  return hits.sort((left, right) => left.start - right.start);
}

function uncoveredText(clause: string, hits: Occurrence[]): string[] {
  // Indexes from RegExp refer to UTF-16; slice spans directly instead of relying
  // on grapheme indexes (emoji can occur before material names).
  let remaining = clause;
  for (const hit of [...hits].sort((left, right) => right.start - left.start)) remaining = remaining.slice(0, hit.start) + " ".repeat(hit.end - hit.start) + remaining.slice(hit.end);
  return remaining.split(/以及|并且|还有|和|与|及|、|\band\b/iu).flatMap(part => {
    const fragment = part.trim();
    const residue = fragment
      .replace(/(?:\d+(?:\.\d+)?|[一二三四五六七八九十百两]+)\s*(?:把|张|个|组|套|件|米|厘米|毫米|m|cm|mm|人)?/giu, "")
      .replace(/(?:请|我们|我|想要|想|需要|不要|无需|不用|不需要|不想要|都|均|不放|不设置|不设|不搭建|不搭|不使用|不安排|不添加|不必|取消|去掉|省去|去除|不考虑|暂时|可以|安排|增加|加入|放置|摆放|配置|换成|改为|使用|放|要|用|些|一些|的|了|在|到|入口|出口|中央|中间|周围|角落|旁边|两侧|场地|活动|会议|布置|方案|左右|前面|后面|大小|尺寸|规格|待定|考虑|也许|或许|可能|如果|是否|可选|备选|不确定|不一定|必需|必须|仅|只|一个|没有|任何|也|还|大型|小型|和|与|及)/gu, "")
      .replace(/[\s\d×xX*.:：()（）\[\]“”"'\-]/gu, "");
    return residue ? [fragment] : [];
  });
}

function describe(rule: MaterialRule, occurrences: Occurrence[]): MaterialRequirementFinding {
  const item = catalog.find(entry => entry.id === rule.materialId);
  const excluded = occurrences.filter(hit => hit.intent === "excluded");
  const active = occurrences.filter(hit => hit.intent !== "excluded");
  const conflicting = excluded.length > 0 && active.length > 0;
  const uncertain = conflicting || active.some(hit => hit.intent === "uncertain" || (item && hit.specification));
  const status: MaterialRequirementStatus = active.length === 0 ? "excluded" : uncertain ? "needs-confirmation" : item ? "supported" : "missing";
  const alternatives = rule.suggestionId ? catalog.filter(entry => entry.id === rule.suggestionId) : [];
  let message: string;
  if (status === "excluded") message = `已识别到明确否定，不把「${rule.label}」计为必需物料。`;
  else if (conflicting) message = `「${rule.label}」同时出现需要与否定或可选表述，请确认是否需要。`;
  else if (status === "needs-confirmation") message = item
    ? `目录有「${item.name}」基础模型，但这句话的意图或具体规格需要确认。`
    : `是否必须使用「${rule.label}」尚不明确；当前内置目录没有对应资产，请确认后再决定补充或替代。`;
  else if (item) message = `目录有「${item.name}」基础模型；这只确认类别，不保证具体款式和规格。`;
  else message = `当前内置目录没有「${rule.label}」对应资产，不能用其他物料默认为已满足。`;
  return { key: rule.key, label: rule.label, status, availability: item ? "available" : "unavailable",
    matches: unique(occurrences.map(hit => hit.match)), evidence: unique(occurrences.map(hit => hit.clause)), message,
    ...(item ? { materialId: item.id, catalogSize: { ...item.size } } : {}),
    suggestions: status === "excluded" ? [] : alternatives.map(entry => ({ materialId: entry.id, name: entry.name,
      reason: `只有明确接受改变「${rule.label}」要求后，才可改选目录中的「${entry.name}」；它不是同款资产。`, requiresUserConsent: true })),
  };
}

/** Pure, conservative catalog preflight. Never mutates scenes, applies proposals or loads assets. */
export function inspectMaterialRequirements(text: string): MaterialCapabilityInspection {
  const clauses = text.normalize("NFKC").split(/[，,。；;\n！？!?]+|但是|不过|而是|但/gu).map(clause => clause.trim()).filter(Boolean);
  const occurrences = clauses.flatMap(collectOccurrences);
  const grouped = new Map<string, Occurrence[]>();
  for (const hit of occurrences) grouped.set(hit.rule.key, [...(grouped.get(hit.rule.key) ?? []), hit]);
  const findings = [...grouped.values()].map(hits => describe(hits[0]!.rule, hits));
  const unrecognized = unique(clauses.flatMap(clause => uncoveredText(clause, occurrences.filter(hit => hit.clause === clause))));
  const supported = findings.filter(finding => finding.status === "supported");
  const missing = findings.filter(finding => finding.status === "missing");
  const needsConfirmation = findings.filter(finding => finding.status === "needs-confirmation");
  const excluded = findings.filter(finding => finding.status === "excluded");
  return { supported, missing, needsConfirmation, excluded, unrecognized,
    requiresConfirmation: missing.length > 0 || needsConfirmation.length > 0 || unrecognized.length > 0, notice };
}
