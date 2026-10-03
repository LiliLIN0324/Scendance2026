import { readFile, writeFile, mkdir, cp } from 'node:fs/promises';

// Reparent the archived meshes without touching geometry, materials or transforms.
// Source: codex/gym-scene-template @ f2ec7ebd58094e51b868528b1ff499bcd8ea9b0d.
export function convertPreset(buffer, key) {
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

export async function packageScenePresets(root) {
  for (const key of ['gym', 'popup']) {
    const source = new URL(`scene/templates/${key}/`, root);
    const destination = new URL(`frontend/public/scene-presets/${key}/`, root);
    await mkdir(destination, { recursive: true });
    await writeFile(new URL(`${key}.glb`, destination), convertPreset(await readFile(new URL(`${key}.glb`, source)), key));
    await cp(new URL(`previews/${key}-overview.jpg`, source), new URL('preview.jpg', destination));
  }
}
