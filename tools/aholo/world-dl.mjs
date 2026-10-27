import { writeFile, mkdir } from 'node:fs/promises';
const dir = 'docs/evidence/aholo/world-3FO4K4QI6N4V';
await mkdir(dir, { recursive: true });
const urls = {
  'world.ply': 'https://holo-cos.aholo3d.cn/spatial-gen-3dgs/3FO4FMTUKCW4/aholo/output/04c96860ce7d46138fc437aa46a89ed2-030845-0f7d_MaaSReportFile-10503b7be227e532a6e8002d8980fcac.ply',
  'world.spz': 'https://holo-cos.aholo3d.cn/splat-transform/3FO4FMTUKCW4/format/8b2cd07c006148efbbedf0122dd845a1.spz',
  'lod-meta.json': 'https://holo-cos.aholo3d.cn/splat-transform/3FO4FMTUKCW4/1793128534/lod-meta.json',
  'panorama.jpg': 'https://holo-cos.aholo3d.cn/spatial-gen-3dgs/3FO4FMTUKCW4/aholo/output/04c96860ce7d46138fc437aa46a89ed2-030845-0f7d_MaaSReportFile-0fe4854c70981e1788095e0339c502f9.jpg',
};
for (const [name, url] of Object.entries(urls)) {
  const bytes = Buffer.from(await (await fetch(url)).arrayBuffer());
  await writeFile(`${dir}/${name}`, bytes);
  console.log(name, Math.round(bytes.length / 1024), 'KB');
}
