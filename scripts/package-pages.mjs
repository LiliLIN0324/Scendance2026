import { cp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// The standalone 幕景 官网 lives at the repository root, not inside the Next app.
// Mirror it into frontend/public/ so one output serves both modes:
//   next dev            → /introduction (and /showcase/*) are served directly
//   next build (export) → public/ is copied into frontend/out/
// Run from the frontend npm scripts (`predev` / `prebuild`), never by hand.
const root = new URL('../', import.meta.url);
const publicDir = new URL('frontend/public/', root);
const showcase = new URL('showcase/', publicDir);
// cp 是递归覆盖、不会删除源目录里已不存在的文件。不先清空的话，
// 之前迭代留下的图片（例如改名前的 show.png / house.jpg）会一直被打进产物。
await rm(showcase, { recursive: true, force: true });
await mkdir(showcase, { recursive: true });
for (const path of ['assets', 'vendor', 'renderer-webgl.js']) {
  await cp(new URL(path, root), new URL(path, showcase), { recursive: true });
}
const introduction = (await readFile(new URL('introduction.html', root), 'utf8'))
  // v0.4.1's 官网 shipped the workbench entry as http://localhost:3000/ (the app root).
  .replaceAll('http://localhost:3000/', '/')
  .replaceAll('./assets/', '/showcase/assets/')
  .replaceAll('./vendor/', '/showcase/vendor/')
  .replaceAll('./renderer-webgl.js', '/showcase/renderer-webgl.js')
  .replaceAll('./${a.localPath}', '/showcase/${a.localPath}');
await writeFile(new URL('introduction.html', publicDir), introduction);
console.log(`Packaged /introduction and /showcase in ${fileURLToPath(publicDir)}`);
