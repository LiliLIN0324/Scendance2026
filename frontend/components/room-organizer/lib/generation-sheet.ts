/**
 * 统一生成面板的状态仓储（2026-11-15 与用户对齐的任务模型）。
 *
 * 为什么要有这一层：生成入口曾经散在四处（轨道拍摄场地、场景库对话快捷、物料星、属性卡三格），
 * 每处各开一个界面，用户看不出「生成给谁」。现在只有一个面板，但入口可以不同——
 * 入口的差别只剩下「打开时预选哪个任务 / 带不带当前设施」，这份差别就存在这里。
 *
 * 三条任务（用户原话）：
 *  - scene-recon：重建真实场地。知道自己要哪个场地，再决定现场拍摄还是上传已有照片/视频；
 *  - scene-new  ：生成新场景。填名称与描述，产出一个虚构空间（室外仍是 Beta）；
 *  - model      ：生成模型。描述或图片生成一件可复用物料；带 facility 时表示给这件设施生成。
 *
 * 刻意不做的事：这里不提交、不扣费、不碰 localStorage——它只是「面板开没开、开着哪个任务」。
 */

/** 生成任务。刻意不含「导入 GLB」：导入是模型表单里的一个动作，不是并列任务。 */
export type GenerationTask = 'scene-recon' | 'scene-new' | 'model';

/**
 * 入口来路。面板只有一个，标题与首层选项跟着来路变：
 *  - venue   ：轨道「场地」——重建真实场地 / 生成新场景；
 *  - material：物料栏那颗星——直接进模型表单，结果进模型库；
 *  - facility：画布属性卡——直接进模型表单，结果回填那件设施。
 */
export type GenerationScope = 'venue' | 'material' | 'facility';

/** 模型表单的输入方式；'import' 走本机 GLB，不扣额度，所以主按钮与确认框都另算。 */
export type GenerationModelSource = 'text' | 'image' | 'import';

/** 从属性卡带入的设施目标：结果要回填这件设施。 */
export interface GenerationFacilityTarget {
  id: string;
  name: string;
}

export interface GenerationSheetState {
  open: boolean;
  /** 'choose' = 先问「你想做什么？」；其余 = 直接进对应表单。 */
  task: GenerationTask | 'choose';
  /** 模型表单的预选输入方式（属性卡的「图片生成」「导入 GLB」各自带一项进来）。 */
  source: GenerationModelSource;
  /** 来路：决定卡片标题与首层列哪些任务。 */
  scope: GenerationScope;
  facility: GenerationFacilityTarget | null;
  /** 带进来的描述（对话里点名生成物件时的那句原话）；用户改了就不再回写。 */
  prompt: string;
}

const INITIAL: GenerationSheetState = { open: false, task: 'choose', source: 'text', scope: 'venue', facility: null, prompt: '' };

let state: GenerationSheetState = INITIAL;
const listeners = new Set<() => void>();

function emit(next: GenerationSheetState): void {
  state = next;
  for (const listener of [...listeners]) listener();
}

/**
 * 打开面板。
 * - 不传 task：落到「你想做什么？」的首层；
 * - 传 task + facility：属性卡那条路径，直接进模型表单并显示「用于<设施名>」；
 * - scope：不传时按来路推——带设施=设施、模型任务=物料、其余=场地。
 */
export function openGenerationSheet(init: { task?: GenerationTask | 'choose'; scope?: GenerationScope; facility?: GenerationFacilityTarget | null; source?: GenerationModelSource; prompt?: string } = {}): void {
  const facility = init.facility ?? null;
  emit({
    open: true,
    task: init.task ?? 'choose',
    source: init.source ?? 'text',
    scope: init.scope ?? (facility ? 'facility' : init.task === 'model' ? 'material' : 'venue'),
    facility,
    prompt: init.prompt?.trim() ?? '',
  });
}

export function closeGenerationSheet(): void {
  if (!state.open) return;
  emit(INITIAL);
}

/** 首层选完任务后进入表单：模型任务继续带上设施，其余任务把设施目标清掉（场地不需要回填）。 */
export function chooseGenerationTask(task: GenerationTask): void {
  if (!state.open) return;
  emit({
    ...state,
    task,
    facility: task === 'model' ? state.facility : null,
    scope: task === 'model' ? (state.facility ? 'facility' : 'material') : 'venue',
  });
}

/** 「← 换任务」退回首层：保留来路与设施，别把「给谁生成」丢掉。 */
export function backToGenerationChooser(): void {
  if (!state.open) return;
  emit({ ...state, task: 'choose' });
}

export function subscribeGenerationSheet(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function getGenerationSheetState(): GenerationSheetState {
  return state;
}

/** 首层文案（骨架阶段唯一的可执行出口就是这两三行，先固定下来，方便后面接真提交）。 */
export const GENERATION_TASK_COPY: Record<GenerationTask, { title: string; hint: string }> = {
  'scene-recon': {
    title: '重建真实场地',
    hint: '现场拍摄，或上传已有的照片、视频',
  },
  'scene-new': {
    title: '生成新场景',
    hint: '填场景名称与描述，生成一个虚构空间',
  },
  model: {
    title: '生成模型',
    hint: '描述或图片生成一件物料，保存到模型库',
  },
};

/** 卡片标题随来路变：场地 / 生成物料 / 生成模型。 */
// 2026-11-16 用户指令：场地来路不再叫「生成场地」——这张卡里一半是重建真实场地（拍摄/上传），
// 叫生成只盖住另一半；标题直接对齐轨道那颗钮，就叫「场地」。
export function generationScopeTitle(scope: GenerationScope): string {
  if (scope === 'material') return '生成物料';
  if (scope === 'facility') return '生成模型';
  return '场地';
}

/** 首层列哪些任务：三个任务都在同一张卡里，只是按来路排先后。 */
export function generationTaskList(scope: GenerationScope): GenerationTask[] {
  return scope === 'venue' ? ['scene-recon', 'scene-new', 'model'] : ['model', 'scene-recon', 'scene-new'];
}

/** 卡片标题：选任务前说来路，选定后说这件事本身（否则从物料星进来换了任务，标题还在说物料）。 */
export function generationSheetTitle(state: GenerationSheetState): string {
  if (state.task === 'choose') return generationScopeTitle(state.scope);
  if (state.task === 'model') return state.facility ? '生成模型' : '生成物料';
  return GENERATION_TASK_COPY[state.task].title;
}

/** 主按钮文案随操作变：生成 / 开始重建 / 导入。 */
export function generationPrimaryLabel(task: GenerationTask | 'choose', source: GenerationModelSource = 'text'): string {
  if (task === 'scene-recon') return '开始重建';
  if (task === 'model' && source === 'import') return '导入';
  return '生成';
}

/** 只有真的会创建收费任务的操作才显示扣额度确认：导入 GLB 是本地文件，不扣费。 */
export function generationNeedsCredit(task: GenerationTask | 'choose', source: GenerationModelSource = 'text'): boolean {
  if (task === 'choose') return false;
  if (task === 'model' && source === 'import') return false;
  return true;
}

/** 结果去哪：模型表单里必须写清楚，属性卡进来时还要带上设施名。 */
export function generationTargetLabel(facility: GenerationFacilityTarget | null): string {
  return facility ? `用于「${facility.name}」` : '保存到模型库';
}

export function resetGenerationSheetForTests(): void {
  state = INITIAL;
  listeners.clear();
}
