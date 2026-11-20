import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ONBOARDING_TOUR_IDS } from './onboarding-state';
import { FIRST_RUN_TOUR, TOUR_ANCHORS, TOUR_SCRIPTS, tourScript } from './tour-steps';

const here = dirname(fileURLToPath(import.meta.url));
/** onboarding/ 的上两级：components/room-organizer → components → frontend。 */
const frontendRoot = join(here, '..', '..', '..');

/**
 * 把生产源码（排除测试）读成一份文本：引导指的是真实控件，控件改名了这条测试就该红。
 * 只读 .tsx / .ts 的界面文件，扫一次约 340 个文件。
 */
let sourceDump: string | null = null;
function productionSource(): string {
  if (sourceDump !== null) return sourceDump;
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === '.next' || entry.name === 'out') continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) { walk(path); continue; }
      if (!entry.name.endsWith('.tsx')) continue;
      if (entry.name.includes('.test.')) continue;
      files.push(path);
    }
  };
  walk(join(frontendRoot, 'components'));
  walk(join(frontendRoot, 'app'));
  sourceDump = files.map(path => readFileSync(path, 'utf8')).join('\n');
  return sourceDump;
}

/** 选择器 → 源码里应当出现的字面量；认不出形态的直接算失败。 */
function requiredLiteral(selector: string): string | null {
  const attribute = /^\[(data-tour|data-testid|aria-label)="([^"]+)"\]$/.exec(selector);
  if (attribute) return `${attribute[1]}="${attribute[2]}"`;
  const byId = /^#([\w-]+)$/.exec(selector);
  if (byId) return `id="${byId[1]}"`;
  return null;
}

const ALL_STEPS = TOUR_SCRIPTS.flatMap(script => script.steps.map(step => ({ script, step })));

describe('tour scripts (2026-11-20 全局引导内容)', () => {
  it('registers exactly one script per state-layer tour id', () => {
    expect(TOUR_SCRIPTS.map(script => script.id).sort()).toEqual([...ONBOARDING_TOUR_IDS].sort());
    expect(new Set(TOUR_SCRIPTS.map(script => script.id)).size).toBe(TOUR_SCRIPTS.length);
  });

  it('throws on an unregistered id instead of silently showing an empty tour', () => {
    expect(() => tourScript('nope' as never)).toThrow(/未登记的引导航线/);
    expect(tourScript('first-run')).toBe(FIRST_RUN_TOUR);
  });

  it('auto-starts only the first-run line, and that line is the documented five steps', () => {
    expect(TOUR_SCRIPTS.filter(script => script.auto).map(script => script.id)).toEqual(['first-run']);
    expect(FIRST_RUN_TOUR.steps.map(step => step.id)).toEqual(['site', 'ask', 'scope', 'view3d', 'publish']);
    expect(FIRST_RUN_TOUR.note).toContain('认场地');
  });

  it('gives every step readable copy and unique ids inside its line', () => {
    for (const { script, step } of ALL_STEPS) {
      expect(step.id, script.id).toMatch(/^[a-z][\w-]*$/);
      expect(step.title.trim().length, `${script.id}/${step.id} 标题`).toBeGreaterThan(3);
      expect(step.body.trim().length, `${script.id}/${step.id} 正文`).toBeGreaterThan(12);
      expect(script.steps.filter(other => other.id === step.id).length, `${script.id}/${step.id} 重复`).toBe(1);
    }
    const main = TOUR_SCRIPTS.filter(script => !script.id.startsWith('topic-'));
    expect(main.every(script => script.steps.length >= 2)).toBe(true);
    // 单点提示别长成第二套教程。
    expect(TOUR_SCRIPTS.filter(script => script.id.startsWith('topic-')).every(script => script.steps.length <= 2)).toBe(true);
  });

  it('points only at controls that really render — no invented selectors', () => {
    const source = productionSource();
    expect(source.length, '源码扫描为空，这条护栏失去意义').toBeGreaterThan(100_000);
    for (const { script, step } of ALL_STEPS) {
      if (step.target === null) continue;
      const literal = requiredLiteral(step.target);
      expect(literal, `${script.id}/${step.id} 的选择器形态不认识：${step.target}`).not.toBeNull();
      expect(source, `${script.id}/${step.id} 指向不存在的控件：${step.target}`).toContain(literal!);
    }
  });

  it('keeps every declared anchor in use', () => {
    const used = new Set(ALL_STEPS.map(entry => entry.step.target));
    for (const [name, selector] of Object.entries(TOUR_ANCHORS)) {
      expect(used.has(selector), `锚点 ${name} 已无人引用，删掉或接回步骤`).toBe(true);
    }
  });

  it('never claims the guide clicks for the user', () => {
    // 引导只指路：发送 / 确认 / 发布都是写操作，自动点按会真的落到方案和云端。
    const copy = JSON.stringify(TOUR_SCRIPTS);
    for (const phrase of ['已帮你', '帮你点', '自动发送', '自动确认', '替你点', '我已经']) {
      expect(copy, `文案越界：${phrase}`).not.toContain(phrase);
    }
    expect(copy).not.toContain('遮罩');
  });

  it('talks about the current chrome, not retired forms', () => {
    const copy = JSON.stringify(TOUR_SCRIPTS);
    // 物料库开在左栏，2026-11 之后不再是「底部物料架」；旧室内形态也不复存在。
    for (const stale of ['底部物料架', '右侧图层栈', '九钮', '分段胶囊']) {
      expect(copy, `文案停在旧形态：${stale}`).not.toContain(stale);
    }
    expect(copy).toContain('左轨');
    expect(copy).toContain('添加物件');
    expect(copy).toContain('已放置物件');
  });
});
