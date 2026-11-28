import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * 工作台外壳的收口（2026-11-28 用户：「画面左侧有一个 border、然后一个圆角，右侧又是贴边的」）。
 *
 * 背景：这套外壳是三个人分三次拼起来的——轨+左栏的「浮起白纸」是 8c31bc92（2026-11-19），
 * 画布栏 `padding: 6px 8px 6px 8px` 是 13999060d（2026-10-28），户外 2D 的 surface 用
 * `position:absolute; inset:0`（acb1223c，2026-11-12）把画布栏的 8px 垫边整个盖掉。
 * 结果：左边是 10px 内缩的圆角卡，右边是 8px 空隙的方角裸面，同一窗口两种收口。
 *
 * 收敛口径：纸张从轨道一直画到画布——四周留白一律 10px，外缘 16px 圆角（左端归轨道、
 * 右端归画布），中段（左栏）不收口；干净看图时画布自己就是整张纸，四角全圆。
 * 这里按「位置」断言：同一条规则里的留白/圆角/裁剪必须同时成立，只蓝一个值不算。
 */
const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../../app/globals.css'), 'utf8')
  .replace(/\r\n/g, '\n');

const norm = (text: string) => text.replace(/\s+/g, ' ').trim();

/**
 * 取某个选择器所在的声明块（支持逗号分组：选择器可以排在组首或组尾）。
 * 不用「拆全表」的写法：@media 嵌套时花括号配对会被打乱，逐选择器找更稳。
 */
function blocksFor(selector: string): string[] {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`${escaped}\\s*(?:,\\s*[^{}]+)?\\{([^{}]*)\\}`, 'g');
  return [...css.matchAll(pattern)].map(match => norm(match[1] ?? ''));
}

/** 取带指定标记的那一条声明块；没有标记就取第一条。 */
function rule(selector: string, marker?: string): string {
  const bodies = blocksFor(selector);
  if (!marker) return bodies[0] ?? '';
  return bodies.find(body => body.includes(marker)) ?? '';
}

const WORKSPACE = '.sc-workbench .sc-workspace.is-docked-layout.is-mode-rail';
const STAGE = '.sc-workbench .is-docked-layout.is-mode-rail > .sc-canvas-stage';

describe('工作台外壳：左右同一个收口', () => {
  it('桌面四周留白一致（不再左 10 右 8）', () => {
    expect(rule(WORKSPACE, 'padding: 10px;')).toContain('padding: 10px;');
    // 旧的 4 值写法（左 10 / 右 8）不许再出现
    expect(blocksFor(WORKSPACE).join(' ')).not.toContain('10px 8px 10px 10px');
  });

  it('轨道只做纸张的左端：右侧不收口', () => {
    // 同一选择器上还有过渡态规则，按圆角声明取那一条
    const rail = rule(`${WORKSPACE} > .sc-mode-rail`, 'border-radius: 16px 0 0 16px');
    expect(rail).toContain('border-radius: 16px 0 0 16px');
    const railAlone = blocksFor(`${WORKSPACE}:not(.has-left-column) > .sc-mode-rail`).join(' ');
    expect(railAlone).toContain('border-radius: 16px 0 0 16px');
  });

  it('左栏是纸张中段：右侧不再自己收口，接缝是一条直线', () => {
    const column = rule(`${WORKSPACE}.has-left-column:not(.is-empty-dock) > .sc-left-column`);
    expect(column).toContain('border-radius: 0;');
    expect(column).not.toContain('0 16px 16px 0');
  });

  it('画布是纸张的右端：右侧 16px 圆角 + 发丝边 + 阴影', () => {
    const stage = rule(STAGE, 'border-radius: 0 16px 16px 0');
    expect(stage).toContain('border-radius: 0 16px 16px 0');
    expect(stage).toContain('border: 1px solid var(--wk-hair)');
    expect(stage).toContain('box-shadow: var(--e1)');
    // 画布栏自身不裁：工具提示 / 拖拽幽灵要能向外出头
    expect(stage).not.toContain('overflow: hidden');
  });

  it('地图本体跟着圆角走：只裁户外 2D 的 surface', () => {
    const surface = rule(`${STAGE} [data-testid="outdoor-plan-surface"]`, 'border-radius: 0 16px 16px 0');
    expect(surface).toContain('border-radius: 0 16px 16px 0');
    // 不裁的话地图瓦片是方的，圆角只在外框上，看着像双重角
    expect(surface).toContain('overflow: hidden');
  });

  it('干净看图（轨道也收进）时画布自己就是整张纸：四角全圆', () => {
    const hidden = rule(`${WORKSPACE}.is-chrome-hidden > .sc-canvas-stage`, 'border-radius: 16px');
    expect(hidden).toContain('border-radius: 16px');
    const hiddenSurface = rule(`${WORKSPACE}.is-chrome-hidden > .sc-canvas-stage [data-testid="outdoor-plan-surface"]`, 'border-radius: 16px');
    expect(hiddenSurface).toContain('border-radius: 16px');
  });

  it('3D 场景视图的圆角跟纸张同口径，四角不留白月牙', () => {
    const scene = rule('.sc-workbench .is-docked-layout.is-mode-rail .sc-canvas-stage .sc-scene-viewport');
    expect(scene).toContain('border-radius: 16px');
  });
});
