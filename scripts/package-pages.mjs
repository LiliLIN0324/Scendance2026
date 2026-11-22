import { cp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// The standalone 幕景 官网 and its 新手指引 live at the repository root, not
// inside the Next app. Mirror them into frontend/public/ so one output serves
// both modes:
//   next dev            → /introduction, /guide (and /showcase/*) are served directly
//   next build (export) → public/ is copied into frontend/out/
// Run from the frontend npm scripts (`predev` / `prebuild`), never by hand.
const root = new URL('../', import.meta.url);
const publicDir = new URL('frontend/public/', root);
const showcase = new URL('showcase/', publicDir);
const library = JSON.parse(await readFile(new URL('assets/library/merged.json', root), 'utf8'));
// Blocked models stay in the source library for provenance and catalogue rebuilds.
const blockedFiles = new Set(library.models.filter(model => model.blockedReason).flatMap(model =>
  [model.glb, model.thumb].map(path => fileURLToPath(new URL(path.slice('/showcase/'.length), root)))));
// cp 是递归覆盖、不会删除源目录里已不存在的文件。不先清空的话，
// 之前迭代留下的图片（例如改名前的 show.png / house.jpg）会一直被打进产物。
await rm(showcase, { recursive: true, force: true });
await mkdir(showcase, { recursive: true });
for (const path of ['assets', 'vendor']) {
  await cp(new URL(path, root), new URL(path, showcase), {
    recursive: true,
    filter: source => !blockedFiles.has(resolve(source)),
  });
}
// 场景模板库已独立到 scendance-scene-library，本仓不再打包 10 套整馆 GLB；
// introduction.html 直接指向该仓库的公开站点取模板資產。
const introduction = (await readFile(new URL('introduction.html', root), 'utf8'))
  .replaceAll('http://localhost:3000/', '/auth')
  .replaceAll('./assets/', '/showcase/assets/')
  .replaceAll('./vendor/', '/showcase/vendor/')
  .replaceAll('./${a.localPath}', '/showcase/${a.localPath}');
await writeFile(new URL('introduction.html', publicDir), introduction);
const guide = (await readFile(new URL('guide.html', root), 'utf8'))
  .replaceAll('./assets/', '/showcase/assets/');
await writeFile(new URL('guide.html', publicDir), guide);
console.log(`Packaged /introduction, /guide and /showcase in ${fileURLToPath(publicDir)}`);
