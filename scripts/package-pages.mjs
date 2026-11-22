import { cp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// 幕景 官网页面的源文件已经在 frontend/public/introduction.html，next dev 与
// next build 都直接消费它，不再复制一份——历史上「根文件 + public 副本」两份
// 内容不同步过（改了根文件，浏览器还在看旧副本）。
// 新手指引 guide.html 仍在仓库根，这里镜像进 frontend/public/，让一份产物同时服务两种模式：
//   next dev            → /guide 与 /showcase/* 直接由 public/ 提供
//   next build (export) → public/ 会被复制进 frontend/out/
// 由 frontend 的 npm 脚本（`dev` / `build`）调用，不要手工跑。
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
// introduction.html 不再改写：源文件就在 public/ 里，资源一律写 /showcase/ 绝对路径。
const guide = (await readFile(new URL('guide.html', root), 'utf8'))
  .replaceAll('./assets/', '/showcase/assets/');
await writeFile(new URL('guide.html', publicDir), guide);
console.log(`Packaged /guide and /showcase in ${fileURLToPath(publicDir)}`);
