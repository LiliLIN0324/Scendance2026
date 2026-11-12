import { installSiteGuide } from './site-guide.mjs';
import { activityCases } from './site-activity-cases.mjs';
import { inspirationCases, inspirationCategories } from './site-inspiration.mjs';
import { activityTypes, activityTypeUrl } from './site-activity-types.mjs';
import { renderCaseAnalysis } from './site-case-analysis.mjs';

const imagery = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer';
export const projects = {
  ...activityCases,
  salt: {
    city: '浙江 · 海宁', name: '盐官潮乐之城 · 签到与接驳试排', title: '游客服务中心周边',
    place: '盐官古城北侧 · 游客服务中心周边',
    tile: [18,218844,107806], frame: [-291.4,-139.7,744.5,452.3],
    cite: '120.536890,30.412482', date: '2025-03-23', resolution: .5,
    intro: '按弦乐艺术节章程练习签到等候、接驳引导和临时导视。图上布置为拟设，实际柜台和上下客点待核。',
    tip: '先从导览图认出游客服务中心周边，再在可辨前场试排。先留通行面，再放导视牌。',
    source: 'https://www.beethovencn.com/page110.html?article_id=121', sourceName: '弦乐艺术节章程',
    reference: '/research/salt/satellite-comparison.html', referenceName: '导览图与真实卫星图对照',
    phases: [
      ['画签到等候区','章程写明 8 月 21–22 日在游客中心签到。先画候选等候面，实际柜台与排队范围待核。','area','拟设 · 签到等候区'],
      ['画接驳引导','章程列签到后接驳到主唱酒店。先画前场步行引导片段，完整接驳行车路线和上下客点待核。','line','拟设 · 接驳步行引导'],
      ['放临时导视','章程提到签到处有艺术节易拉宝。试放一块导视牌并检查与候场及步行线的关系。','item','拟放 · 导视牌'],
      ['留现场核对点','在拟设汇合点标记入口、可用通道与接驳点，等场地资料确认后再调整。','label','待核 · 入口与接驳点'],
    ],
    seeds: [
      {id:'63e48669-48a6-45a1-941e-5a4937c51dc9', kind:'area', name:'拟设 · 签到等候区', points:[[72.83,193.39],[110.76,193.39],[110.76,213.82],[72.83,213.82]]},
      {id:'683f2d0b-e1c1-46fe-abe9-9083bbbefa90', kind:'line', name:'拟设 · 接驳步行引导', points:[[65.53,96.37],[66.99,131.38],[68.45,172.97],[45.83,192.66]]},
      {id:'80e3d3a2-af41-4538-bc57-a2dd342c7f28', kind:'item', name:'拟放 · 导视牌', width:.7, depth:.5, angle:0, points:[[46.56,194.85]]},
      {id:'16bab7b5-7582-487b-9fcd-28799f503903', kind:'label', name:'待核 · 入口与接驳点', points:[[115.87,213.82]]},
    ],
  },
  keqiao: {
    ...inspirationCases.keqiao.map,
    city: '浙江 · 绍兴', name: '绍兴国际会展中心', title: '绍兴国际会展中心',
    place: '绍兴国际会展中心 · 馆外',
    cite: '120.516063,30.104293',
    existingName: '场馆建筑外轮廓',
    intro: '在馆外底图上试排签到、等候与装卸。馆内布置须以当届场馆图为准。',
    tip: '先看建筑轮廓和周边道路，再划出拟设区域，标记需要向主场复核的位置。',
    seeds: [
      {id:'keqiao-queue', kind:'area', name:'拟设 · 等候区', points:[[-113,47],[-69,57],[-76,83],[-119,73]]},
      {id:'keqiao-sign', kind:'item', name:'拟放 · 导视牌', width:1.2, depth:.6, angle:14, points:[[-61,73]]},
    ],
    phases: [
      ['核对场地','在卫星图上辨认馆体和周边道路，再用馆方资料核对入口。','pan',''],
      ['画候选区','分别圈出馆外等候与装卸的候选范围。','area','拟设等候区'],
      ['试放物料','试放导视牌、服务台或隔离设施。','item','拟放 · 导视牌'],
      ['标记待核点','标记需要向场馆确认的位置，写清馆号和图纸版本。','label','待核 · 入口与使用时段'],
    ],
  },
  yuquan: {
    city: '浙江 · 杭州', name: '杭州植物园菊花展', title: '玉泉鱼跃', kicker: '杭州植物园 · 2026 菊花展',
    caption: '沿长廊和池畔布置展台，给赏花和换花留出各自的空间。', place: '玉泉鱼跃 · 鱼乐园长廊',
    date: '2025-04-06', cite: '120.11608,30.25723',
    tile: [19, 437074, 215874], frame: [171, 107, 606, 365],
    existing: [[451, 225], [544, 245], [531, 290], [438, 269]],
    existingName: '玉泉主池可辨水面',
    intro: '以玉泉主池和鱼乐园长廊为参照，试排展台、停留区和换花路线。',
    tip: '先标出临时展台和观众停留区，再画换花路线，查看哪些地方需要现场复尺。',
    phases: [
      ['圈展陈区','沿池畔试圈一块展陈区，把既有水面和园路留出来。','area','拟设展陈区'],
      ['放展台','点地图放下展台，再按需要改尺寸和方向。','item','拟放 · 展台'],
      ['画换花路线','从园路试画一条到展台的换花路线，避开拟设停留区。','line','拟设换花线'],
      ['量待复核距离','选两个可辨地物测距，把需要现场复尺的路段记下来。','measure','待复核距离'],
    ],
    seeds: [
      { id: 'flower-1', kind: 'area', name: '拟展陈区', points: [[448, 282], [514, 297], [510, 312], [445, 298]] },
      { id: 'flower-2', kind: 'item', name: '拟放 · 展台 A', width:3, depth:1.4, angle:12, points: [[474, 296]] },
      { id: 'flower-3', kind: 'line', name: '拟设换花线', points: [[343, 314], [389, 324], [426, 334], [452, 323], [468, 309]] },
      { id: 'flower-4', kind: 'item', name: '拟放 · 导视牌', width:.7, depth:.5, points: [[423, 329]] },
    ],
  },
  waic: {
    city: '上海 · 浦东', name: 'WAIC 2026 布展', title: '上海世博展览馆', kicker: '浦东 · WAIC 2026',
    caption: '从馆外等候区开始，安排观众导视和入口动线。', place: '上海世博展览馆 · 北侧馆外',
    date: '2025-04-07', cite: '121.48548,31.18451',
    tile: [18, 219533, 107150], frame: [-63, 124, 1150, 685],
    existing: [[187, 389], [745, 288], [816, 710], [264, 812]],
    existingName: '世博展览馆 · 可见屋顶',
    intro: '在展览馆北侧试排等候和导视。馆内展位需要对照当届布展图。',
    tip: '先把馆外等候区和导视放到图上，再用当届馆内图核对展位、公共通道及卸货安排。',
    phases: [
      ['圈等候区','在北侧馆外试圈等候范围，避开既有建筑。','area','拟设等候区'],
      ['画入场路线','从拟设等候区画到拟议入口，馆内连接留待当届馆图核对。','line','拟设观众动线'],
      ['放导视牌','在路线转折处试放导视牌，选中后可拖动位置。','item','拟放 · 导视牌'],
      ['标现场核对点','把需要确认的入口、栏杆或通道净宽标在地图上。','label','现场待核'],
    ],
    seeds: [
      { id: 'expo-1', kind: 'area', name: '拟设等候区', points: [[276, 284], [363, 269], [367, 291], [280, 307]] },
      { id: 'expo-2', kind: 'item', name: '拟放 · 导视牌', width:.7, depth:.5, points: [[372, 293]] },
      { id: 'expo-3', kind: 'area', name: '拟设服务区', points: [[456, 276], [500, 269], [506, 287], [462, 294]] },
      { id: 'expo-4', kind: 'line', name: '拟设观众动线', points: [[257, 327], [341, 314], [398, 303], [445, 295], [471, 295]] },
      { id: 'expo-5', kind: 'item', name: '拟放 · 服务台', width:2, depth:.8, angle:345, points: [[486, 283]] },
    ],
  },
};
const heroKeys = ['yuquan','waic'];

// Local paths derived from DataV provincial geometry in the same Web Mercator projection as the locator pins.
const atlasReady = fetch(new URL('./china-locator.json', import.meta.url))
  .then(response => response.ok ? response.json() : null)
  .catch(() => null);

function drawLocator(svg, atlas, active, point) {

  const [x, y, w, h] = atlas.viewBox;
  const grid = svgElement('g', {class:'locator-grid'});
  for (let col = x; col <= x + w; col += 60) grid.append(svgElement('path',{d:`M${col},${y}v${h}`}));
  for (let row = y; row <= y + h; row += 60) grid.append(svgElement('path',{d:`M${x},${row}h${w}`}));
  const regions = atlas.paths.map(([code,d,line]) => svgElement('path', {
    d, class:`locator-region${code === active ? ' locator-active' : ''}${line ? ' locator-islands' : ''}`,
    'fill-rule':'evenodd',
  }));
  const [cx,cy] = point;
  const halo = svgElement('circle',{cx,cy,r:10,class:'locator-halo'});
  const marker = svgElement('circle',{cx,cy,r:4,class:'locator-point'});
  const [left,top] = mapView(4,118.35,32.6,0,0).point;
  const [right,bottom] = mapView(4,122.85,29.05,0,0).point;
  const defs = svgElement('defs',{});
  const rim = svgElement('linearGradient',{id:'locator-rim',x1:'0%',y1:'0%',x2:'100%',y2:'100%'});
  const sheen = svgElement('linearGradient',{id:'locator-sheen',x1:'0%',y1:'0%',x2:'100%',y2:'100%'});
  rim.append(svgElement('stop',{offset:'0%','stop-color':'#f0ffda','stop-opacity':'.93'}),
    svgElement('stop',{offset:'100%','stop-color':'#b5ebd9','stop-opacity':'.25'}));
  sheen.append(svgElement('stop',{offset:'0%','stop-color':'#c5ffd2','stop-opacity':'.22'}),
    svgElement('stop',{offset:'100%','stop-color':'#5d83cf','stop-opacity':'.04'}));
  defs.append(rim,sheen);
  const focusFrame = svgElement('rect',{x:left,y:top,width:right-left,height:bottom-top,rx:5,class:'locator-focus-frame'});
  const depth = svgElement('g', {class:'locator-depth', transform:'translate(0 8)'});
  for (const [code,d,line] of atlas.paths) {
    if (!line) depth.append(svgElement('path',{d,'data-region':code,'fill-rule':'evenodd'}));
  }
  svg.replaceChildren(defs,grid,depth,...regions,focusFrame,halo,marker);
}

const svgNS = 'http://www.w3.org/2000/svg';
const kinds = {area: '区域', line: '路线', label: '标注', item: '物料', measure: '测距'};
const catalog = [
  ['展台', 3, 2], ['帐篷', 3, 3], ['导视牌', 0.7, 0.5],
  ['护栏', 2, 0.45], ['服务台', 2, 0.8], ['花箱', 1.2, 0.5], ['休息座椅', 1.8, 0.6],
];
const earth = 6378137;
function lonLat([x, y], project = current()) {
  const [level, col, row] = project.tile;
  const span = 256 * 2 ** level;
  return [(col * 256 + x) / span * 360 - 180,
    Math.atan(Math.sinh(Math.PI * (1 - 2 * (row * 256 + y) / span))) * 180 / Math.PI];
}
function groundScale(project = current()) {
  return 2 * Math.PI * earth * Math.cos(lonLat(project.frame, project)[1] * Math.PI / 180) / (256 * 2 ** project.tile[0]);
}
function distance(points) {
  return points.slice(1).reduce((sum, [x, y], i) => sum + Math.hypot(x - points[i][0], y - points[i][1]), 0) * groundScale();
}
function areaOf(points) {
  const square = points.reduce((sum, [x,y], i) => {
    const [nx, ny] = points[(i + 1) % points.length];
    return sum + x * ny - y * nx;
  }, 0);
  return Math.abs(square) / 2 * groundScale() ** 2;
}
function mapView(level, lng, lat, width, height) {
  const span = 256 * 2 ** level;
  const x = (lng + 180) / 360 * span;
  const y = (1 - Math.asinh(Math.tan(lat * Math.PI / 180)) / Math.PI) / 2 * span;
  return {tile:[level, 0, 0], frame:[x - width / 2, y - height / 2, width, height], point:[x,y]};
}

function positionTraveler(svg, point, arrival = 1) {
  const matrix = svg.getScreenCTM();
  if (!matrix) return;
  let {x,y} = new DOMPoint(...point).matrixTransform(matrix);
  if (arrival < 1) {
    const dock = document.querySelector('#site-wordmark').getBoundingClientRect();
    x = dock.right+22 + (x-dock.right-22)*arrival;
    y = dock.top+29 + (y-dock.top-29)*arrival - Math.sin(Math.PI*arrival)*12;
  }
  const bounds = hero.getBoundingClientRect();
  const anchor = hero.querySelector('.site-agent-anchor');
  if (!anchor) return;
  anchor.style.left = `${x-bounds.left}px`;
  anchor.style.top = `${y-bounds.top}px`;
}

let travelerHovered = false;

function moveLocatorCamera(svg, start, target, point, previous, turn) {
  svg.setAttribute('viewBox', start.join(' '));
  if (reducedMotion.matches) {
    svg.setAttribute('viewBox', target.join(' '));
    positionTraveler(svg, point);
    return;
  }
  let elapsed = previous ? 0 : -360;
  let lastFrame = performance.now();
  const draw = time => {
    if (turn !== heroRequest) return;
    if (!travelerHovered) elapsed += Math.min(48,time-lastFrame);
    lastFrame = time;
    const amount = Math.max(0, Math.min(1, elapsed / 620));
    const ease = 1 - (1 - amount) ** 3;
    svg.setAttribute('viewBox', start.map((value,index) => value + (target[index]-value)*ease).join(' '));
    const travel = previous ? [previous[0]+(point[0]-previous[0])*ease,
      previous[1]+(point[1]-previous[1])*ease - Math.sin(Math.PI*amount)*11] : point;
    positionTraveler(svg, travel, previous ? 1 : ease);
    if (amount < 1) requestAnimationFrame(draw);
  };
  requestAnimationFrame(draw);
}

function svgElement(tag, attributes) {
  const node = document.createElementNS(svgNS, tag);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
  return node;
}

export function renderImagery(svg, project, frame = project.frame) {
  const [level, col, row] = project.tile;
  const [left, top, width, height] = frame;
  svg.setAttribute('viewBox', frame.join(' '));
  const tiles = [];
  for (let y = Math.floor(top / 256); y < Math.ceil((top + height) / 256); y += 1) {
    for (let x = Math.floor(left / 256); x < Math.ceil((left + width) / 256); x += 1) {
      tiles.push(svgElement('image', {x: x * 256, y: y * 256, width: 256, height: 256,
        href: `${imagery}/tile/${level}/${row + y}/${col + x}`}));
    }
  }
  svg.replaceChildren(...tiles);
}

function labelAt(points) {
  const [x, y] = points.reduce(([sumX, sumY], point) => [sumX + point[0], sumY + point[1]], [0, 0]);
  return [x / points.length, y / points.length];
}

export function drawFeature(feature, selected = false, project = current()) {
  const {id, kind, points, name} = feature;
  const group = svgElement('g', {class: `plan-feature plan-${kind}${selected ? ' selected' : ''}`, 'data-id': id});
  const [x, y] = labelAt(points);
  if (kind === 'area' || kind === 'line' || kind === 'measure' || kind === 'existing') {
    group.append(svgElement(kind === 'line' || kind === 'measure' ? 'polyline' : 'polygon', {points: points.map(point => point.join(',')).join(' ')}));
  } else if (kind === 'item') {
    const width = (feature.width || 1) / groundScale(project);
    const depth = (feature.depth || 1) / groundScale(project);
    group.append(svgElement('rect', {x:x - width/2, y:y - depth/2, width, height:depth, rx:1,
      transform:`rotate(${feature.angle || 0} ${x} ${y})`}));
    group.append(svgElement('circle', {cx:x, cy:y, r:5, class:'site-item-grab'}));
  } else {
    group.append(svgElement('circle', {cx: x, cy: y, r: 3}));
  }
  if (name && (selected || kind === 'existing' || kind === 'label')) {
    const label = svgElement('text', {x, y: y - (kind === 'item' ? 10 : 5), 'text-anchor': 'middle'});
    label.textContent = name;
    group.append(label);
  }
  return group;
}

const hero = document.querySelector('#hero-site-projects');
const section = document.querySelector('#site-cases');
const map = section.querySelector('#site-plan');
const tabs = [...document.querySelectorAll('[data-site-project]')];
const nameField = section.querySelector('#site-feature-name');
const status = section.querySelector('#site-map-status');
const finish = section.querySelector('#site-finish');
const cancel = section.querySelector('#site-cancel');
const remove = section.querySelector('#site-remove');
const move = section.querySelector('#site-move');
const base = map.querySelector('#site-plan-base');
const overlay = map.querySelector('#site-plan-overlays');
const workspace = new Map();
const history = new Map();
const specs = section.querySelector('#site-specs');
const dimension = section.querySelector('#site-dimension');
const undo = section.querySelector('#site-undo');
const copy = section.querySelector('#site-copy');
const sizeFields = ['width','depth','angle'].map(field => section.querySelector('#site-item-' + field));
const hiddenLayers = new Set();
let pan = [0, 0];
let pointer = null;
let skipClick = false;
const mapTiles = new Map();
const minZoom = 0.25;
const rangeFactor = 8;

function remember() {
  const entries = history.get(key) || [];
  entries.push(structuredClone(features()));
  if (entries.length > 40) entries.shift();
  history.set(key, entries);
}
function selectedFeature() {
  return features().find(feature => feature.id === selected);
}
function readSpecs() {
  return {width:Math.max(.2, Math.min(40, Number(sizeFields[0].value) || 1)),
    depth:Math.max(.2, Math.min(40, Number(sizeFields[1].value) || 1)),
    angle:((Number(sizeFields[2].value) || 0) % 360 + 360) % 360};
}
function writeSpecs(feature) {
  sizeFields[0].value = feature.width || 1;
  sizeFields[1].value = feature.depth || 1;
  sizeFields[2].value = feature.angle || 0;
}
function mapPoint(event) {
  const matrix = map.getScreenCTM();
  if (!matrix) return null;
  const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
  return [point.x, point.y];
}
function within([x, y]) {
  const [left, top, width, height] = current().frame;
  return Math.abs(x-left-width/2) <= width*(rangeFactor+2) &&
    Math.abs(y-top-height/2) <= height*(rangeFactor+2);
}
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
let key = 'yuquan';
let mode = '';
let draft = [];
let selected = '';
let heroAt = 0;
let heroRequest = 0;
let lastLocatorPoint;
let zoom = 1;
let mapReady = false;
const incomingTool = new URLSearchParams(location.search).get('tool');
let linkedTool = ['area','line','item','measure'].includes(incomingTool) ? incomingTool : null;
const current = () => projects[key];
const features = () => workspace.get(key);
const modeButtons = [...section.querySelectorAll('[data-mode]')];

function say(text) {
  status.textContent = text;
}

function updateTools() {
  modeButtons.forEach(button => {
    button.disabled = !mapReady;
    button.setAttribute('aria-pressed', String(mode === button.dataset.mode));
  });
  const feature = selectedFeature();
  const hasSelection = Boolean(feature);
  section.querySelector('[data-activity-tool]').disabled = !mapReady;
  undo.disabled = !(history.get(key)?.length);
  copy.disabled = !hasSelection;
  specs.hidden = mode !== 'item' && (Boolean(mode) || feature?.kind !== 'item');
  dimension.textContent = mode === 'area' && draft.length >= 3 ? `约 ${areaOf(draft).toFixed(0)} 平方米` :
    (mode === 'line' || mode === 'measure') && draft.length > 1 ? `约 ${distance(draft).toFixed(1)} 米` :
    feature?.kind === 'area' ? `约 ${areaOf(feature.points).toFixed(0)} 平方米` :
    feature?.kind === 'line' || feature?.kind === 'measure' ? `约 ${distance(feature.points).toFixed(1)} 米` : '';
  move.disabled = !mapReady || !hasSelection;
  remove.disabled = !mapReady || !hasSelection;
  finish.disabled = !mapReady || !['area','line','measure'].includes(mode) || draft.length < (mode === 'area' ? 3 : 2);
  cancel.disabled = !mode;
  map.dataset.tool = mode;
  section.querySelectorAll('#site-catalog button').forEach(button => { button.disabled = !mapReady; });
}

function draw() {
  const available = features();
  const project = current();
  const outlines = project.existingAreas || (project.existing ? [project.existing] : []);
  const existing = outlines.map(points => ({id:'',kind:'existing',name:project.existingName,points}));
  overlay.replaceChildren(...[...existing, ...available]
    .filter(feature => !hiddenLayers.has(feature.kind === 'measure' ? 'line' : feature.kind))
    .map(feature => drawFeature(feature, feature.id === selected)));
  if (draft.length) {
    const drawing = drawFeature({id: '', kind: 'line', name: '', points: draft});
    drawing.classList.add('plan-draft');
    draft.forEach(([x, y]) => drawing.append(svgElement('circle', {cx:x, cy:y, r:3})));
    overlay.append(drawing);
  }
  const roster = section.querySelector('#site-objects');
  roster.replaceChildren(...available.map((feature,index) => {
    const row = document.createElement('li');
    const button = document.createElement('button');
    const number = document.createElement('small');
    button.type = 'button';
    button.dataset.id = feature.id;
    button.setAttribute('aria-pressed', String(feature.id === selected));
    number.textContent = String(index + 1).padStart(2, '0');
    button.append(number, feature.name);
    row.append(button);
    return row;
  }));
  updateTools();
}

function changeMode(next) {
  if (next && !mapReady) return;
  mode = next;
  skipClick = false;
  draft = [];
  const prompts = {
    area: '在图上点至少三个角，再点「完成绘制」。',
    line: '在图上依次点出路线，再点「完成绘制」。',
    label: '输入说明，然后点图上的标注位置。',
    item: '写上要放的物料，再点地图放置。',
    move: '点目标位置，或直接拖动对象。',
    measure: '点两个或更多位置，查看距离。',
    pan: '放大后拖动地图。',
  };
  say(prompts[next] || current().tip);
  draw();
}

function addFeature(kind, points) {
  const id = crypto.randomUUID();
  const name = nameField.value.trim() || kinds[kind];
  remember();
  const feature = {id, kind, name, points, ...(kind === 'item' ? readSpecs() : {})};
  features().push(feature);
  hiddenLayers.delete(kind === 'measure' ? 'line' : kind);
  section.querySelectorAll('#site-layers input').forEach(input => { input.checked = !hiddenLayers.has(input.value); });
  selected = id;
  mode = '';
  draft = [];
  draw();
  say(`已放置「${name}」。可改名、移动或删除。`);
}

function selectFeature(id) {
  const feature = features().find(item => item.id === id);
  selected = feature?.id || '';
  nameField.value = feature?.name || '';
  if (feature?.kind === 'item') writeSpecs(feature);
  draw();
}

function syncMapTiles([x,y,width,height]) {
  const project = current();
  const [baseLevel,col,row] = project.tile;
  const level = Math.max(13, baseLevel + Math.min(0,Math.floor(Math.log2(zoom))));
  const size = 256 * 2 ** (baseLevel-level);
  const originX = col * 256;
  const originY = row * 256;
  const expected = new Set();
  const center = [Math.floor((x+width/2+originX)/size),Math.floor((y+height/2+originY)/size)];
  const centerId = [level,...center].join('/');
  for (let ty=Math.floor((y+originY)/size)-1; ty<=Math.floor((y+height+originY)/size)+1; ty+=1) {
    for (let tx=Math.floor((x+originX)/size)-1; tx<=Math.floor((x+width+originX)/size)+1; tx+=1) {
      const id = [level,tx,ty].join('/');
      expected.add(id);
      if (mapTiles.has(id)) continue;
      const tile = svgElement('image',{x:tx*size-originX,y:ty*size-originY,width:size,height:size,
        href:`${imagery}/tile/${level}/${ty}/${tx}`,'data-level':level});
      mapTiles.set(id,tile);
      tile.addEventListener('load', () => {
        if (mapTiles.get(id)!==tile) return;
        tile.dataset.ready = 'true';
        if (!mapReady) {
          mapReady = true;
          overlay.removeAttribute('visibility');
          updateTools();
          if (linkedTool) {
            const tool = linkedTool;
            linkedTool = null;
            changeMode(tool);
          } else {
            say(project.tip);
          }
        }
      }, {once:true});
      tile.addEventListener('error', () => {
        if (mapTiles.get(id)===tile && !mapReady && id===centerId) say('这里的卫星影像暂不可用。可平移或缩放查看周边。');
      }, {once:true});
      base.append(tile);
    }
  }
  for (const [id,tile] of mapTiles) {
    if (expected.has(id)) continue;
    tile.remove();
    mapTiles.delete(id);
  }
}

function applyFrame() {
  const [x,y,w,h] = current().frame;
  const visibleWidth = w / zoom;
  const visibleHeight = h / zoom;
  const maxX = w * rangeFactor;
  const maxY = h * rangeFactor;
  pan = [Math.max(-maxX,Math.min(maxX,pan[0])),Math.max(-maxY,Math.min(maxY,pan[1]))];
  const frame = [x + (w-visibleWidth)/2 + pan[0],y + (h-visibleHeight)/2 + pan[1],visibleWidth,visibleHeight];
  map.setAttribute('viewBox',frame.join(' '));
  syncMapTiles(frame);
  section.querySelector('#site-zoom-in').disabled = zoom >= 3;
  section.querySelector('#site-zoom-out').disabled = zoom <= minZoom;
}

function showHero(project) {
  const turn = ++heroRequest;
  const layer = document.querySelector('#hero-site-image');
  const mini = hero.querySelector('svg');
  const [lng, lat] = project.cite.split(',').map(Number);
  const target = mapView(4, lng, lat, 0, 0).point;
  const [x, y, w, h] = project.frame;
  const heroFrame = [x, Math.max(0, y - h * .12), w, h * 1.22];
  const large = svgElement('svg', {preserveAspectRatio: 'xMidYMid slice'});
  renderImagery(large, project, heroFrame);
  const trace = {id:'',kind:'existing',name:'',points:project.existing};
  const featureOrder = ['existing','area','line','item'];
  const timeline = [{...trace}, ...project.seeds].sort((a,b) => featureOrder.indexOf(a.kind)-featureOrder.indexOf(b.kind));
  large.append(...timeline.map((feature,index) => {
    const layer = drawFeature({...feature,name:''}, false, project);
    layer.classList.add('hero-plan-draw');
    layer.style.setProperty('--draw-delay', `${0.82 + index * 0.40}s`);
    layer.querySelector('polygon,polyline')?.setAttribute('pathLength','1');
    return layer;
  }));
  const heroKey = project === projects.yuquan ? 'yuquan' : 'waic';
  const activeProvince = heroKey === 'yuquan' ? '330000' : '310000';
  const animate = turn > 1 && !reducedMotion.matches && !document.hidden && hero.getBoundingClientRect().bottom > 0;
  atlasReady.then(atlas => {
    if (!atlas || turn !== heroRequest) return;
    const previous = lastLocatorPoint;
    const frame = [target[0]-66,target[1]-52,132,104];
    const previousFrame = mini.getAttribute('viewBox')?.split(' ').map(Number) || atlas.viewBox;
    drawLocator(mini, atlas, activeProvince, target);
    moveLocatorCamera(mini, previousFrame, frame, target, previous, turn);
    lastLocatorPoint = target;
  });
  const images = [...large.querySelectorAll('image')];
  Promise.allSettled(images.map(tile => new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = resolve;
    image.onerror = reject;
    image.src = tile.getAttribute('href');
  }))).then(results => {
    if (turn !== heroRequest) return;
    const loaded = results.every(result => result.status === 'fulfilled');
    layer.replaceChildren(...(loaded ? [large] : []));
    hero.querySelector('[data-site-city]').textContent = project === projects.yuquan ? '长三角 · 杭州' : '长三角 · 上海';
    hero.querySelector('[data-site-place]').textContent = project.place;
    document.querySelector('[data-site-name]').textContent = project.title;
    document.querySelector('[data-site-kicker]').textContent = project.kicker;
    document.querySelector('[data-site-intro]').textContent = project.caption;
    document.querySelector('[data-yuquan-proposal]').hidden = heroKey !== 'yuquan';
    if (animate) document.querySelector('.hero-site-caption').animate(
      [{opacity:0, transform:'translateY(9px)'},{opacity:1, transform:'translateY(0)'}],
      {duration:430, easing:'ease-out'});
    hero.querySelector('[data-site-date]').textContent = loaded ? `Esri · ${project.date}` : '影像暂不可用';
    document.querySelector('#hero').toggleAttribute('data-real-site', loaded);
  });
}

function renderActivitySources(project) {
  const brief = section.querySelector('#site-activity-brief');
  const sourceGroup = section.querySelector('#site-sources-activity');
  brief.hidden = !project.phases;
  sourceGroup.hidden = !project.source;
  if (!project.phases) return;
  if (project.source) {
    const primary = sourceGroup.querySelector('[data-activity-source]');
    primary.href = project.source;
    primary.textContent = project.sourceName;
    const reference = sourceGroup.querySelector('[data-activity-reference]');
    reference.href = project.reference;
    reference.textContent = project.referenceName;
    const outline = sourceGroup.querySelector('[data-activity-geometry]');
    outline.hidden = !project.geometrySource;
    if (project.geometrySource) outline.href = project.geometrySource;
  }
  const note = brief.querySelector('[data-activity-note]');
  note.textContent = project.existing || project.existingAreas?.length ? '青色标出' + project.existingName + '。' : '当届活动范围待核。';
  const steps = brief.querySelector('.site-activity-steps');
  const description = brief.querySelector('[data-activity-step]');
  const useTool = brief.querySelector('[data-activity-tool]');
  const buttons = [];
  function selectStep(index) {
    const [,text,tool,name] = project.phases[index];
    description.textContent = text;
    useTool.dataset.mode = tool;
    useTool.dataset.name = name;
    buttons.forEach((button,i) => button.setAttribute('aria-pressed',String(i === index)));
  }
  for (const [index,[label]] of project.phases.entries()) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.addEventListener('click', () => selectStep(index));
    buttons.push(button);
  }
  steps.replaceChildren(...buttons);
  selectStep(0);
}
section.querySelector('[data-activity-tool]').addEventListener('click', event => {
  if (!mapReady) return;
  const {mode, name} = event.currentTarget.dataset;
  selectFeature('');
  nameField.value = name;
  if (mode === 'item') {
    const model = catalog.find(([type]) => name === '拟放 · ' + type);
    if (model) writeSpecs({width:model[1],depth:model[2]});
  }
  changeMode(mode);
  nameField.focus({preventScroll:true});
});

function openProject(next) {
  key = next;
  const heroIndex = heroKeys.indexOf(key);
  if (heroIndex >= 0) heroAt = heroIndex;
  const project = current();
  if (!workspace.has(key)) workspace.set(key, structuredClone(project.seeds));
  mode = '';
  draft = [];
  selected = '';
  nameField.value = '';
  mapReady = false;
  zoom = 1;
  pan = [0, 0];
  tabs.forEach(button => {
    const active = hero.contains(button) ? heroKeys[heroAt] : key;
    button.setAttribute('aria-pressed',String(button.dataset.siteProject === active));
  });
  section.querySelector('#site-project-title').textContent = project.name;
  section.querySelector('#site-project-place').textContent = project.place;
  section.querySelector('#site-project-intro').textContent = project.intro;
  section.querySelector('#site-date').textContent = project.date
    ? `${project.date} · ${project.resolution ?? 0.34} 米/像素（定位点源影像）`
    : 'Esri World Imagery · 影像日期待核';
  section.querySelector('#site-sources-yuquan').hidden = key !== 'yuquan';
  section.querySelector('#site-sources-waic').hidden = key !== 'waic';
  renderActivitySources(project);
  const meta = new URLSearchParams({geometry: project.cite, geometryType: 'esriGeometryPoint', inSR: '4326',
    outFields: 'SRC_DATE,SRC_RES,SRC_ACC,NICE_DESC', returnGeometry: 'false', f: 'pjson'});
  section.querySelector('#site-meta-source').href = `${imagery}/4/query?${meta}`;
  overlay.setAttribute('visibility','hidden');
  say('正在载入卫星影像…');
  mapTiles.clear();
  base.replaceChildren();
  applyFrame();
  draw();
  if (heroIndex >= 0) showHero(project);
}

modeButtons.forEach(button => button.addEventListener('click', () => {
  if (button.dataset.mode === mode) changeMode('');
  else {
    selectFeature('');
    changeMode(button.dataset.mode);
    nameField.focus({preventScroll:true});
  }
}));
finish.addEventListener('click', () => addFeature(mode, draft));
cancel.addEventListener('click', () => changeMode(''));
move.addEventListener('click', () => changeMode('move'));
remove.addEventListener('click', () => {
  remember();
  workspace.set(key, features().filter(item => item.id !== selected));
  selectFeature('');
  changeMode('');
  say('已删除选中的对象。');
});
section.querySelector('#site-objects').addEventListener('click', event => {
  const id = event.target.closest('button')?.dataset.id;
  if (id) { changeMode(''); selectFeature(id); }
});
nameField.addEventListener('change', () => {
  if (mode) return;
  const feature = features().find(item => item.id === selected);
  const value = nameField.value.trim();
  if (feature && value) {
    if (feature.name === value) return;
    remember();
    feature.name = value;
    draw();
  }
});
map.addEventListener('click', event => {
  if (!mapReady || skipClick) { skipClick = false; return; }
  const hit = event.target.closest('[data-id]')?.dataset.id;
  if (!mode) {
    selectFeature(hit || '');
    return;
  }
  const point = mapPoint(event);
  if (!point || mode === 'pan') return;
  const [x,y] = point;
  if (!within(point)) return;
  if (mode === 'move') {
    const feature = features().find(item => item.id === selected);
    if (!feature) return;
    const [cx, cy] = labelAt(feature.points);
    const moved = feature.points.map(([px, py]) => [px + x - cx, py + y - cy]);
    if (!moved.every(within)) {
      say('移动后对象会超出底图范围，请选择更靠内的位置。');
      return;
    }
    remember();
    feature.points = moved;
    changeMode('');
    say(`已移动「${feature.name}」。`);
  } else if (['area','line','measure'].includes(mode)) {
    draft.push(point);
    draw();
  } else {
    addFeature(mode, [point]);
  }
});
const catalogElement = section.querySelector('#site-catalog');
catalog.forEach(([name,width,depth]) => {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = name;
  button.title = width + ' × ' + depth + ' 米';
  button.draggable = true;
  const choose = () => {
    if (!mapReady) return;
    selectFeature('');
    nameField.value = name;
    writeSpecs({width,depth});
    hiddenLayers.delete('item');
    changeMode('item');
  };
  button.addEventListener('click', choose);
  button.addEventListener('dragstart', event => {
    if (!mapReady) { event.preventDefault(); return; }
    event.dataTransfer.setData('application/x-scendance-item', name);
    choose();
  });
  catalogElement.append(button);
});
map.addEventListener('dragover', event => {
  if (mapReady && event.dataTransfer.types.includes('application/x-scendance-item')) event.preventDefault();
});
map.addEventListener('drop', event => {
  if (!mapReady || mode !== 'item' || !catalog.some(([name]) => name === event.dataTransfer.getData('application/x-scendance-item'))) return;
  event.preventDefault();
  const point = mapPoint(event);
  if (point && within(point)) addFeature('item', [point]);
});
map.addEventListener('pointerdown', event => {
  if ((mode && mode !== 'pan') || event.button !== 0) return;
  skipClick = false;
  const point = mapPoint(event);
  const hit = event.target.closest('[data-id]')?.dataset.id;
  const feature = mode === 'pan' ? null : features().find(item => item.id === hit);
  if (!point) return;
  const scale = 1 / map.getScreenCTM().a;
  pointer = {id:event.pointerId, start:point, screen:[event.clientX,event.clientY], pan:[...pan], scale, feature,
    points:feature ? structuredClone(feature.points) : null, moved:false};
});
map.addEventListener('pointermove', event => {
  if (pointer?.id !== event.pointerId) return;
  const {feature, screen, start, points} = pointer;
  if (!pointer.moved && Math.hypot(event.clientX - screen[0], event.clientY - screen[1]) < 5) return;
  const point = mapPoint(event);
  if (!point) return;
  if (!pointer.moved) {
    if (feature) { remember(); selectFeature(feature.id); }
    map.setPointerCapture(event.pointerId);
    map.toggleAttribute('data-dragging',!feature);
    pointer.moved = true;
  }
  const [dx,dy] = [point[0]-start[0],point[1]-start[1]];
  if (feature) {
    const moved = points.map(([x,y]) => [x+dx,y+dy]);
    if (moved.every(within)) { feature.points = moved; draw(); }
  } else {
    pan = [pointer.pan[0] - (event.clientX-screen[0]) * pointer.scale,
      pointer.pan[1] - (event.clientY-screen[1]) * pointer.scale];
    applyFrame();
  }
});
for (const type of ['pointerup','pointercancel','pointerleave']) {
  map.addEventListener(type, event => {
    if (pointer?.id !== event.pointerId) return;
    if (type === 'pointerleave' && map.hasPointerCapture(event.pointerId)) return;
    skipClick = pointer.moved;
    pointer = null;
    map.removeAttribute('data-dragging');
  });
}
sizeFields.forEach(input => input.addEventListener('change', () => {
  const feature = selectedFeature();
  if (!mode && feature?.kind === 'item') {
    remember();
    Object.assign(feature, readSpecs());
    writeSpecs(feature);
    draw();
  }
}));
section.querySelector('#site-layers').addEventListener('change', event => {
  if (event.target.checked) hiddenLayers.delete(event.target.value);
  else hiddenLayers.add(event.target.value);
  draw();
});
undo.addEventListener('click', () => {
  const previous = history.get(key)?.pop();
  if (!previous) return;
  workspace.set(key, previous);
  selectFeature('');
  changeMode('');
  say('已撤销上一步。');
});
copy.addEventListener('click', () => {
  const original = selectedFeature();
  if (!original) return;
  remember();
  const duplicate = structuredClone(original);
  duplicate.id = crypto.randomUUID();
  duplicate.name = (duplicate.name + ' 副本').slice(0,42);
  const moved = duplicate.points.map(([x,y]) => [x+8,y+8]);
  if (moved.every(within)) duplicate.points = moved;
  features().push(duplicate);
  selectFeature(duplicate.id);
});
section.querySelector('#site-export').addEventListener('click', () => {
  const exported = features().map(({id,kind,name,points,width,depth,angle}) => {
    const coordinates = points.map(point => lonLat(point));
    const geometry = kind === 'area' ? {type:'Polygon',coordinates:[[...coordinates, coordinates[0]]]} :
      kind === 'line' || kind === 'measure' ? {type:'LineString',coordinates} : {type:'Point',coordinates:coordinates[0]};
    return {type:'Feature',id,geometry,properties:{kind,name,width,depth,angle,status:'策划演示'}};
  });
  const url = URL.createObjectURL(new Blob([JSON.stringify({type:'FeatureCollection',features:exported})],
    {type:'application/geo+json'}));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'scendance-' + key + '.geojson';
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
section.querySelector('#site-zoom-in').addEventListener('click', () => { zoom = Math.min(3, zoom * 1.25); applyFrame(); });
section.querySelector('#site-zoom-out').addEventListener('click', () => { zoom = Math.max(minZoom, zoom / 1.25); applyFrame(); });
section.querySelector('#site-fit').addEventListener('click', () => {
  zoom = 1;
  pan = [0,0];
  applyFrame();
});
const full = section.querySelector('#site-fullscreen');
const workspaceElement = section.querySelector('.site-workspace');
function syncFullscreen() {
  const expanded = document.fullscreenElement === workspaceElement || workspaceElement.hasAttribute('data-expanded');
  full.textContent = expanded ? '退出全屏' : '全屏';
  full.setAttribute('aria-pressed',String(expanded));
}
full.addEventListener('click', async () => {
  if (document.fullscreenElement === workspaceElement) {
    await document.exitFullscreen();
    return;
  }
  if (workspaceElement.hasAttribute('data-expanded')) {
    workspaceElement.removeAttribute('data-expanded');
    syncFullscreen();
    return;
  }
  try {
    if (!workspaceElement.requestFullscreen) throw new Error();
    await workspaceElement.requestFullscreen();
  } catch {
    workspaceElement.setAttribute('data-expanded','');
    syncFullscreen();
  }
});
document.addEventListener('fullscreenchange', syncFullscreen);
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && workspaceElement.hasAttribute('data-expanded')) {
    workspaceElement.removeAttribute('data-expanded');
    syncFullscreen();
  }
});
section.addEventListener('keydown', event => {
  if (event.key === 'Escape' && mode) changeMode('');
});
const requestedActivity = new URLSearchParams(location.search).get('activity');
if (requestedActivity && Object.hasOwn(projects,requestedActivity)) {
  if (!heroKeys.includes(requestedActivity)) showHero(projects.yuquan);
  openProject(requestedActivity);
} else {
  openProject(key);
}
window.addEventListener('resize', () => {
  if (lastLocatorPoint) positionTraveler(hero.querySelector('.hero-atlas'), lastLocatorPoint);
});

const caseViews = [...section.querySelectorAll('[data-case-view]')];
const gallery = section.querySelector('#site-case-index');
const detail = section.querySelector('#site-case-detail');
const detailTitle = section.querySelector('#site-case-title');
const detailIntro = section.querySelector('#site-case-intro');
const detailMeta = section.querySelector('#site-case-meta');
const story = section.querySelector('#site-case-story');
const hub = gallery.querySelector('#inspiration');
const caseHome = gallery.querySelector('#case-home');
const tags = [...new Set(Object.values(inspirationCases).map(item => item.tag))];
const galleryCards = new Map();
let lastCase = key;

function caseElement(tag, className, content) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (content) element.textContent = content;
  return element;
}

function caseUrl(projectKey, view = 'map') {
  const url = new URL(location.href);
  url.hash = {gallery:'inspiration',scene:'library'}[view] || 'site-cases';
  url.searchParams.set('view','inspiration');
  url.searchParams.delete('tool');
  if (projectKey) url.searchParams.set('activity',projectKey);
  else url.searchParams.delete('activity');
  return url;
}

function showCaseMedia(media, projectKey) {
  const project = inspirationCases[projectKey].map || projects[projectKey];
  const preview = svgElement('svg', {preserveAspectRatio:'xMidYMid slice','aria-hidden':'true'});
  renderImagery(preview, project);
  const shapes = project.existingAreas?.length ? project.existingAreas : [project.existing || []];
  for (const points of shapes) {
    if (points.length) preview.append(drawFeature({id:'',kind:'existing',points,name:''},false,project));
  }
  for (const feature of project.seeds) {
    if (feature.kind !== 'label') preview.append(drawFeature({...feature,name:''},false,project));
  }
  media.replaceChildren(preview);
}

function sourceLink(href, label) {
  const link = caseElement('a','',label);
  link.href = href;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  return link;
}

function caseFigure(projectKey, photo = false, preferArchive = false) {
  const item = inspirationCases[projectKey];
  const figure = caseElement('figure');
  const media = caseElement('div','case-card-media');
  const credit = caseElement('figcaption','case-media-credit',photo
    ? `活动资料图 · ${item.credit || '公开来源'}`
    : `${item.mapLabel || '幕景试排'} · Esri World Imagery`);
  figure.append(media,credit);
  if (!photo) {
    showCaseMedia(media,projectKey);
    return figure;
  }
  const fallback = caseElement('div','case-media-fallback');
  fallback.append(sourceLink(item.photoSource || item.source,'查看原始活动资料 ↗'));
  media.append(fallback);
  credit.hidden = true;
  if (item.photo) {
    const image = caseElement('img');
    image.alt = `${item.name}活动资料图`;
    image.decoding = 'async';
    image.hidden = true;
    image.addEventListener('load',() => {
      fallback.hidden = true;
      image.hidden = false;
      credit.hidden = false;
    },{once:true});
    media.prepend(image);
    if (preferArchive && item.previewPhoto) {
      credit.replaceChildren(sourceLink(item.previewPhotoSource,'盐官古城航拍 · 太合音乐 ↗'));
      image.addEventListener('error', () => {
        credit.textContent = `活动资料图 · ${item.credit}`;
        image.src = item.photo;
      }, {once:true});
    }
    image.src = preferArchive && item.previewPhoto ? item.previewPhoto : item.photo;
  }
  return figure;
}

function bindCaseLink(link, getKey) {
  link.addEventListener('click',event => {
    if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (link === spotlightLink && getKey() === 'yuquan') return;
    event.preventDefault();
    visitCase(getKey());
  });
}

const spotlightTabs = gallery.querySelector('.case-spotlight-tabs');
const spotlightVisual = gallery.querySelector('#case-spotlight-visual');
const spotlightLink = gallery.querySelector('#case-spotlight-link');
let spotlightKey;
function showSpotlight(projectKey) {
  if (spotlightKey === projectKey) return;
  spotlightKey = projectKey;
  const item = inspirationCases[projectKey];
  spotlightTabs.querySelectorAll('button').forEach(button => {
    button.setAttribute('aria-pressed',String(button.dataset.spotlightCase === projectKey));
  });
  spotlightVisual.replaceChildren(caseFigure(projectKey),caseFigure(projectKey,true));
  gallery.querySelector('#case-spotlight-title').textContent = item.name;
  gallery.querySelector('#case-spotlight-summary').textContent = item.summary;
  spotlightLink.href = projectKey === 'yuquan' ? '/showcase/assets/yuquan-market-proposal.html' : caseUrl(projectKey);
}
for (const [,label,projectKey] of inspirationCategories) {
  const button = caseElement('button','',label);
  button.type = 'button';
  button.dataset.spotlightCase = projectKey;
  button.addEventListener('click',() => showSpotlight(projectKey));
  spotlightTabs.append(button);
}
bindCaseLink(spotlightLink,() => spotlightKey);

const cardMediaObserver = new IntersectionObserver(entries => {
  for (const {isIntersecting,target} of entries) {
    if (!isIntersecting) continue;
    showCaseMedia(target,target.dataset.caseMedia);
    cardMediaObserver.unobserve(target);
  }
}, {rootMargin:'160px'});

for (const [projectKey,item] of Object.entries(inspirationCases)) {
  const card = caseElement('a','case-card');
  card.href = caseUrl(projectKey);
  card.dataset.caseCard = projectKey;
  card.dataset.caseType = item.type;
  const media = caseElement('span','case-card-media');
  media.dataset.caseMedia = projectKey;
  const status = Object.hasOwn(projects,projectKey) ? '地图试排' : '场地研究';
  const foot = caseElement('span','case-card-foot');
  foot.append(caseElement('span','',item.place),caseElement('span','case-card-action',
    status === '地图试排' ? '打开地图试排 ↗' : '查看案例 ↗'));
  card.append(caseElement('span','case-card-kicker',`${item.tag} · ${item.region} / ${status}`),
    media,caseElement('strong','',item.name),caseElement('span','case-card-summary',item.summary),foot);
  gallery.querySelector('#site-case-grid').append(card);
  galleryCards.set(projectKey,card);
  cardMediaObserver.observe(media);
  bindCaseLink(card,() => projectKey);
}

const tagIcons = {
  音乐节:'M9 18V5l11-2v13M9 6l11-2M9 17c-2-2-7 0-6 3s6 1 6-2m11-3c-2-2-7 0-6 3s6 1 6-2',
  动漫节:'M3 4h18v13H11l-4 4v-4H3zM7 10h1m4 0h1m4 0h1',
  花卉展:'M12 12c-8-6-3-12 0-7 3-5 8 1 0 7Zm0 0c8-5 12 2 6 3 3 5-4 8-6-3Zm0 0c-2 11-9 8-6 3-6-1-2-8 6-3Z',
  马拉松:'M4 19h16M6 15l4-7 4 5 4-4M4 7h3m10 9h3',
  科技大会:'M7 7h10v10H7zM9 2v5m6-5v5m-6 10v5m6-5v5M2 9h5m-5 6h5m10-6h5m-5 6h5',
  展览场馆:'M3 9l9-5 9 5v11H3zM8 20v-7h8v7',
  文旅节庆:'M4 4l16 3-16 3 16 3-16 3 16 3M4 4v16m16-13v13',
  文化展会:'M4 4h16v16H4zM4 16l5-5 3 3 3-4 5 6M8 8h1',
  产业展会:'M12 3l9 5v8l-9 5-9-5V8zM3 8l9 5 9-5m-9 5v8',
  艺术节:'M12 3a9 9 0 1 0 0 18h1a2 2 0 0 0 1-4l-1-1a1 1 0 0 1 1-2h3a4 4 0 0 0 4-4c0-4-4-7-9-7ZM7 9h.1M11 6h.1M16 7h.1M6 14h.1',
  集市:'M4 10v11h16V10M3 4h18l1 6a3 3 0 0 1-5 2 3 3 0 0 1-5 0 3 3 0 0 1-5 0 3 3 0 0 1-5-2l1-6ZM9 21v-6h6v6',
  端午活动:'M3 14h18l-3 5H7l-4-5ZM2 22c2-2 3 2 5 0s3 2 5 0 3 2 5 0 3 2 5 0M7 4l7 9M12 2l7 10M7 9l-3-4M3 14l-1-4 4 1',
  电影节:'M3 9h18v12H3V9ZM3 9l-1-5 18-3 1 5-18 3ZM7 3l3 5M13 2l3 5M9 13l6 3-6 3v-6Z',
  啤酒节:'M5 7h12v14H5V7ZM17 9h2a3 3 0 0 1 0 6h-2M8 10v7m5-7v7M5 7a3 3 0 0 1 0-6 3 3 0 0 1 4 0 3 3 0 0 1 5 1 3 3 0 0 1 3 5',
  风筝节:'M13 2l8 6-8 8-7-8 7-6ZM6 8h15M13 2v14M13 16c-5 1-2 4-5 5H5m3-3 3 2m-5 0 2 2',
};
const quickFilters = gallery.querySelector('#case-quick-filters');
for (const [type, [tag]] of Object.entries(activityTypes)) {
  const link = caseElement('a','',tag);
  link.href = activityTypeUrl(type);
  if (tagIcons[tag]) {
    const icon = svgElement('svg',{viewBox:'0 0 24 24','aria-hidden':'true'});
    icon.append(svgElement('path',{d:tagIcons[tag],fill:'none',stroke:'currentColor','stroke-width':1.65,'stroke-linecap':'round','stroke-linejoin':'round'}));
    link.prepend(icon);
  }
  quickFilters.append(link);
}
const regions = ['杭州','浙江其他','上海','广东','北京'];
let activeType = 'all';
let activeRegion = 'all';
function filterCases() {
  let visible = 0;
  for (const [projectKey,card] of galleryCards) {
    const item = inspirationCases[projectKey];
    const matchesType = activeType === 'all' || activeType === item.type || activeType === item.tag;
    card.hidden = !matchesType || (activeRegion !== 'all' && activeRegion !== item.region);
    if (!card.hidden) visible++;
  }
  gallery.querySelector('#case-count').textContent = visible
    ? `${visible} 个活动与场地案例`
    : '这个组合暂无案例。可以换一个类型或地区。';
}
function addFilters(id,label,options,apply) {
  const group = gallery.querySelector(id);
  group.append(caseElement('span','',label));
  for (const [value,name] of options) {
    const button = caseElement('button','',name);
    button.type = 'button';
    button.dataset.caseFilter = value;
    button.setAttribute('aria-pressed',String(value === 'all'));
    button.addEventListener('click',() => {
      group.querySelectorAll('button').forEach(item => item.setAttribute('aria-pressed',String(item === button)));
      apply(value);
      const url = new URL(location.href);
      const field = id === '#case-types' ? 'category' : 'region';
      if (value === 'all') url.searchParams.delete(field);
      else url.searchParams.set(field,value);
      window.history.replaceState(window.history.state,'',url);
      filterCases();
    });
    group.append(button);
  }
}
addFilters('#case-types','活动类型',[
  ['all','全部'],...inspirationCategories,
  ...tags.map(tag => [tag,tag]),
],value => { activeType = value; });
addFilters('#case-regions','地区',[
  ['all','全部'],...regions.map(region => [region,region]),
],value => { activeRegion = value; });
function syncFilters() {
  const params = new URLSearchParams(location.search);
  const type = params.get('category');
  const region = params.get('region');
  activeType = tags.includes(type) || inspirationCategories.some(([id]) => id === type) ? type : 'all';
  activeRegion = regions.includes(region) ? region : 'all';
  for (const [selector,value] of [['#case-types',activeType],['#case-regions',activeRegion]]) {
    gallery.querySelectorAll(`${selector} button`).forEach(button => {
      button.setAttribute('aria-pressed',String(button.dataset.caseFilter === value));
    });
  }
  filterCases();
}

let storyKey;
function renderStory(projectKey) {
  if (storyKey === projectKey) return;
  storyKey = projectKey;
  const item = inspirationCases[projectKey];
  story.classList.toggle('case-story-feature', projectKey === 'salt');
  if (projectKey === 'salt') {
    story.replaceChildren(caseFigure(projectKey,true,true));
    renderCaseAnalysis(section.querySelector('#site-case-analysis'),projectKey);
    return;
  }
  const media = caseElement('div','case-story-media');
  media.append(caseFigure(projectKey));
  if (item.photo) media.append(caseFigure(projectKey,true));
  const info = caseElement('div','case-story-text');
  const tasks = caseElement('ul');
  tasks.append(...item.tasks.map(task => caseElement('li','',task)));
  const sources = caseElement('p');
  sources.append(sourceLink(item.source,'查看原始活动资料 ↗'));
  if (item.photoSource && item.photoSource !== item.source) {
    sources.append('　',sourceLink(item.photoSource,'查看图片出处 ↗'));
  }
  if (item.mapSource) sources.append('　',sourceLink(item.mapSource,item.mapSourceB ? 'A 馆轮廓来源 ↗' : '查看场地轮廓来源 ↗'));
  if (item.mapSourceB) sources.append('　',sourceLink(item.mapSourceB,'B 馆轮廓来源 ↗'));
  info.append(caseElement('h3','','活动与场地'),caseElement('p','',item.fact),sources,
    caseElement('h3','','幕景布置思路'),tasks,
    caseElement('p','',Object.hasOwn(projects,projectKey)
      ? '以下地图可拖动、缩放并编辑拟设布置。'
      : '场地研究收录公开资料与布置建议。'));
  if (Object.hasOwn(projects,projectKey)) {
    const link = caseElement('a','','打开下方地图试排 ↓');
    link.href = '#site-map-panel';
    info.append(link);
  }
  if (projectKey === 'yuquan') {
    const proposal = caseElement('a','','查看完整策划、路线和点位照片 ↗');
    proposal.href = '/showcase/assets/yuquan-market-proposal.html#materials';
    info.append(caseElement('p'), proposal);
  }
  story.replaceChildren(media,info);
  renderCaseAnalysis(section.querySelector('#site-case-analysis'),projectKey);
}

function showView(view, projectKey = key) {
  const isGallery = view === 'gallery';
  const isScene = view === 'scene';
  const isHub = new URLSearchParams(location.search).get('view') === 'inspiration' || location.hash === '#inspiration';
  document.documentElement.classList.toggle('inspiration-page',isHub);
  caseHome.hidden = isHub;
  hub.hidden = !isHub;
  gallery.hidden = !isGallery;
  detail.hidden = isGallery;
  section.setAttribute('aria-labelledby',isGallery ? (isHub ? 'inspiration-title' : 'site-cases-heading') : 'site-case-title');
  section.querySelector('#site-map-panel').hidden = view !== 'map';
  section.querySelector('#library').hidden = !isScene;
  section.querySelector('.site-view-tabs').hidden = view === 'research';
  story.hidden = isScene;
  section.querySelector('#site-case-analysis').hidden = isScene;
  caseViews.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.caseView === view)));
  if (isGallery) {
    if (isHub) syncFilters();
    else if (!spotlightKey) {
      showSpotlight('yuquan');
      gallery.querySelector('#case-portal-map').append(caseFigure('yuquan'));
      gallery.querySelector('#case-portal-demo').append(caseFigure('waic'));
    }
    return;
  }
  if (isScene) {
    detailMeta.textContent = '';
    detailTitle.textContent = '三维场景';
    detailIntro.textContent = '选择一个场景，查看三维布置。';
    return;
  }
  const item = inspirationCases[projectKey];
  lastCase = projectKey;
  detailMeta.textContent = `${item.tag} · ${item.region} · ${item.date} / ${view === 'map' ? '策划演练' : '场地研究'}`;
  detailTitle.textContent = item.name;
  detailIntro.textContent = item.summary;
  renderStory(projectKey);
  if (view === 'map') applyFrame();
}

function jumpToCases(focus, target = section) {
  if (document.documentElement.classList.contains('map-embed')) return;
  target.scrollIntoView({block:'start',behavior:'instant'});
  if (focus) focus.focus({preventScroll:true});
}

function visitCase(projectKey, view = Object.hasOwn(projects,projectKey) ? 'map' : 'research') {
  const url = caseUrl(projectKey,view);
  if (location.href !== url.href) window.history.pushState(window.history.state,'',url);
  if (view === 'map' && projectKey !== key) openProject(projectKey);
  showView(view,projectKey);
  if (view === 'gallery') {
    const card = galleryCards.get(lastCase);
    jumpToCases(card?.hidden ? gallery.querySelector('#case-types [aria-pressed="true"]') : card,hub);
  } else {
    jumpToCases(detailTitle);
  }
}

function viewFromUrl(scroll = false) {
  const wanted = new URLSearchParams(location.search).get('activity');
  const hash = location.hash;
  if (hash === '#library') {
    showView('scene');
    if (scroll) jumpToCases();
  } else if (hash !== '#inspiration' && wanted && Object.hasOwn(inspirationCases,wanted)) {
    const view = Object.hasOwn(projects,wanted) ? 'map' : 'research';
    if (view === 'map' && wanted !== key) openProject(wanted);
    showView(view,wanted);
    if (scroll && hash === '#site-map-panel' && view === 'map') jumpToCases(null,section.querySelector('#site-map-panel'));
    else if (scroll && (!hash || hash === '#site-cases')) jumpToCases();
  } else {
    showView('gallery');
    if (scroll && hash === '#site-cases') jumpToCases();
    if (scroll && hash === '#inspiration') jumpToCases(null,hub);
  }
}
tabs.forEach(button => button.addEventListener('click', () => {
  const next = button.dataset.siteProject;
  if (hero.contains(button)) {
    heroAt = heroKeys.indexOf(next);
    tabs.filter(item => hero.contains(item)).forEach(item => item.setAttribute('aria-pressed',String(item === button)));
    showHero(projects[next]);
  } else {
    visitCase(next);
  }
}));
caseViews.forEach(button => button.addEventListener('click',() => {
  visitCase(button.dataset.caseView === 'map' ? key : null,button.dataset.caseView);
}));
for (const link of document.querySelectorAll('a[href="#library"], .hero-cta a[href="#site-cases"], #site-case-return')) {
  link.addEventListener('click',event => {
    if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    if (link.hash === '#library') visitCase(null,'scene');
    else if (link.id === 'site-case-return') visitCase(null,'gallery');
    else visitCase(heroKeys[heroAt]);
  });
}
window.addEventListener('hashchange', () => viewFromUrl(true));
window.addEventListener('popstate', () => viewFromUrl(true));
viewFromUrl(true);

const agent = document.querySelector('#site-agent');
const agentLaunch = document.querySelector('#agent-launch');
const entry = document.querySelector('#site-entry-transition');
let entryTimer;
const face = agentLaunch.querySelector('img');
const restingFace = face.getAttribute('src');
agentLaunch.addEventListener('pointerenter', () => {
  travelerHovered = true;
  face.src = new URL('./brand/logo-2026/door/door-eyes.svg', import.meta.url).href;
});
agentLaunch.addEventListener('pointerleave', () => {
  travelerHovered = false;
  face.src = restingFace;
});
window.addEventListener('blur', () => { travelerHovered = false; face.src = restingFace; });
const closeGuide = installSiteGuide({agent, launcher:agentLaunch});
document.querySelectorAll('[data-workbench-entry]').forEach(link => link.addEventListener('click', event => {
  if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  if (entryTimer) return;
  closeGuide();
  entry.hidden = false;
  entryTimer = setTimeout(() => window.location.assign(link.href), reducedMotion.matches ? 280 : 870);
}));
window.addEventListener('pageshow', event => {
  if (!event.persisted) return;
  clearTimeout(entryTimer);
  entryTimer = undefined;
  entry.hidden = true;
});

const heroHeader = document.querySelector('#hero');
const cover = document.querySelector('#blank');
let coverFrame;
function updateCover() {
  coverFrame = 0;
  const progress = Math.max(0,Math.min(1,scrollY / Math.max(1,heroHeader.offsetHeight * .58)));
  heroHeader.style.setProperty('--scene-scale', reducedMotion.matches ? 1 : 1 + progress * .19);
  cover.style.setProperty('--cover-curve', reducedMotion.matches ? .5 : Math.min(1,progress * 1.65));
}
function scheduleCover() {
  if (!coverFrame) coverFrame = requestAnimationFrame(updateCover);
}
window.addEventListener('scroll',scheduleCover,{passive:true});
window.addEventListener('resize',scheduleCover,{passive:true});
reducedMotion.addEventListener('change',scheduleCover);
updateCover();
let visible = true;
if ('IntersectionObserver' in window) {
  const visibility = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; }, {threshold: .25});
  visibility.observe(heroHeader);
}
const pause = hero.querySelector('[data-site-pause]');
let paused = false;
pause.hidden = reducedMotion.matches;
reducedMotion.addEventListener('change', event => { pause.hidden = event.matches; });
pause.addEventListener('click', () => {
  paused = !paused;
  pause.textContent = paused ? '继续轮播' : '暂停轮播';
});
setInterval(() => {
  if (paused || gallery.hidden || !agent.hidden || !visible || document.hidden || reducedMotion.matches || hero.matches(':hover, :focus-within')) return;
  heroAt = (heroAt + 1) % heroKeys.length;
  const next = heroKeys[heroAt];
  tabs.filter(button => hero.contains(button)).forEach(button => button.setAttribute('aria-pressed',String(button.dataset.siteProject === next)));
  showHero(projects[next]);
}, 9000);
