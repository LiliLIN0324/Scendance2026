/** Short tool rows for the left chat. Status only: running, done, or error. No arguments. */

export type ToolChipStatus = 'running' | 'done' | 'error';

export interface ToolTraceEvent {
  seq: number;
  tool: string;
  stage: 'started' | 'finished';
  outcome: 'success' | 'failed' | 'unknown' | null;
}

export interface ToolTraceStep {
  toolName: string;
  itemCount?: number;
}

export interface ToolTraceRow {
  id: string;
  name: string;
  status: ToolChipStatus;
  result: string;
}

const TOOL_NAMES: Readonly<Record<string, string>> = {
  get_scene: '读取场景',
  search_resources: '查找物料',
  search_places: '查询地点',
  inspect_zone: '查看局部区域',
  find_free_areas: '寻找可用位置',
  prepare_seating_candidate: '试排课桌椅',
  prepare_shared_seating_candidate: '试排双人桌椅',
  create_parametric_model: '创建参数化模型',
  inspect_materials: '查看材质',
  customize_material: '调整材质',
  validate_candidate: '检查候选',
  submit_candidates: '提交候选',
  get_bom: '统计物料',
  start_lux3d_model: '提交模型生成任务',
  list_items: '查看场地',
  query_region: '查看场地',
  get_map: '查看场地',
  place_item: '摆放物件',
  apply_layout: '摆放物件',
  laybanquet: '摆放物件',
  buildstage: '摆放物件',
  arrangeseating: '摆放物件',
  scatterdecor: '摆放物件',
  set_annotation: '标注规划',
  update_plan: '标注规划',
  audit_settle: '巡场体检',
};

export function toolStatusWord(status: ToolChipStatus): string {
  if (status === 'running') return '进行中';
  if (status === 'done') return '已完成';
  return '未完成';
}

export function toolChipStatus(line: string | null): ToolChipStatus | null {
  if (!line) return null;
  return line.startsWith('已尝试') ? 'error' : 'running';
}

function toolName(tool: string): string {
  return TOOL_NAMES[tool] ?? TOOL_NAMES[tool.toLowerCase()] ?? '处理任务';
}

function eventRow(event: ToolTraceEvent): ToolTraceRow {
  if (event.stage === 'started') {
    return { id: `e-${event.seq}`, name: toolName(event.tool), status: 'running', result: '正在调用工具' };
  }
  if (event.outcome === 'failed') {
    return { id: `e-${event.seq}`, name: toolName(event.tool), status: 'error', result: '工具没有完成' };
  }
  if (event.outcome === 'success') {
    return { id: `e-${event.seq}`, name: toolName(event.tool), status: 'done', result: '工具结果已返回' };
  }
  return { id: `e-${event.seq}`, name: toolName(event.tool), status: 'done', result: '结果待核对' };
}

/** Real receipts first. Observed steps are the fallback, and they do not invent a result. */
export function toolTraceRows(input: {
  isRunning: boolean;
  events: readonly ToolTraceEvent[];
  steps?: readonly ToolTraceStep[];
}): ToolTraceRow[] {
  if (input.events.length) return input.events.map(eventRow);
  const steps = input.steps ?? [];
  return steps.map((step, index) => {
    const last = input.isRunning && index === steps.length - 1;
    const count = typeof step.itemCount === 'number' ? ` · ${step.itemCount} 件` : '';
    return {
      id: `s-${index}-${step.toolName}`,
      name: toolName(step.toolName),
      status: last ? 'running' : 'done',
      result: last ? '正在调用工具' : `已观察到${count}`,
    };
  });
}
