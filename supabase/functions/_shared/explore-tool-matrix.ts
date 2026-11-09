/**
 * 当前 main 上活动 Agent 的工具矩阵快照。
 * 按用户要完成的事组织，不按模型内部阶段名组织。
 * 这里的“声明”只表示 agent-runner 的 schemas 里有这个工具；
 * 不表示线上已打开、真实模型已调用，或现场可用。
 * 本文件不导入 runner，避免把案例模块接进云端执行路径。
 */

export const MODEL_TOOL_NAMES = [
  'get_scene',
  'search_resources',
  'search_places',
  'inspect_zone',
  'prepare_seating_candidate',
  'prepare_shared_seating_candidate',
  'find_free_areas',
  'create_parametric_model',
  'inspect_materials',
  'customize_material',
  'validate_candidate',
  'submit_candidates',
  'get_bom',
  'start_lux3d_model',
] as const;

export type ModelToolName = (typeof MODEL_TOOL_NAMES)[number];

/** 界面动作。可以和 Agent 共用命令，但不是模型工具。 */
export const WORKSPACE_ACTIONS = [
  { id: 'open_material_library', entry: '物料', label: '打开物料库' },
  { id: 'open_space', entry: '空间', label: '打开空间' },
  { id: 'open_review', entry: '审校协作', label: '打开审校' },
  { id: 'undo', entry: '活动 Agent', label: '撤销' },
  { id: 'confirm_preview', entry: '活动 Agent', label: '确认预览' },
] as const;

export type WorkspaceActionId = (typeof WORKSPACE_ACTIONS)[number]['id'];

export const PRODUCT_ENTRIES = [
  { id: 'activity_agent', label: '活动 Agent', ownsAgent: true },
  { id: 'review', label: '审校协作', ownsAgent: false },
  { id: 'space', label: '空间', ownsAgent: false },
  { id: 'materials', label: '物料', ownsAgent: false },
] as const;

/** 历史固定对抗集。当前 main 没有这套评测，也不能在本模块里打开。 */
export const V2_ADVERSARIAL_HISTORY = {
  items: 7,
  failures: 6,
  defaultEnabled: false,
  presentOnMain: false,
} as const;

export type ToolGate =
  | { availability: 'declared' }
  | { availability: 'default_off'; gate: 'AGENT_PLACE_SEARCH_ENABLED' }
  | { availability: 'config_gated'; gate: 'LUX3D_API_KEY' };

export type UserTaskRow = {
  task: string;
  entry: (typeof PRODUCT_ENTRIES)[number]['label'];
  tools: readonly ModelToolName[];
  notModelTools: readonly WorkspaceActionId[];
  boundary: string;
  gate: ToolGate;
};

export const USER_TASK_MATRIX: readonly UserTaskRow[] = [
  {
    task: '从模糊想法接着往下做，不先填专业表单',
    entry: '活动 Agent',
    tools: [],
    notModelTools: [],
    boundary: '先保留原话、未知项和建议。产品只有这一个活动 Agent。',
    gate: { availability: 'declared' },
  },
  {
    task: '看现在的数字场地',
    entry: '空间',
    tools: ['get_scene', 'inspect_zone'],
    notModelTools: ['open_space'],
    boundary: '读到的是本次数字快照。不是实测图纸，也不能证明现场没有门。',
    gate: { availability: 'declared' },
  },
  {
    task: '找一块可能放得下的位置',
    entry: '空间',
    tools: ['find_free_areas'],
    notModelTools: [],
    boundary: '只给几何候选。不证明连续通行、消防或现场条件。',
    gate: { availability: 'declared' },
  },
  {
    task: '查数字模型',
    entry: '物料',
    tools: ['search_resources', 'inspect_materials'],
    notModelTools: ['open_material_library'],
    boundary: '模型名录和标称尺寸不是实物库存、价格或档期。',
    gate: { availability: 'declared' },
  },
  {
    task: '统计场景里已经摆上的物件',
    entry: '物料',
    tools: ['get_bom'],
    notModelTools: [],
    boundary: '统计数字物件。不能把它说成已核验库存。',
    gate: { availability: 'declared' },
  },
  {
    task: '试排座位',
    entry: '活动 Agent',
    tools: ['prepare_seating_candidate', 'prepare_shared_seating_candidate'],
    notModelTools: [],
    boundary: '一人一桌、每桌两人是不同工具。讲座不会自动变成课桌式；人数未明确时不能调用双人桌。',
    gate: { availability: 'declared' },
  },
  {
    task: '检查候选',
    entry: '审校协作',
    tools: ['validate_candidate'],
    notModelTools: ['open_review'],
    boundary: 'valid 只覆盖候选构建和部分几何。不是消防、疏散或无障碍通过。',
    gate: { availability: 'declared' },
  },
  {
    task: '交出预览',
    entry: '活动 Agent',
    tools: ['submit_candidates'],
    notModelTools: ['confirm_preview', 'undo'],
    boundary: '提交是预览。确认和撤销走共享命令，确认按钮本身不是模型工具。',
    gate: { availability: 'declared' },
  },
  {
    task: '查地点名称',
    entry: '空间',
    tools: ['search_places'],
    notModelTools: [],
    boundary: '默认关闭。地点结果不能证明可租、容量、价格、档期或室内平面。',
    gate: { availability: 'default_off', gate: 'AGENT_PLACE_SEARCH_ENABLED' },
  },
  {
    task: '做一件新的数字模型',
    entry: '物料',
    tools: ['create_parametric_model', 'customize_material', 'start_lux3d_model'],
    notModelTools: [],
    boundary: '参数化限于六类并会写入资源。材质副本不直接改场景。Aholo 需配置、可能收费、异步，生成物不是实物。',
    gate: { availability: 'config_gated', gate: 'LUX3D_API_KEY' },
  },
];

export const MATERIAL_PATHS = [
  {
    id: 'library',
    label: '物料库',
    modelTool: 'search_resources' as ModelToolName | null,
    writes: false,
    latency: '只读查询',
    availability: '有授权的数字目录才查得到',
    physicalObject: false as const,
  },
  {
    id: 'parametric',
    label: '参数化',
    modelTool: 'create_parametric_model' as ModelToolName | null,
    writes: true,
    latency: '会创建资源，不是即时摆进现场',
    availability: '仅桌、椅凳、柜台、台座、背景板、柜',
    physicalObject: false as const,
  },
  {
    id: 'import',
    label: '导入',
    modelTool: null,
    writes: true,
    latency: '取决于用户提供的文件',
    availability: '用户自己的导入入口，不暴露成模型工具',
    physicalObject: false as const,
  },
  {
    id: 'aholo',
    label: 'Aholo 生成',
    modelTool: 'start_lux3d_model' as ModelToolName | null,
    writes: true,
    latency: '异步，大约数分钟，可能收费',
    availability: '配置就绪才出现在可选工具里；默认不在基础工具列表',
    physicalObject: false as const,
  },
] as const;

const workspaceIds = new Set<string>(WORKSPACE_ACTIONS.map(action => action.id));

export function classifyInvocation(name: string):
  | { ok: false; code: 'NOT_A_MODEL_TOOL' | 'UNKNOWN_TOOL' | 'CONFIG_GATED' }
  | { ok: true; code: 'DECLARED_TOOL'; tool: ModelToolName } {
  if (workspaceIds.has(name)) return { ok: false, code: 'NOT_A_MODEL_TOOL' };
  if (!(MODEL_TOOL_NAMES as readonly string[]).includes(name)) return { ok: false, code: 'UNKNOWN_TOOL' };
  if (name === 'search_places' || name === 'start_lux3d_model') return { ok: false, code: 'CONFIG_GATED' };
  return { ok: true, code: 'DECLARED_TOOL', tool: name as ModelToolName };
}

/**
 * 建议标签不能靠本模块打开。
 * 即便调用方声称对抗集已经复现通过，这里也没有产品开关可以拨。
 */
export function suggestionChannel(input: {
  requested: boolean;
  reproduction?: { items: number; failures: number; rerunOnCurrentMain: boolean };
}): { enabled: false; reason: 'default_off' | 'reproduce_before_enable' | 'case_harness_cannot_ship_v2'; history: typeof V2_ADVERSARIAL_HISTORY } {
  if (!input.requested) return { enabled: false, reason: 'default_off', history: V2_ADVERSARIAL_HISTORY };
  const reproduced = input.reproduction?.rerunOnCurrentMain === true
    && input.reproduction.items === V2_ADVERSARIAL_HISTORY.items
    && input.reproduction.failures === 0;
  if (!reproduced) return { enabled: false, reason: 'reproduce_before_enable', history: V2_ADVERSARIAL_HISTORY };
  return { enabled: false, reason: 'case_harness_cannot_ship_v2', history: V2_ADVERSARIAL_HISTORY };
}
