/**
 * 材质语言入口解析（2026-11-17）。
 *
 * 支持的说法：
 * - 「把这几个改成金属」→ 作用域 = 当前选中集
 * - 「全部换深木」/「所有椅子改浅木」→ 作用域 = 全案 / 按类型
 * - 「这一片的木色都调深」→ 作用域 = 全案（区域选择留到下一步）
 *
 * 只认明确的材质词；不认识就返回 null，交给布置解析或提示，不猜。
 */

export type MaterialScope = 'selection' | 'all' | 'type';

export interface MaterialCommand {
  preset: string;
  scope: MaterialScope;
  /** scope=type 时的类型词（如「椅」「桌」），其它为 null。 */
  typeWord: string | null;
}

const PRESET_WORDS: ReadonlyArray<[RegExp, string]> = [
  [/拉丝钢|不锈钢/, 'steel'],
  [/黑金属|金属|铁艺/, 'metal'],
  [/深木|胡桃|深色木/, 'walnut'],
  [/浅木|原木|橡木/, 'oak'],
  [/布艺|织物|绒/, 'fabric'],
  [/玻璃/, 'glass'],
  [/恢复原样|原样|还原/, 'original'],
];

const TYPE_WORDS = /(椅|凳|桌|台|摊|架|柜)/;

/** 是否是「改材质」语气；避免把「要 30 把椅子」误判成材质命令。 */
const MATERIAL_VERB = /改|换|调|变成|做成|统一|全部|所有|都/;

export function parseMaterialCommand(text: string): MaterialCommand | null {
  const source = text.trim();
  if (!source) return null;
  const preset = PRESET_WORDS.find(([pattern]) => pattern.test(source))?.[1] ?? null;
  if (!preset) return null;
  if (!MATERIAL_VERB.test(source)) return null;
  const type = TYPE_WORDS.exec(source)?.[1] ?? null;
  const all = /全部|所有|都|整场|全案/.test(source);
  const scope: MaterialScope = type ? 'type' : all ? 'all' : 'selection';
  return { preset, scope, typeWord: type };
}

/** 作用域文案（回执用）。 */
export function materialScopeLabel(command: MaterialCommand): string {
  if (command.scope === 'all') return '全案';
  if (command.scope === 'type') return `所有${command.typeWord ?? '同类'}物件`;
  return '选中物件';
}
