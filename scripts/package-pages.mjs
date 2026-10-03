import { cp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { packageScenePresets } from './package-scene-presets.mjs';

// The standalone 幕景 官网 lives at the repository root, not inside the Next app.
// Mirror it into frontend/public/ so one output serves both modes:
//   next dev            → /introduction (and /showcase/*) are served directly
//   next build (export) → public/ is copied into frontend/out/
// Run from the frontend npm scripts (`predev` / `prebuild`), never by hand.
const root = new URL('../', import.meta.url);
await packageScenePresets(root);
const publicDir = new URL('frontend/public/', root);
const showcase = new URL('showcase/', publicDir);
// cp 是递归覆盖、不会删除源目录里已不存在的文件。不先清空的话，
// 之前迭代留下的图片（例如改名前的 show.png / house.jpg）会一直被打进产物。
await rm(showcase, { recursive: true, force: true });
await mkdir(showcase, { recursive: true });
for (const path of ['assets', 'vendor', 'renderer-webgl.js']) {
  await cp(new URL(path, root), new URL(path, showcase), { recursive: true });
}
// 场景库页面与它要加载的十套模型、以及它 import 的 vendored three。
// 各模板目录里的预览图、ZIP、验证脚本不随站点发布，只带运行时需要的那几个文件。
const libraryOut = new URL('scene/templates/', showcase);
await cp(new URL('scene/templates/index.html', root), new URL('index.html', libraryOut));
await cp(new URL('scene/templates/gym/vendor/', root), new URL('gym/vendor/', libraryOut), { recursive: true });
for (const id of ['gym', 'popup', 'studio', 'bar', 'cafe', 'conference', 'lawn', 'market', 'museum', 'office']) {
  await mkdir(new URL(`${id}/`, libraryOut), { recursive: true });
  await cp(new URL(`scene/templates/${id}/${id}.glb`, root), new URL(`${id}/${id}.glb`, libraryOut));
}
const introduction = (await readFile(new URL('introduction.html', root), 'utf8'))
  .replaceAll('http://localhost:3000/', '/auth')
  .replaceAll('./assets/', '/showcase/assets/')
  .replaceAll('./vendor/', '/showcase/vendor/')
  .replaceAll('./renderer-webgl.js', '/showcase/renderer-webgl.js')
  .replaceAll('./scene/templates/', '/showcase/scene/templates/')
  .replaceAll('./${a.localPath}', '/showcase/${a.localPath}');
await writeFile(new URL('introduction.html', publicDir), introduction);
console.log(`Packaged /introduction and /showcase in ${fileURLToPath(publicDir)}`);
