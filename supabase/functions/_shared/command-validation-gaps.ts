/**
 * 对照当前源码，区分「已经守住的校验」和「还能绕过的缺口」。
 * 只读文本，不执行命令，也不把案例编辑器接进房间撤销栈。
 * 产品仍是一个活动 Agent。这里不新增工具，也不打开多 Agent。
 */

export type GapStatus = 'open' | 'closed';

export type ValidationGap = {
  id: string;
  status: GapStatus;
  summary: string;
  guardIntact: boolean;
};

export type GapReport = {
  gaps: ValidationGap[];
  commandOps: string[];
  declaredTools: string[];
};

const COMMAND_OPS = ['add', 'remove', 'move', 'rotate', 'recolor', 'replace', 'add_resource', 'replace_resource'] as const;

export function declaredToolNames(source: string): string[] {
  const start = source.indexOf('const schemas={');
  const end = source.indexOf('const descriptions:', start);
  if (start < 0 || end < 0) throw new Error('找不到 agent-runner 的工具声明');
  const keys: string[] = [];
  let depth = 0;
  let token = '';
  for (let index = source.indexOf('{', start); index < end; index += 1) {
    const char = source[index]!;
    if (char === '{') { depth += 1; if (depth === 1) token = ''; continue; }
    if (char === '}') { depth -= 1; if (depth === 0) break; continue; }
    if (depth !== 1) continue;
    if (/[A-Za-z0-9_]/.test(char)) token += char;
    else if (char === ':' && token) { keys.push(token); token = ''; }
    else if (!/\s/.test(char)) token = '';
  }
  return keys;
}

function slice(source: string, start: string, end: string, label: string): string {
  const from = source.indexOf(start);
  if (from < 0) throw new Error(`缺少锚点 ${label}: ${start}`);
  const to = source.indexOf(end, from + start.length);
  if (to < 0) throw new Error(`缺少结束锚点 ${label}: ${end}`);
  return source.slice(from, to);
}

function commandOps(agentRunner: string, aiSource: string): string[] {
  const line = agentRunner.split('\n').find(item => item.includes('commands格式：'));
  if (!line) throw new Error('找不到命令格式说明');
  const prompted: string[] = [];
  const pattern = /\b(add_resource|replace_resource|recolor|replace|remove|rotate|move|add)\b/g;
  for (const match of line.matchAll(pattern)) prompted.push(match[1]!);
  const schema = [...aiSource.matchAll(/op:\s*z\.literal\('([a-z_]+)'\)/g)].map(match => match[1]!);
  if (prompted.join(',') !== schema.join(',') || prompted.join(',') !== COMMAND_OPS.join(',')) {
    throw new Error(`命令清单不一致：说明=${prompted.join(',')} 结构=${schema.join(',')}`);
  }
  return prompted;
}

function reviewsBeforeAccept(submit: string): boolean {
  const reviewAt = submit.indexOf('reviewAgentCandidate');
  const pushAt = submit.indexOf('valid.push');
  return reviewAt >= 0 && pushAt > reviewAt && !submit.includes("throw new ApiError('CANDIDATE_NOT_VALIDATED'");
}

export function auditValidationGaps(sources: {
  agentRunner: string;
  aiSource: string;
  keyboard: string;
  roomOrganizer: string;
  buildCommand: string;
  catalogPlacement: string;
  creativeStudio: string;
  exploreCase: string;
}): GapReport {
  const ops = commandOps(sources.agentRunner, sources.aiSource);
  const tools = declaredToolNames(sources.agentRunner);
  const legacy = slice(sources.agentRunner, "if(env('DEEPSEEK_AGENT_MODE')==='legacy')", 'const currentResource=(resourceId:string)=>', 'legacy');
  const submit = slice(sources.agentRunner, "else if(name==='submit_candidates')", 'const expected=input.jevEnabled?3:1;', 'submit');
  const drag = slice(sources.roomOrganizer, 'const handleDragEndWithHistory = useCallback(', 'const { lastSavedAt, saving: isSaving', 'drag');
  const remove = slice(sources.roomOrganizer, 'const removeItem = useCallback(', 'const removeSelected = useCallback', 'remove');
  const shortcuts = slice(sources.roomOrganizer, 'const shortcutHandlers = useMemo(', 'useKeyboardShortcuts({', 'shortcuts');
  const confirm = slice(sources.roomOrganizer, 'const onApplyCreative = useCallback(', 'notify(bingoScore.summary', 'confirm');
  const execute = slice(sources.buildCommand, 'export function executeSceneCommand', 'export function applyLayoutCommandWithRefusals', 'execute');
  const keyboardWrites = ['handlers.undo()', 'handlers.redo()', 'handlers.moveItem(', 'handlers.removeItem(', 'handlers.rotateItem(', 'handlers.duplicateItem(', 'handlers.pasteClipboard()'];
  const keyboardBypasses = keyboardWrites.every(token => sources.keyboard.includes(token))
    && !sources.keyboard.includes('executeSceneCommand')
    && !sources.keyboard.includes('validateCommandShape');
  const shortcutBypasses = shortcuts.includes('undo: history.undo')
    && shortcuts.includes('actions.moveItem')
    && shortcuts.includes('actions.removeItem') === false
    && shortcuts.includes('removeItem(')
    && !shortcuts.includes('executeSceneCommand')
    && !shortcuts.includes('validateCommandPreconditions');
  const submitLoose = sources.agentRunner.includes('submit_candidates:z.strictObject({candidates:z.array(z.unknown()).min(1).max(3)})')
    && sources.agentRunner.includes("name==='submit_candidates'?submitToolSchema:schema");
  const unvalidatedOpen = submit.includes('validated:false') && submit.includes('if(valid.length>1)');
  const legacyOpen = legacy.includes('generateProposal') && legacy.includes("call('finish'") && !legacy.includes('validate_candidate');
  const panelPreview = sources.creativeStudio.includes("executionMode:'preview'")
    && !/executionMode\s*===?\s*['"]direct['"]/.test(sources.creativeStudio);
  const confirmGated = confirm.includes('applyLayoutCommandWithRefusals') && confirm.includes('completeLayoutError') && confirm.includes('validateCandidateApply');
  const executeGated = execute.includes('validateCommandShape(cmd)') && execute.includes('validateCommandPreconditions(cmd, ctx)')
    && execute.indexOf('validateCommandShape(cmd)') < execute.indexOf('switch (cmd.kind)');
  const catalogGated = sources.catalogPlacement.includes('executeSceneCommand(placeItemCommand');
  const syntheticSeparate = sources.exploreCase.includes("undo(actor: Actor, channel: 'shared' | 'bypass')")
    && !sources.exploreCase.includes('history.undo');
  const undoNotATool = !tools.includes('undo') && !ops.includes('undo');

  const gaps: ValidationGap[] = [
    {
      id: 'keyboard_edits_skip_command_gate',
      status: keyboardBypasses ? 'open' : 'closed',
      summary: '方向键、删除、旋转、复制、粘贴和 Ctrl+Z 直接调用布局动作，不经过 executeSceneCommand。',
      guardIntact: keyboardWrites.every(token => sources.keyboard.includes(token)),
    },
    {
      id: 'shortcut_handlers_skip_command_gate',
      status: shortcutBypasses ? 'open' : 'closed',
      summary: '房间快捷键处理函数把撤销交给 history.undo，把移动交给 actions.moveItem。',
      guardIntact: shortcuts.includes('undo: history.undo') && shortcuts.includes('actions.moveItem'),
    },
    {
      id: 'drag_end_skips_command_gate',
      status: !drag.includes('executeSceneCommand') && !drag.includes('validateCommandShape') ? 'open' : 'closed',
      summary: '拖放结束只记撤销点并提交手势，不跑命令形状和前置校验。',
      guardIntact: drag.includes('commitHistoryNow();') && drag.includes('handleDragEnd(id);'),
    },
    {
      id: 'remove_skips_command_gate',
      status: !remove.includes('executeSceneCommand') && remove.includes('actions.removeItem(id)') ? 'open' : 'closed',
      summary: '删除走布局动作。锁定物件会直接返回，但没有进入命令门。',
      guardIntact: remove.includes('actions.removeItem(id)') && remove.includes('commitHistoryNow();'),
    },
    {
      id: 'submit_schema_looser_than_advertised',
      status: submitLoose ? 'open' : 'closed',
      summary: '模型看到的提交结构是三种候选之一；运行时先按未知数组接收，再逐项解析。',
      guardIntact: reviewsBeforeAccept(submit),
    },
    {
      id: 'unvalidated_single_candidate_accepted',
      status: unvalidatedOpen ? 'open' : 'closed',
      summary: '没跑过 validate_candidate 的单份候选不会因缺回执被拒绝。多份候选排序时才标 validated:false。',
      guardIntact: reviewsBeforeAccept(submit) && submit.includes("reviewAgentCandidate"),
    },
    {
      id: 'legacy_mode_skips_validate_tool',
      status: legacyOpen ? 'open' : 'closed',
      summary: '兼容模式不走 validate_candidate 工具，直接生成后结束。',
      guardIntact: legacy.includes('reviewAgentCandidate'),
    },
    {
      id: 'synthetic_editor_is_not_room_undo',
      status: syntheticSeparate ? 'open' : 'closed',
      summary: '纵向案例里的共享撤销只存在于案例内存，没有替换房间的 history.undo。',
      guardIntact: syntheticSeparate,
    },
    {
      id: 'confirm_path_uses_layout_command_gate',
      status: confirmGated ? 'closed' : 'open',
      summary: '活动 Agent 的确认落盘走 applyLayoutCommandWithRefusals，失败整份不写入。',
      guardIntact: confirmGated,
    },
    {
      id: 'catalog_place_uses_execute_scene_command',
      status: catalogGated ? 'closed' : 'open',
      summary: '物料落点会先执行场景命令，再看结构冲突。',
      guardIntact: catalogGated,
    },
    {
      id: 'execute_scene_command_checks_shape_and_preconditions',
      status: executeGated ? 'closed' : 'open',
      summary: 'executeSceneCommand 在改布局前同时检查形状和前置条件。',
      guardIntact: executeGated,
    },
    {
      id: 'panel_sends_preview_and_does_not_auto_apply_direct',
      status: panelPreview ? 'closed' : 'open',
      summary: '对话面板固定发送 preview。服务端就算返回 direct，面板源码里也没有按 direct 自动落盘的分支。',
      guardIntact: panelPreview && sources.creativeStudio.includes('applySceneProposal'),
    },
    {
      id: 'undo_and_confirm_are_not_model_tools',
      status: undoNotATool ? 'closed' : 'open',
      summary: '撤销和确认不是模型工具，也不是八种场景命令。',
      guardIntact: undoNotATool && !tools.includes('confirm_preview'),
    },
  ];
  return { gaps, commandOps: ops, declaredTools: tools };
}

export const OPEN_GAP_IDS = [
  'keyboard_edits_skip_command_gate',
  'shortcut_handlers_skip_command_gate',
  'drag_end_skips_command_gate',
  'remove_skips_command_gate',
  'submit_schema_looser_than_advertised',
  'unvalidated_single_candidate_accepted',
  'legacy_mode_skips_validate_tool',
  'synthetic_editor_is_not_room_undo',
] as const;

export const CLOSED_GAP_IDS = [
  'confirm_path_uses_layout_command_gate',
  'catalog_place_uses_execute_scene_command',
  'execute_scene_command_checks_shape_and_preconditions',
  'panel_sends_preview_and_does_not_auto_apply_direct',
  'undo_and_confirm_are_not_model_tools',
] as const;
