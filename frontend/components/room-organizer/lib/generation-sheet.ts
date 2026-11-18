/**
 * 统一生成面板的状态仓储（2026-11-15 与用户对齐的任务模型，2026-11-19 收口场地入口）。
 *
 * 为什么要有这一层：生成入口曾经散在四处，每处各开一个界面。现在只有一个面板，
 * 入口的差别只剩下「打开时预选哪个任务 / 哪种输入 / 带不带当前设施」。
 *
 * 任务：
 *  - scene-recon：重建真实场地。创作页第一张卡已开放拍摄/上传并本地预览，这一轮不提交重建；
 *  - model      ：生成模型。描述或图片生成一件可复用物料；带 facility 时表示给这件设施生成。
 *
 * 「生成新场景」已从首层拿掉：创作入口不再提供虚构空间这条任务。
 * 导入 GLB 仍是模型表单里的一个来路（物料 / 设施），不是创作卡片上的并列项。
 *
 * 刻意不做的事：这里不提交、不扣费、不碰 localStorage——它只是「面板开没开、开着哪个任务」。
 */

/** 生成任务。不含「导入 GLB」，也不再含「生成新场景」。 */
export type GenerationTask = 'scene-recon' | 'model';

/**
 * 入口来路。面板只有一个，标题与首层跟着来路变：
 *  - venue   ：轨道「创作」——同一页两张卡片，文生 / 图生在卡片上提交，不另开模型表单；
 *  - material：物料栏——直接进模型表单，结果进「我的生成」；
 *  - facility：画布属性卡——直接进模型表单，结果回填那件设施。
 */
export type GenerationScope = 'venue' | 'material' | 'facility';

/** 模型表单的输入方式；'import' 走本机 GLB，不扣额度，所以主按钮与确认框都另算。场地来路不收 import。 */
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
 * - 不传 task：落到首层；场地来路是文生 / 图生卡片，不是任务行；
 * - 传 task + facility：属性卡那条路径，直接进模型表单并显示「用于<设施名>」；
 * - scope：不传时按来路推——带设施=设施、模型任务=物料、其余=场地。
 * 场地来路不接受导入：import 会被收成文字，导入走物料库「我的物料」。
 */
export function openGenerationSheet(init: { task?: GenerationTask | 'choose'; scope?: GenerationScope; facility?: GenerationFacilityTarget | null; source?: GenerationModelSource; prompt?: string } = {}): void {
  const facility = init.facility ?? null;
  const scope = init.scope ?? (facility ? 'facility' : init.task === 'model' ? 'material' : 'venue');
  const requested = init.source ?? 'text';
  emit({
    open: true,
    task: init.task ?? 'choose',
    source: scope === 'venue' && requested === 'import' ? 'text' : requested,
    scope,
    facility,
    prompt: init.prompt?.trim() ?? '',
  });
}

export function closeGenerationSheet(): void {
  if (!state.open) return;
  emit(INITIAL);
}

/** 首层选完任务后进入表单。场地来路即使记下模型任务，面板仍画两张卡片，不改道去物料首层。 */
export function chooseGenerationTask(task: GenerationTask): void {
  if (!state.open) return;
  const facility = task === 'model' ? state.facility : null;
  const scope: GenerationScope = task === 'model'
    ? (facility ? 'facility' : state.scope === 'venue' ? 'venue' : 'material')
    : state.scope;
  emit({ ...state, task, facility, scope });
}

/** 场地卡片上切换文生 / 图生。只改预选输入，不提交、不勾额度。场地不接受导入。 */
export function setGenerationModelSource(source: GenerationModelSource): void {
  if (!state.open || state.source === source) return;
  if (state.scope === 'venue' && source === 'import') return;
  emit({ ...state, source });
}

/** 「← 返回」退回首层：保留来路、输入方式与设施，别把「给谁生成」丢掉。 */
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

/** 首层文案。模型任务在场地来路不走这张行列表，卡片另画。 */
export const GENERATION_TASK_COPY: Record<GenerationTask, { title: string; hint: string }> = {
  'scene-recon': {
    title: '重建真实场地',
    hint: '拍摄现场，或上传已有的照片、视频。',
  },
  model: {
    title: '生成模型',
    hint: '描述或图片生成一件物料，保存到「我的生成」',
  },
};

/** 卡片标题随来路变：创作 / 生成物料 / 生成模型。 */
export function generationScopeTitle(scope: GenerationScope): string {
  if (scope === 'material') return '生成物料';
  if (scope === 'facility') return '生成模型';
  return '创作';
}

/**
 * 首层任务行。
 * 创作来路用两张卡片，不在这里再列「生成模型」或已删除的「生成新场景」。
 * 物料 / 设施换任务时只留模型，不再把场景任务排回第一层。
 */
export function generationTaskList(scope: GenerationScope): GenerationTask[] {
  return scope === 'venue' ? ['scene-recon'] : ['model'];
}

/** 卡片标题：选任务前说来路；创作里的模型表单按当前输入方式叫文生 / 图生。 */
export function generationSheetTitle(sheet: GenerationSheetState): string {
  if (sheet.scope === 'venue' && (sheet.task === 'choose' || sheet.task === 'scene-recon')) return '创作';
  if (sheet.task === 'choose') return generationScopeTitle(sheet.scope);
  if (sheet.task === 'model') {
    if (sheet.facility) return '生成模型';
    if (sheet.scope === 'venue') return sheet.source === 'image' ? '图生 3D' : '文生 3D';
    return '生成物料';
  }
  return GENERATION_TASK_COPY[sheet.task].title;
}

/** 主按钮文案随操作变：生成 / 导入。重建入口没有单独的提交钮。 */
export function generationPrimaryLabel(task: GenerationTask | 'choose', source: GenerationModelSource = 'text'): string {
  if (task === 'scene-recon') return '拍摄现场';
  if (task === 'model' && source === 'import') return '导入';
  return '生成';
}

/** 只有真的会创建收费任务的操作才显示扣额度确认：导入 GLB 是本地文件，重建入口也不扣费。 */
export function generationNeedsCredit(task: GenerationTask | 'choose', source: GenerationModelSource = 'text'): boolean {
  if (task === 'choose' || task === 'scene-recon') return false;
  if (task === 'model' && source === 'import') return false;
  return true;
}

/** 结果去哪：模型表单里必须写清楚。属性卡进来时带上设施名，其余进物料库「我的生成」。 */
export function generationTargetLabel(facility: GenerationFacilityTarget | null): string {
  return facility ? `用于「${facility.name}」` : '保存到「我的生成」';
}

export function resetGenerationSheetForTests(): void {
  state = INITIAL;
  listeners.clear();
}
