import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

function glbJson(path) {
  const bytes = readFileSync(path);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 12;
  while (offset < bytes.byteLength) {
    const length = view.getUint32(offset, true);
    const type = view.getUint32(offset + 4, true);
    if (type === 0x4e4f534a) return JSON.parse(new TextDecoder().decode(bytes.subarray(offset + 8, offset + 8 + length)));
    offset += 8 + length;
  }
  throw new Error('no json');
}

const dir = join(process.cwd(), '..', '.cache', 'aholo', 'upload', 'people');
const rows = readdirSync(dir).filter(name => name.endsWith('.glb')).map(name => {
  const json = glbJson(join(dir, name));
  const anims = (json.animations ?? []).map(a => a.name);
  const joints = json.skins?.[0]?.joints?.length ?? 0;
  return { name: name.slice(0, 12), anims: anims.join('|'), joints };
});
const tally = {};
for (const row of rows) tally[row.anims] = (tally[row.anims] ?? 0) + 1;
console.log('files:', rows.length, 'joints:', [...new Set(rows.map(r => r.joints))]);
console.log('clip sets:', JSON.stringify(tally, null, 2));
