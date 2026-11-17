// @vitest-environment node
/**
 * 能力标签的守卫与搜索（2026-11-17）。
 *
 * 两件事：
 * 1. 防漂移：目录（merged.json）新增物料后忘了重跑生成器，这里立刻红；
 * 2. 能力表与 3D / 属性卡同口径；搜索已回到普通全文匹配（能力词检索不是产品路径）。
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LIBRARY_CAPABILITIES } from './library-capabilities';
import { capabilityForSlug } from './prop-capabilities';

const catalogue = JSON.parse(
  readFileSync(new URL('../../../../assets/library/merged.json', import.meta.url), 'utf8'),
) as { models: Array<{ slug: string }> };
const rows = catalogue.models;

describe('能力标签表', () => {
  it('目录每一行都有标签（新增物料后必须重跑生成器）', () => {
    const missing = rows.filter(row => !LIBRARY_CAPABILITIES[row.slug]).map(row => row.slug);
    expect(missing).toEqual([]);
    expect(Object.keys(LIBRARY_CAPABILITIES)).toHaveLength(rows.length);
  });

  it('标签的 kind 与 actions 自洽', () => {
    const validKinds = new Set(['seat', 'seat-set', 'table', 'stage', 'booth', 'display', 'operate', 'none', 'person']);
    for (const [slug, entry] of Object.entries(LIBRARY_CAPABILITIES)) {
      expect(validKinds.has(entry.kind), slug).toBe(true);
      if (entry.kind === 'seat' || entry.kind === 'seat-set') expect(entry.actions, slug).toContain('sit');
      if (entry.kind === 'none' || entry.kind === 'operate') expect(entry.actions, slug).toEqual([]);
    }
  });

  it('人工定稿的边界件按预期落位', () => {
    // 19 件 slug-only 偏判里的代表：ATM 可操作、车架/平台不交互、售票亭可交谈。
    expect(capabilityForSlug('casino-floor-and-back-rooms-atm-kiosk-ff57e849')?.kind).toBe('operate');
    expect(capabilityForSlug('city-park-and-playground-bike-rack-c73abcbf')?.kind).toBe('none');
    expect(capabilityForSlug('safari-camp-and-bush-lodge-viewing-platform-4d5346b6')?.kind).toBe('none');
    expect(capabilityForSlug('football-soccer-club-grounds-ticket-booth-e23acd9f')?.actions).toContain('talk');
  });
});
