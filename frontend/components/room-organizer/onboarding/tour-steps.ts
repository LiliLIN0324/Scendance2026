/**
 * 新手引导的内容与航线（2026-11-20）。
 *
 * 内容和引擎分开：引擎只认「步骤 + 选择器 + 文案」，改文案不用碰定位逻辑。
 * 每个 target 都是真实控件（`data-tour` 属性或既有稳定 id / aria-label），
 * 不指向容器里的坐标——布局一改，坐标就骗人。
 *
 * 引导只指路，不替用户点：发送、确认、发布这些动作会真的落到方案和云端，
 * 回放式自动点按在生成链路上还会触发任务与额度。这里一律只高亮 + 讲一句。
 */

import type { TourId } from './onboarding-state';

/** 现场信号：哪一步该出现、哪一步该跳过。 */
export type StepSignal = { key: 'hasBoundary' | 'hasItems'; equals: boolean };

export interface TourStep {
  id: string;
  title: string;
  body: string;
  /** CSS 选择器；null = 居中卡片，不指控件（例如「放错了怎么退」本来就没有按钮可指）。 */
  target: string | null;
  /** 最后一步的主按钮文案（默认「知道了」）；中间步骤一律「下一步」。 */
  cta?: string;
  /** 现场不满足时不出现（例如还没有物件就不讲「已放置清单」）。 */
  showWhen?: StepSignal;
}

/** 控件的稳定锚点。改选择器前先确认这些标记还在。 */
export const TOUR_ANCHORS = {
  canvas: '[data-testid="outdoor-overlay"]',
  chatInput: '[data-tour="chat-input"]',
  taskCard: '[data-testid="outdoor-workflow-card"]',
  viewToggle: '#tool-view-toggle',
  publish: '[data-tour="publish"]',
  outdoorNav: '[data-tour="nav-outdoor"]',
  materialNav: '[data-tour="nav-material"]',
  shelf: '[aria-label="物料库"]',
} as const;

const STEPS: Record<string, TourStep> = {
  site: {
    id: 'site',
    title: '这是你的场地',
    body: '底图是真地图瓦片，红实线是你圈的活动范围。拖动平移、滚轮缩放；左上方能直接搜地点。',
    target: TOUR_ANCHORS.canvas,
  },
  ask: {
    id: 'ask',
    title: '先说清要办什么',
    body: '跟助手说活动类型、人数和大概范围，比如「湖边 80 人婚礼，仪式区 20×12 米」。它先给候选，不直接改你的图。',
    target: TOUR_ANCHORS.chatInput,
  },
  scope: {
    id: 'scope',
    title: '范围先核对，再往下排',
    body: '助手框的范围只是候选，点「确认并应用」才写进方案；不贴合就拖顶点改，改完重新核对一次。',
    target: TOUR_ANCHORS.taskCard,
  },
  view3d: {
    id: 'view3d',
    title: '2D 排布，3D 看效果',
    body: '右下工具簇那颗圆钮在平面和立体之间切，镜头和物料都留着；3D 里也能接着改。',
    target: TOUR_ANCHORS.viewToggle,
  },
  publish: {
    id: 'publish',
    title: '发布一版给客户',
    body: '发布生成只读链接和二维码，锁定的是这一版；之后继续改，不影响已经发出去的链接。',
    target: TOUR_ANCHORS.publish,
    cta: '知道了',
  },
  export: {
    id: 'export',
    title: '导出给执行',
    body: '同一张菜单里导出物料清单、平面图和交接包，按需要勾；导出前会再确认一次。',
    target: TOUR_ANCHORS.publish,
    cta: '知道了',
  },
  canvasGesture: {
    id: 'canvasGesture',
    title: '这块画布怎么用',
    body: '按住空白处拖动平移、滚轮缩放；画分区或红线时双击就是收笔闭合。Esc 随时结束当前这一笔。',
    target: TOUR_ANCHORS.canvas,
  },
  outdoorPanel: {
    id: 'outdoorPanel',
    title: '左栏是物件库和清单',
    body: '点左轨「户外规划」，左栏一张卡三个页签：「添加物件」点一行就带上对应工具，「已放置物件」是清单树、点击定位、右键删除，「清单」看这份活动的台账。实景扫描、示例场地和案例在左轨「空间」。',
    target: TOUR_ANCHORS.outdoorNav,
  },
  draw: {
    id: 'draw',
    title: '到画布动手',
    body: '分区左键加点、双击闭合；设施单击就放，拖角改尺寸、圆柄旋转。放错 Ctrl+Z 撤销。',
    target: TOUR_ANCHORS.canvas,
    cta: '知道了',
  },
  shelfEntry: {
    id: 'shelfEntry',
    title: '物料在左轨这颗钮',
    body: '点「物料」开物料库：库里的东西按分组排，点一件进「待放置」，再到画布上点哪放哪。本机桌面的 GLB 直接拖进来也行。',
    target: TOUR_ANCHORS.materialNav,
  },
  shelf: {
    id: 'shelf',
    title: '这一栏就是物料库',
    body: '点一件进「待放置」，回到画布点哪儿放哪儿；R 转方向、Shift+R 反手，Esc 取消这次放置。',
    target: TOUR_ANCHORS.shelf,
  },
  placed: {
    id: 'placed',
    title: '放下的东西都在清单里',
    body: '「已放置物件」能定位、显隐、锁定、删除；清单跟着这份活动存，刷新不丢。',
    target: TOUR_ANCHORS.outdoorNav,
    cta: '知道了',
    showWhen: { key: 'hasItems', equals: true },
  },
  undo: {
    id: 'undo',
    title: '放错了怎么退',
    body: 'Ctrl+Z 撤销、Ctrl+Shift+Z 重做；助手给的整轮方案没确认前，还能在卡上「撤回预览」。',
    target: null,
    cta: '知道了',
  },
  dragClearance: {
    id: 'dragClearance',
    title: '拖动只是摆位置',
    body: '拖动物件可以调整位置；实际通行空间还需核对——人和车能不能走过去，切 3D 走近看一眼再定。',
    target: TOUR_ANCHORS.canvas,
    cta: '知道了',
  },
};

export interface TourScript {
  id: TourId;
  /** 帮助中心里的标题。 */
  title: string;
  /** 一句话说明这条线覆盖什么。 */
  note: string;
  steps: TourStep[];
  /** 进工作台自动开始（只有首访那条）。 */
  auto?: boolean;
}

export const TOUR_SCRIPTS: TourScript[] = [
  {
    id: 'first-run',
    title: '第一次用：五步走完一遍',
    note: '认场地 → 说需求 → 核对范围 → 切 3D → 发布',
    auto: true,
    steps: [STEPS.site, STEPS.ask, STEPS.scope, STEPS.view3d, STEPS.publish],
  },
  {
    id: 'canvas-basics',
    title: '画布手势与物件库',
    note: '拖拽缩放、左栏三页签、画布上怎么落件',
    steps: [STEPS.canvasGesture, STEPS.outdoorPanel, STEPS.draw],
  },
  {
    id: 'material-shelf',
    title: '物料怎么放上去',
    note: '开物料库、取件落位、清单里管理已放置',
    steps: [STEPS.shelfEntry, STEPS.shelf, STEPS.placed],
  },
  {
    id: 'delivery',
    title: '发出去：客户版与执行版',
    note: '发布只读链接、导出给搭建方',
    steps: [STEPS.publish, STEPS.export],
  },
  {
    id: 'topic-say',
    title: '需求怎么说',
    note: '一句话讲清类型、人数、范围',
    steps: [STEPS.ask],
  },
  {
    id: 'topic-scope',
    title: '范围画错了怎么改',
    note: '拖顶点重画，重新核对',
    steps: [STEPS.scope],
  },
  {
    id: 'topic-undo',
    title: '放错了怎么退',
    note: '撤销、重做、撤回预览',
    steps: [STEPS.undo],
  },
  {
    id: 'topic-place',
    title: '物料怎么落位',
    note: '待放置、点哪放哪',
    steps: [STEPS.shelfEntry, STEPS.shelf],
  },
  {
    id: 'topic-3d',
    title: '2D 和 3D 的关系',
    note: '同一份方案的两个面',
    steps: [STEPS.view3d],
  },
  {
    id: 'topic-share',
    title: '给客户还是给执行',
    note: '只读链接 vs 导出清单',
    steps: [STEPS.export],
  },
  {
    id: 'topic-drag',
    title: '拖动与通行核对',
    note: '摆位置不等于走得过去',
    steps: [STEPS.dragClearance],
  },
];

export function tourScript(id: TourId): TourScript {
  const script = TOUR_SCRIPTS.find(item => item.id === id);
  if (!script) throw new Error(`未登记的引导航线：${id}`);
  return script;
}

/** 首访那条航线（唯一允许自动开始的）。 */
export const FIRST_RUN_TOUR = tourScript('first-run');
