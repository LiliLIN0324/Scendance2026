import { readFile, writeFile, mkdir, cp } from 'node:fs/promises';

/* ------------------------------------------------------------------------- *
 * Shared GLB container helpers
 * ------------------------------------------------------------------------- */

function readDocument(buffer) {
  return JSON.parse(buffer.subarray(20, 20 + buffer.readUInt32LE(12)).toString());
}

/** Replaces the JSON chunk; the binary chunk (geometry + textures) is copied verbatim. */
function writeDocument(buffer, document) {
  const json = Buffer.from(JSON.stringify(document));
  const padded = Buffer.alloc(Math.ceil(json.length / 4) * 4, 0x20);
  json.copy(padded);
  const binary = buffer.subarray(20 + buffer.readUInt32LE(12));
  const result = Buffer.alloc(20 + padded.length + binary.length);
  buffer.copy(result, 0, 0, 20);
  result.writeUInt32LE(result.length, 8);
  result.writeUInt32LE(padded.length, 12);
  padded.copy(result, 20);
  binary.copy(result, 20 + padded.length);
  return result;
}

/* ------------------------------------------------------------------------- *
 * World-space bounds. The renderer (`three/glb-assets.ts`) scales every
 * instance to its item's measured size and refuses an object whose own
 * bounding box has no thickness (`模型包围盒无效`), so a flat archive decal —
 * the cafe brand sign is a single plane — cannot become a movable fixture.
 * Such nodes stay in the fixed structure and are reported by the build, and
 * `layoutFromPreset` keeps item dimensions equal to the real bounds so the
 * render-time scale stays 1:1.
 * ------------------------------------------------------------------------- */

const MIN_INSTANCE_AXIS = 1e-6;
const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/** Fixtures per preset left in the fixed structure because they cannot be instanced. */
export const SKIPPED_FIXTURES = new Map();

function multiplyMatrices(a, b) {
  const out = new Array(16);
  for (let row = 0; row < 4; row += 1) {
    for (let column = 0; column < 4; column += 1) {
      let sum = 0;
      for (let k = 0; k < 4; k += 1) sum += a[row * 4 + k] * b[k * 4 + column];
      out[row * 4 + column] = sum;
    }
  }
  return out;
}

/** Row-major matrix with translation in slots 3/7/11, matching three.js semantics. */
function nodeMatrix(node) {
  if (node.matrix) {
    const m = node.matrix; // glTF stores columns; transpose on the way in.
    return [m[0], m[4], m[8], m[12], m[1], m[5], m[9], m[13], m[2], m[6], m[10], m[14], m[3], m[7], m[11], m[15]];
  }
  const [tx, ty, tz] = node.translation ?? [0, 0, 0];
  const [x, y, z, w] = node.rotation ?? [0, 0, 0, 1];
  const [sx, sy, sz] = node.scale ?? [1, 1, 1];
  return [
    (1 - 2 * (y * y + z * z)) * sx, 2 * (x * y - z * w) * sy, 2 * (x * z + y * w) * sz, tx,
    2 * (x * y + z * w) * sx, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z - x * w) * sz, ty,
    2 * (x * z - y * w) * sx, 2 * (y * z + x * w) * sy, (1 - 2 * (x * x + y * y)) * sz, tz,
    0, 0, 0, 1,
  ];
}

function transformPoint(matrix, [x, y, z]) {
  return [
    matrix[0] * x + matrix[1] * y + matrix[2] * z + matrix[3],
    matrix[4] * x + matrix[5] * y + matrix[6] * z + matrix[7],
    matrix[8] * x + matrix[9] * y + matrix[10] * z + matrix[11],
  ];
}

/** The same box `THREE.Box3.setFromObject` measures: accessor corners under node transforms. */
function subtreeBounds(document, indices) {
  const { nodes, meshes = [], accessors = [] } = document;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  const visit = (index, parent) => {
    const node = nodes[index];
    const matrix = multiplyMatrices(parent, nodeMatrix(node));
    if (node.mesh !== undefined) {
      for (const primitive of meshes[node.mesh]?.primitives ?? []) {
        const accessor = accessors[primitive.attributes?.POSITION];
        if (!accessor?.min || !accessor?.max) continue;
        for (const px of [accessor.min[0], accessor.max[0]]) {
          for (const py of [accessor.min[1], accessor.max[1]]) {
            for (const pz of [accessor.min[2], accessor.max[2]]) {
              const point = transformPoint(matrix, [px, py, pz]);
              for (let axis = 0; axis < 3; axis += 1) {
                min[axis] = Math.min(min[axis], point[axis]);
                max[axis] = Math.max(max[axis], point[axis]);
              }
            }
          }
        }
      }
    }
    for (const child of node.children ?? []) visit(child, matrix);
  };
  for (const index of indices) visit(index, IDENTITY);
  return { min, max, size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]] };
}

/* ------------------------------------------------------------------------- *
 * Archived template presets (bar, cafe, conference, lawn, market, museum,
 * office, studio) — sources under `scene/templates/<key>/`, layer names taken
 * from each archive's own template.json.
 *
 * Every root layer must be classified as one of:
 *   editable  — children become `Preset_Object_N` items (one fixture each)
 *   structure — kept as fixed architecture
 *   dropped   — left unreachable, e.g. a ceiling slab that would hide the room
 * An unclassified layer aborts the build instead of silently losing geometry.
 *
 * `by` selects what counts as one complete fixture in a layer:
 *   flag    — the author marked it `extras.editableObject` (bar/cafe/office/studio)
 *   grouped — the node already groups its own parts (stalls, canopies, chairs, people)
 *   names   — an allow-list for single-mesh fixtures the archive never grouped
 * A `groups` entry merges several part nodes into one fixture (a painting is a
 * frame plus its canvas; a counter is a body, a top and an inset).
 * ------------------------------------------------------------------------- */

/** Chinese display names for the authored `extras.role` values (bar/cafe/office/studio). */
const ROLE_LABELS = {
  BackbarDisplay: '后吧展示架', BackCabinet: '后柜', BackWorktop: '后吧台面', ServiceCounter: '服务台',
  BarStool: '吧台凳', Banquette: '卡座', LoungeTable: '卡座茶几', TableSetting: '桌面摆设',
  Sink: '水槽', BeverageFridge: '饮料柜', IceMaker: '制冰机', IceWell: '冰槽', TapTower: '生啤塔',
  POS: '收银机', Blender: '搅拌机', CocktailTools: '调酒工具', StemwareRack: '酒杯架',
  CounterGlassware: '吧台酒具', Pendant: '吊灯', WallSconce: '壁灯', BackbarLight: '后吧灯',
  PrepCounter: '制备台', RoundTable: '圆桌', DiningChair: '餐椅', WindowBar: '窗边吧台',
  MagazineShelf: '杂志架', Planter: '绿植', EspressoMachine: '咖啡机', CoffeeGrinder: '磨豆机',
  PastryDisplay: '甜点柜', OrderPOS: '点单机', PickupStation: '取餐台', PrepSink: '清洗池',
  BaristaTools: '咖啡师工具', ChilledCabinet: '冷藏柜', BrandSign: '品牌标牌', MenuBoard: '菜单板',
  WallShelf: '墙面层板', TabletopSet: '桌面摆设', WallArtwork: '挂画', CounterPlant: '台面绿植',
  WorkDesk: '工位桌', TaskChair: '办公椅', DeskDivider: '桌面隔断', StorageCabinet: '收纳柜',
  MeetingTable: '会议桌', PantryCabinet: '茶水柜', ArchiveBook: '档案册', LoungeRug: '休闲区地毯',
  Sofa: '沙发', LoungeChair: '休闲椅', CoffeeTable: '茶几', ReceptionDesk: '前台', Plant: '绿植',
  MonitorSet: '显示器套装', DeskStationery: '桌面文具', MeetingDisplay: '会议显示屏',
  Whiteboard: '白板', CoffeeMachine: '咖啡机', Printer: '打印机', ReceptionLaptop: '前台笔电',
  MeetingLaptop: '会议笔电', LinearTaskLight: '线性灯',
  StylingPlinth: '造型展台', RoundStylingPlinth: '圆形展台', StylingStool: '造型凳',
  RetouchDesk: '修图桌', MakeupVanity: '化妆台', MakeupStool: '化妆凳', EntryBench: '入口长凳',
  OctagonalSoftbox: '八角柔光箱', StripSoftbox: '条形柔光箱', Reflector: '反光板',
  CameraTripod: '相机三脚架', TetherCart: '联机推车', TetherLaptop: '联机笔电',
  PaperRollRack: '背景纸架', EquipmentShelving: '器材架', GripStorage: '器材柜',
  RollingFlightCase: '航空箱', CeilingFixture: '顶灯',
};

const PRESET_SOURCES = {
  bar: {
    labels: ROLE_LABELS,
    editable: [
      { layer: 'Bar_Furniture', by: 'flag' },
      { layer: 'Bar_Equipment', by: 'flag' },
      { layer: 'Bar_Lighting', by: 'flag' },
    ],
    structure: ['Bar_Structure'],
    dropped: ['Bar_Roof'],
  },
  cafe: {
    labels: ROLE_LABELS,
    editable: [
      { layer: 'Cafe_Furniture', by: 'flag' },
      { layer: 'Cafe_Equipment', by: 'flag' },
      { layer: 'Cafe_Lighting', by: 'flag' },
    ],
    // The roof layer also carries the shopfront glazing and doors; only the
    // ceiling slab and its downlights are hidden.
    structure: ['Cafe_Structure', { layer: 'Cafe_Roof', drop: /^(RoofSlab|CeilingLight)_/ }],
    dropped: [],
  },
  conference: {
    labels: {
      AudienceChair: '观众椅', GuestChair: '嘉宾椅', Audience: '观众', Guest: '嘉宾',
      Staff: '工作人员', Refreshment_counter: '茶歇台', Registration_laptop: '签到笔记本',
      Stage_PA: '舞台音箱', Conference_planter: '会议绿植',
    },
    editable: [
      { layer: 'Conference_Seating', by: 'grouped' },
      { layer: 'Conference_GuestSeating', by: 'grouped' },
      { layer: 'Conference_People', by: 'grouped' },
      { layer: 'Conference_Guests', by: 'grouped' },
      { layer: 'Conference_Staff', by: 'grouped' },
      // Only the fixtures this layer already groups (counter, laptop, PA,
      // planters); its 151 loose parts stay fixed architecture.
      { layer: 'Conference_Furniture', by: 'grouped' },
    ],
    // Keep the right wall, entrance and acoustic fins; hide the ceiling and
    // its suspended fixtures.
    structure: ['Conference_Structure', { layer: 'Conference_Roof', drop: /^(Ceiling|Suspended_linear_fixture|Linear_light_diffuser)_/ }],
    dropped: ['Conference_Lights'],
  },
  lawn: {
    labels: {
      AudienceChair: '听众椅', Visitor: '来宾', Staff: '工作人员', LoungeChair: '休闲椅',
      PA_Speaker: '音箱', Planter: '花箱',
    },
    editable: [
      { layer: 'Lawn_Seating', by: 'grouped' },
      { layer: 'Lawn_People', by: 'grouped' },
      { layer: 'Lawn_Staff', by: 'grouped' },
      { layer: 'Lawn_Furniture', by: 'grouped' },
    ],
    structure: ['Lawn_Structure', 'Lawn_Landscape', 'Lawn_Canopies'],
    dropped: [],
  },
  market: {
    labels: {
      Stall: '摊位', Canopy: '遮阳棚', Asset_table: '桌子', Asset_chair: '椅子',
      Asset_parasol: '遮阳伞', Asset_planter: '花箱', Asset_bin: '垃圾桶',
      Asset_microphone: '话筒', Stage_4_8x2_6: '舞台',
    },
    editable: [
      { layer: 'Market_Stalls', by: 'grouped' },
      { layer: 'Market_Canopies', by: 'grouped' },
      { layer: 'Market_Furniture', by: 'grouped' },
      // The stage platform is a single mesh the archive never grouped.
      { layer: 'Market_Furniture', by: 'names', names: ['Stage_4_8x2_6_824'] },
    ],
    // Crates and drums stay with the ground as market dressing; the festoon
    // rig is thin overhead geometry, so it is kept for looks.
    structure: ['Market_Ground', 'Market_LightingRig', 'Market_Decor'],
    dropped: [],
  },
  museum: {
    labels: {
      SculpturePlinth: '雕塑基座', Artwork_Fictional_ShapeOfWind: '装置作品「风的形状」',
      Source_CC0_Chair: '休闲椅', Source_CC0_Plant: '绿植', Visitor: '访客', Staff: '工作人员',
    },
    groups: [
      { label: '画作', names: ['PaintingFrame_48', 'OriginalAbstractPainting_49'] },
      { label: '画作', names: ['PaintingFrame_51', 'OriginalAbstractPainting_52'] },
      { label: '画作', names: ['PaintingFrame_54', 'OriginalAbstractPainting_55'] },
      { label: '接待台', names: ['OrientationCounter_28', 'CounterTop_29', 'CounterInset_30'] },
      { label: '体验长桌', names: ['ExperienceTableTop_145', 'ExperienceTableLeg_146', 'ExperienceTableLeg_147', 'TableStretcher_148'] },
      { label: '休息桌', names: ['RestTableTop_169', 'RestTableStem_170', 'RestTableBase_171'] },
      { label: '触屏装置', names: ['StaticTouchscreen_156', 'StaticScreenContent_157'] },
      { label: '色彩研究墙', names: ['TouchStudyBase_168', 'ColourStudyBlock_162', 'ColourStudyBlock_163', 'ColourStudyBlock_164', 'ColourStudyBlock_165', 'ColourStudyBlock_166', 'ColourStudyBlock_167'] },
      { label: '色彩样本墙', names: ['WallStudyBase_57', 'ColourSwatch_149', 'ColourSwatch_150', 'ColourSwatch_151', 'ColourSwatch_152'] },
      { label: '序幕展台', names: ['ProloguePlinth_41', 'PrologueEmblem_45'] },
    ],
    editable: [
      { layer: 'Museum_Exhibition', by: 'grouped' },
      { layer: 'Museum_Visitors', by: 'grouped' },
      { layer: 'Museum_Staff', by: 'grouped' },
    ],
    // Wall labels, guide books, swatches and the ceiling track stay fixed.
    structure: ['Museum_Architecture', 'Museum_Lighting'],
    dropped: [],
  },
  office: {
    labels: ROLE_LABELS,
    editable: [
      { layer: 'Office_Furniture', by: 'flag' },
      { layer: 'Office_Equipment', by: 'flag' },
      { layer: 'Office_Lighting', by: 'flag' },
    ],
    structure: ['Office_Structure'],
    dropped: ['Office_Roof'],
  },
  studio: {
    labels: ROLE_LABELS,
    editable: [
      { layer: 'Studio_Furniture', by: 'flag' },
      { layer: 'Studio_Equipment', by: 'flag' },
      { layer: 'Studio_Lighting', by: 'flag' },
    ],
    structure: ['Studio_Structure'],
    dropped: ['Studio_Roof'],
  },
};

/** `AudienceChair_001` and `Asset_table_841` both reduce to their role stem. */
function stemOf(name) {
  return String(name).replace(/_\d+$/, '');
}

function labelFor(plan, node) {
  const role = node.extras?.role;
  if (role && plan.labels?.[role]) return plan.labels[role];
  return plan.labels?.[stemOf(node.name)] ?? plan.labels?.[node.name] ?? stemOf(node.name);
}

export function convertArchivePreset(buffer, key, plan) {
  const document = readDocument(buffer);
  const nodes = document.nodes;
  const rootIndex = document.scenes[document.scene ?? 0].nodes[0];
  const root = nodes[rootIndex];
  const layerIndex = new Map((root.children ?? []).map(index => [nodes[index].name, index]));

  const editableLayers = [...new Set((plan.editable ?? []).map(entry => entry.layer))];
  const structureSpecs = (plan.structure ?? []).map(spec => (typeof spec === 'string' ? { layer: spec } : spec));
  const dropped = plan.dropped ?? [];

  const classified = new Set([...editableLayers, ...structureSpecs.map(spec => spec.layer), ...dropped]);
  for (const name of layerIndex.keys()) if (!classified.has(name)) throw new Error(`${key}: layer ${name} is not classified`);
  for (const name of classified) if (!layerIndex.has(name)) throw new Error(`${key}: layer ${name} is missing`);
  // Reparenting under a fresh identity node keeps every world transform only
  // while the original parent layers are identity too.
  for (const [name, index] of layerIndex) {
    const node = nodes[index];
    if (node.translation || node.rotation || node.scale || node.matrix) throw new Error(`${key}: layer ${name} carries a transform`);
  }

  const editableChildren = new Map();
  for (const name of editableLayers) {
    for (const index of nodes[layerIndex.get(name)].children ?? []) {
      if (!editableChildren.has(nodes[index].name)) editableChildren.set(nodes[index].name, index);
    }
  }

  const consumed = new Set();
  const reserved = new Set();
  const skipped = [];
  const entries = [];
  const take = (label, members) => {
    const { size } = subtreeBounds(document, members);
    if (!size.every(axis => Number.isFinite(axis) && axis > MIN_INSTANCE_AXIS)) {
      // No thickness on one axis: the renderer refuses such an instance, so the
      // fixture stays part of the fixed architecture instead of breaking the preset.
      for (const member of members) reserved.add(member);
      skipped.push(`${label}（${nodes[members[0]].name}）`);
      return;
    }
    for (const member of members) {
      if (consumed.has(member)) throw new Error(`${key}: node ${nodes[member].name} is claimed twice`);
      consumed.add(member);
    }
    entries.push({ label, members });
  };

  for (const group of plan.groups ?? []) {
    const members = group.names.map(name => {
      const index = editableChildren.get(name);
      if (index === undefined) throw new Error(`${key}: group ${group.label} is missing ${name}`);
      return index;
    });
    take(group.label, members);
  }

  for (const entry of plan.editable ?? []) {
    for (const index of nodes[layerIndex.get(entry.layer)].children ?? []) {
      if (consumed.has(index) || reserved.has(index)) continue;
      const node = nodes[index];
      if (entry.by === 'flag' && node.extras?.editableObject !== true) continue;
      if (entry.by === 'grouped' && !(node.children?.length)) continue;
      if (entry.by === 'names' && !entry.names.includes(node.name)) continue;
      take(labelFor(plan, node), [index]);
    }
  }
  if (!entries.length) throw new Error(`${key}: no editable fixtures found`);

  // Repeated roles are numbered (`吧台凳 1`); one-offs keep the bare label.
  const totals = new Map();
  for (const entry of entries) totals.set(entry.label, (totals.get(entry.label) ?? 0) + 1);
  const seen = new Map();
  for (const entry of entries) {
    if (totals.get(entry.label) > 1) {
      const next = (seen.get(entry.label) ?? 0) + 1;
      seen.set(entry.label, next);
      entry.label = `${entry.label} ${next}`;
    }
  }

  const structureChildren = [];
  for (const spec of structureSpecs) {
    const layer = nodes[layerIndex.get(spec.layer)];
    const kept = (layer.children ?? [])
      .filter(index => !spec.drop || !spec.drop.test(nodes[index].name))
      .filter(index => !spec.keep || spec.keep.test(nodes[index].name));
    if (kept.length) {
      layer.children = kept;
      structureChildren.push(layerIndex.get(spec.layer));
    } else {
      delete layer.children;
    }
  }
  for (const name of editableLayers) {
    const layer = nodes[layerIndex.get(name)];
    for (const index of layer.children ?? []) if (!consumed.has(index)) structureChildren.push(index);
    // Every child moved elsewhere; an emptied layer must not stay a second parent.
    delete layer.children;
  }
  if (!structureChildren.length) throw new Error(`${key}: no fixed architecture left`);

  nodes.push({ name: 'Preset_Structure', children: structureChildren });
  const structureIndex = nodes.length - 1;

  const objectIndices = [];
  for (const entry of entries) {
    nodes.push({ name: `Preset_Object_${objectIndices.length}`, extras: { displayName: entry.label }, children: entry.members });
    objectIndices.push(nodes.length - 1);
  }
  nodes.push({ name: 'Preset_Objects', children: objectIndices });

  root.children = [structureIndex, nodes.length - 1];
  SKIPPED_FIXTURES.set(key, skipped);
  return writeDocument(buffer, document);
}

/* ------------------------------------------------------------------------- *
 * Gym and popup archives: the source exporter split each fixture across
 * layers, so their authored grouping is reproduced here by hand.
 * ------------------------------------------------------------------------- */

// Reparent the archived meshes without touching geometry, materials or transforms.
// Source: codex/gym-scene-template @ f2ec7ebd58094e51b868528b1ff499bcd8ea9b0d.
export function convertGymOrPopup(buffer, key) {
  const length = buffer.readUInt32LE(12);
  const document = JSON.parse(buffer.subarray(20, 20 + length).toString());
  const nodes = document.nodes;
  const root = nodes[document.scenes[0].nodes[0]];
  const layer = name => nodes[root.children.find(index => nodes[index].name === name)];
  const structure = layer(key === 'gym' ? 'Gym_Structure_Stage_Signs' : 'Popup_Structure');
  const furniture = layer(key === 'gym' ? 'Gym_Furniture' : 'Popup_Furniture');
  const people = layer(key === 'gym' ? 'Gym_People' : 'Popup_People');
  const objects = [];
  const add = (name, children) => {
    nodes.push({ name: `Preset_Object_${objects.length}`, extras: { displayName: name }, children });
    objects.push(nodes.length - 1);
  };
  if (key === 'gym') {
    const labels = { table: '桌子', chair: '椅子', laptop: '笔记本', plant: '绿植', speaker: '音箱' };
    for (const index of furniture.children) {
      const node = nodes[index];
      add(`${labels[node.extras.role]} ${node.extras.placementIndex + 1}`, [index]);
    }
    for (const index of people.children) add(`参与者 ${nodes[index].extras.participantNumber}`, [index]);
  } else {
    // These authored ranges include the legs, trim, signs and products that
    // the source exporter placed in different layers of the same fixture.
    const groups = [
      ['陈列柜与香氛', [[20, 170]]], ['圆形地毯', [[171, 171]]],
      ['中央香氛岛', [[172, 316]]], ['品牌故事牌', [[317, 319]]],
      ['试香体验台', [[320, 389]]], ['品牌拍照装置', [[390, 400]]],
      ['迎宾台', [[401, 423], [447, 453]]], ['收银台', [[424, 446], [454, 460]]],
      ['休息区圆几', [[461, 479]]], ['入口地垫', [[501, 502]]],
    ];
    const candidates = [...structure.children, ...furniture.children];
    const moved = new Set();
    for (const [name, ranges] of groups) {
      const children = candidates.filter(index => {
        const sequence = Number(nodes[index].name.split('_').at(-1));
        return ranges.some(([first, last]) => sequence >= first && sequence <= last);
      });
      if (!children.length) throw new Error(`Missing fixture: ${name}`);
      children.forEach(index => moved.add(index));
      add(name, children);
    }
    for (const index of furniture.children.filter(index => !moved.has(index))) {
      const name = nodes[index].name;
      if (!name.startsWith('Source_3DAssets_')) throw new Error(`Ungrouped furniture: ${name}`);
      add(name.includes('Plant') ? '绿植' : '休息椅', [index]);
      moved.add(index);
    }
    structure.children = structure.children.filter(index => !moved.has(index));
    for (const index of people.children) add(nodes[index].name.replace('Visitor_', '来访者 '), [index]);
    for (const index of layer('Popup_Staff').children) add(nodes[index].name.replace('Staff_', '店员 '), [index]);
  }
  delete furniture.children;
  delete people.children;
  if (key === 'popup') delete layer('Popup_Staff').children;
  structure.name = 'Preset_Structure';
  const structureIndex = root.children.find(index => nodes[index] === structure);
  nodes.push({ name: 'Preset_Objects', children: objects });
  // Roof / overhead rig stay in the original archive; the editable view is open.
  root.children = [structureIndex, nodes.length - 1];
  const json = Buffer.from(JSON.stringify(document));
  const padded = Buffer.alloc(Math.ceil(json.length / 4) * 4, 0x20);
  json.copy(padded);
  const binary = buffer.subarray(20 + length);
  const result = Buffer.alloc(20 + padded.length + binary.length);
  buffer.copy(result, 0, 0, 20);
  result.writeUInt32LE(result.length, 8);
  result.writeUInt32LE(padded.length, 12);
  padded.copy(result, 20);
  binary.copy(result, 20 + padded.length);
  return result;
}

export const PRESET_KEYS = ['gym', 'popup', ...Object.keys(PRESET_SOURCES)];

export function convertPreset(buffer, key) {
  if (key === 'gym' || key === 'popup') return convertGymOrPopup(buffer, key);
  const plan = PRESET_SOURCES[key];
  if (!plan) throw new Error(`Unknown scene preset: ${key}`);
  return convertArchivePreset(buffer, key, plan);
}

export async function packageScenePresets(root) {
  for (const key of PRESET_KEYS) {
    const source = new URL(`scene/templates/${key}/`, root);
    const destination = new URL(`frontend/public/scene-presets/${key}/`, root);
    await mkdir(destination, { recursive: true });
    await writeFile(new URL(`${key}.glb`, destination), convertPreset(await readFile(new URL(`${key}.glb`, source)), key));
    await cp(new URL(`previews/${key}-overview.jpg`, source), new URL('preview.jpg', destination));
    const skipped = SKIPPED_FIXTURES.get(key) ?? [];
    if (skipped.length) console.log(`  ${key}: ${skipped.length} fixture(s) kept as fixed structure — ${skipped.join('、')}`);
  }
}
