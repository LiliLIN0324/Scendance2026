import { DEFAULT_ROOF } from '@/components/room-organizer/lib/constants';
import type { FurnitureItem, RoomLayout } from '@/components/room-organizer/lib/types';

export const steps = [
  { title: '项目与场地', detail: '先认清园区边界' },
  { title: '空间布局', detail: '给展陈和设施定位' },
  { title: '布展排程', detail: '按批次与时段进场' },
  { title: '变更演练', detail: '比对方案并确认' },
  { title: '分岗交接', detail: '交付带版本的图和待办' },
] as const;

export const nodes = [
  {
    id: 'A01', name: '品种菊长廊', kind: '品种陈列', x: 198, y: 181,
    width: 12, depth: 5, color: '#b2883e', count: 24, batch: 'CH-01', material: '白色品种菊',
    slot: '07:20–07:50', team: '园艺组', task: '按品种摆盆并核对铭牌',
  },
  {
    id: 'B02', name: '层叠菊台', kind: '菊艺装置', x: 381, y: 267,
    width: 10, depth: 8, color: '#d6a747', count: 36, batch: 'CH-02', material: '金黄色小菊',
    slot: '07:50–08:30', team: '制作组', task: '核对台座、分层摆盆并点验',
  },
  {
    id: 'C03', name: '苔径微园', kind: '微花园', x: 554, y: 154,
    width: 9, depth: 7, color: '#a27086', count: 18, batch: 'CH-03', material: '紫红色地被菊',
    slot: '08:30–09:00', team: '园艺组', task: '完成花境收边并清空通行边界',
  },
] as const;

export type NodeId = (typeof nodes)[number]['id'];
export type Exhibit = (typeof nodes)[number];
export type Version = 'A' | 'B';

export const garden = { width: 720, height: 460 };
export const guidePoints = [[111, 371], [167, 277]] as const;
export const stockPoint = [550, 346] as const;
export const path = [[79, 409], [128, 341], [177, 286], [252, 246], [329, 220], [411, 211], [491, 202], [551, 231], [629, 218], [653, 173]];
export const detour = [[177, 286], [174, 236], [219, 215], [269, 158], [358, 137], [433, 156], [491, 202]];
export const trees = [
  [91, 157, 16], [109, 123, 21], [133, 96, 15], [162, 103, 11], [209, 91, 14], [245, 89, 16],
  [285, 79, 10], [422, 83, 15], [450, 105, 11], [485, 87, 19], [548, 83, 12], [584, 88, 15], [620, 110, 17],
  [69, 193, 13], [88, 223, 17], [102, 258, 13], [68, 304, 15], [89, 335, 14],
  [148, 369, 12], [177, 382, 20], [210, 397, 15], [246, 400, 11], [311, 394, 14], [341, 397, 19],
  [472, 390, 16], [502, 401, 13], [595, 391, 17], [626, 370, 20], [643, 328, 16], [655, 298, 11],
  [647, 137, 11], [611, 272, 12], [503, 268, 11], [297, 275, 12], [135, 197, 9],
];
export const flowers = [
  [[-44, -14], [-22, -14], [0, -14], [22, -14], [44, -14], [-44, 14], [-22, 14], [0, 14], [22, 14], [44, 14]],
  [[-30, 15], [-15, 21], [0, 23], [15, 21], [30, 15], [-22, -1], [-9, 4], [9, 4], [22, -1], [-12, -16], [0, -13], [12, -16]],
  [[-28, 15], [-16, 21], [0, 17], [21, 13], [26, -1], [13, -12], [-1, -15], [-15, -7], [-28, 1]],
];

export const change = {
  node: nodes[1],
  reserve: 'CH-04',
  quantity: 12,
  evidence: ['展期第 2 天 07:15 巡检单 · B02 前沿 12 盆积水倒伏', '07:20 库存点验单 · 备花点有同色系 CH-04 共 12 盆'],
  checks: '园艺组核对同色系、盆径和花期，现场组核对北侧支路可通行，导览组核对入口告示。',
  suggestion: '用 CH-04 替换 B02 前沿的 12 盆。作业期间暂时跳过 B02，从北侧支路去 C03，等现场复核后恢复原路线。',
};

export const handoffs = [
  { name: '园艺组', sheet: '花材与养护图', tasks: ['07:30 点验 CH-04 的 12 盆，核对盆径与花期。', '07:50 替换 B02 前沿 12 盆，撤下的 CH-02 送回备花点隔离。', '08:10 复核株况、排水和摆位，向现场组回报。'] },
  { name: '现场组', sheet: '作业边界与通行图', tasks: ['07:40 在 B02 两侧布置围挡和临时导视，检查北侧支路。', '08:10 接收园艺组复核，巡查通行净宽及地面。', '确认现场可开放后拆除围挡，并通知导览组。'] },
  { name: '导览组', sheet: '临时导览图', tasks: ['收到作业通知后更新南入口导览牌和志愿者口径。', '作业期间引导游客从 A01 走北侧支路直达 C03，暂跳过 B02。', '收到现场组开放确认后恢复经 B02 的原线路。'] },
] as const;

function item(id: string, name: string, type: string, x: number, y: number, width: number, depth: number, height: number, color: string, rotation = 0): FurnitureItem {
  return { id, name, type, width, depth, height, color, rotation, icon: '', position: { x: (x - garden.width / 2) / 10, z: (y - garden.height / 2) / 10 } };
}

export function gardenLayout(guideMoved: boolean): RoomLayout {
  const routes = [path, detour].flatMap((line, route) => line.slice(1).map(([x, y], index) => {
    const [startX, startY] = line[index];
    return item(`road-${route}-${index}`, route === 0 ? '主园路' : '北侧支路', 'backdrop',
      (startX + x) / 2, (startY + y) / 2, Math.hypot(x - startX, y - startY) / 10 + 0.8,
      route === 0 ? 2.4 : 1.7, 0.04, '#eee4cb', -Math.atan2(y - startY, x - startX));
  }));
  const exhibits = nodes.flatMap((node, index) => [
    item(node.id, node.name, 'rug', node.x, node.y, node.width, node.depth, 0.05, '#897e68'),
    ...flowers[index].map(([x, y], cluster) => item(`${node.id}-${cluster}`,
      node.batch, 'flowerpot', node.x + x, node.y + y, 1.15, 1.15, 0.8, node.color)),
  ]);
  const [guideX, guideY] = guidePoints[Number(guideMoved)];
  return {
    name: '秋圃示范园 · 布置示意', width: garden.width / 10, height: garden.height / 10,
    floorPlanOpacity: 0, roof: DEFAULT_ROOF,
    floors: [{
      id: 'garden', name: '秋圃示范园', height: 2.5, floorColor: '#b3bd91', floorPattern: 'solid',
      hiddenWalls: ['north', 'south', 'east', 'west'],
      items: [
        ...routes, ...exhibits,
        ...trees.map(([x, y, radius], index) => item(`tree-${index}`, '园区乔木', 'tree', x, y, radius / 5, radius / 5, radius / 3, '#87a77c')),
        item('pond', '水生花境', 'pool', 348, 325, 27, 6.4, 0.1, '#719e9a'),
        item('gate', '南入口标记', 'backdrop', 79, 409, 3.2, 0.6, 2.8, '#637551', -0.6),
        item('stock', '备花点', 'table', ...stockPoint, 8, 5.6, 1.3, '#e3d9b7'),
        item('guide', '临时导视', 'backdrop', guideX, guideY, 1.2, 0.5, 1.7, '#52798b'),
      ],
    }],
  };
}
