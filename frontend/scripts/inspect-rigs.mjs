import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** 直接读 GLB 的 JSON chunk：不经过 three，避免 node 里缺 self/URL/贴图解码。 */
function glbJson(path) {
  const bytes = readFileSync(path);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 12;
  while (offset < bytes.byteLength) {
    const length = view.getUint32(offset, true);
    const type = view.getUint32(offset + 4, true);
    if (type === 0x4e4f534a) {
      return JSON.parse(new TextDecoder().decode(bytes.subarray(offset + 8, offset + 8 + length)));
    }
    offset += 8 + length;
  }
  throw new Error('no JSON chunk');
}

const repo = join(process.cwd(), '..');
const files = {
  people: join(process.cwd(), 'components', 'room-organizer', 'assets', 'people.glb'),
  crowd01: join(repo, '.cache', 'aholo', 'upload', 'people', '7a9f1e21-8c34-4d52-a101-b00000000001.glb'),
  crowd07: join(repo, '.cache', 'aholo', 'upload', 'people', '7a9f1e21-8c34-4d52-a107-b00000000007.glb'),
};

for (const [name, path] of Object.entries(files)) {
  const json = glbJson(path);
  const skins = (json.skins ?? []).map(skin => ({
    joints: skin.joints.length,
    names: skin.joints.map(index => json.nodes[index]?.name),
  }));
  console.log(`\n== ${name} ==`);
  console.log('animations:', (json.animations ?? []).map(a => a.name).join(', ') || '(none)');
  console.log('skins:', skins.length, skins.map(s => s.joints).join('/'));
  console.log('joints[0]:', skins[0]?.names.join(', '));
}
