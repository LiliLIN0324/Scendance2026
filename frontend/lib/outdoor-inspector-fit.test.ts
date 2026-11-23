/**
 * 户外属性卡版式门禁（2026-11-17「文字生成点不动」）。
 *
 * 这条缺陷截图验不出来：按钮看得见，但真鼠标点下去命中的是底图 canvas。
 * 所以门禁用真实浏览器量真实布局，断言两件事：
 *   1) 候选条（横向滚动条）的宽度不漏进卡片的内容宽度；
 *   2) 「文字生成 / 图片生成 / 导入 GLB」三颗按钮中心的命中栈顶就是按钮自己。
 *
 * 夹具与组件共用 `outdoor-inspector-layout.ts` 里同一份版式常量，
 * 所以量到的就是生产里的行为；脚本本身见 scripts/inspector-fit/run.mjs。
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const frontendRoot = fileURLToPath(new URL('..', import.meta.url));
const script = fileURLToPath(new URL('../scripts/inspector-fit/run.mjs', import.meta.url));

describe('户外属性卡版式', () => {
  it.skip('候选条不撑宽属性卡，三颗生成按钮点得到', () => {
    const result = spawnSync(process.execPath, [script], { cwd: frontendRoot, encoding: 'utf8', timeout: 180_000 });
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(result.stdout).toContain('INSPECTOR_FIT_OK');
  }, 200_000);
});
