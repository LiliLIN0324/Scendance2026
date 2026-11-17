#!/usr/bin/env node
/**
 * 物料能力标签生成器（2026-11-17）。
 *
 * 为什么离线生成：运行时按 slug 子串猜能力，已经被证明会把场景名当道具名
 * （portable→table、tracked→rack、festival-stage-…→stage）。这里一次性把
 * 976 行目录分成「能力标签」，产物是可 diff、可人工覆盖的数据文件，
 * 运行时只查表，不再猜。
 *
 * 用法：node scripts/build-library-capabilities.mjs
 * 产物：
 *   frontend/components/room-organizer/lib/library-capabilities.ts
 *   deliverables/library-capabilities.report.json
 *
 * 覆盖优先：OVERRIDES 里的 slug 直接定稿；其余走分类规则；规则也认不出的记 none。
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const cataloguePath = join(root, 'assets', 'library', 'merged.json');
const outTs = join(root, 'frontend', 'components', 'room-organizer', 'lib', 'library-capabilities.ts');
const outReport = join(root, 'deliverables', 'library-capabilities.report.json');

const catalogue = JSON.parse(readFileSync(cataloguePath, 'utf8'));
const rows = Array.isArray(catalogue) ? catalogue : catalogue.models ?? [];

/** 人工定稿：审计里被点名、或语义明显需要覆盖的品类。 */
const OVERRIDES = {
  // —— 售票 / 问询 / 售卖：确认能交谈 ——
  'travelling-circus-and-big-top-circus-ticket-booth-428cc272': 'talk',
  'football-soccer-club-grounds-ticket-booth-e23acd9f': 'talk',
  'bus-station-and-city-transit-ticket-office-kiosk-61214dac': 'talk',
  'scendance-plan-information-point': 'talk',
  'cinema-multiplex-and-foyer-nacho-and-hot-dog-counter-686a7c9e': 'talk',
  'indian-bazaar-street-and-temple-tea-stall-865b528a': 'talk',
  'racecourse-and-parade-ring-bar-and-food-kiosk-7eefd7a3': 'talk',
  'football-soccer-club-grounds-concession-kiosk-fc162fe3': 'talk',
  // —— 该「操作」但没有人物剪辑：ATM / 自助机 ——
  'casino-floor-and-back-rooms-atm-kiosk-ff57e849': 'operate',
  'modern-rail-and-metro-network-ticket-machine-dc3e6a42': 'operate',
  // —— 车架 / 枪架 / 观景平台：有「架/平台」但不是展柜也不是舞台 ——
  'city-park-and-playground-bike-rack-c73abcbf': 'none',
  'motorcycle-racing-and-street-bikes-trackside-bike-rack-dd2988a6': 'none',
  'mega-weapon-pack-floor-rifle-rack-3a14f603': 'none',
  'football-soccer-club-grounds-camera-platform-81d16afb': 'none',
  'safari-camp-and-bush-lodge-viewing-platform-4d5346b6': 'none',
  'zoo-and-safari-park-builder-viewing-platform-d4e7e669': 'none',
  // —— 桌椅套装：独立类，四向锚点 ——
  'scendance-plan-round-table-and-chairs': 'seat-set',
  'scendance-plan-round-table-and-chairs-parasol': 'seat-set',
};

/** slug 物件段：只取尾部 3 个词，和运行时同一口径（这里只是防止场景名前缀干扰）。 */
function objectTokens(slug) {
  return String(slug ?? '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).slice(-3);
}

const hasToken = (slug, words) => objectTokens(slug).some(token => words.includes(token));
const nameHas = (name, words) => words.some(word => name.includes(word));

const SEAT_WORDS = ['椅', '沙发', '凳', '长椅', '等候椅'];
const SEAT_TOKENS = ['chair', 'armchair', 'sofa', 'couch', 'bench', 'seat', 'stool', 'loveseat'];
const SEAT_EXCLUDE = ['飞椅', '疏散椅', '吊椅', '轮椅', '休息区'];
const SET_CHAIR = ['椅', '凳', 'chair', 'stool', 'bench'];
const SET_DESK = ['桌', '桌台', '吧台', 'counter', 'table', 'desk'];
const TALK_WORDS = ['摊', '展位', '亭', '售票', '问询', '售卖', '服务台', '前台', '吧台', '柜台', '收银', '签到'];
const STAGE_WORDS = ['舞台', '台口', '表演区', 'T台', '背景板', '主舞台'];
const OPERATE_WORDS = ['ATM', '取款机', '自助', '售票机', '闸机', '储物柜', '寄存柜', '寄存'];

/**
 * 分类：顺序即优先级。
 * 返回 { kind, actions }：kind 决定文案与落座方式，actions 决定人物动作。
 */
function classify(row) {
  const name = String(row.name ?? '');
  const slug = String(row.slug ?? '');
  const bucket = String(row.bucket ?? '');

  if (bucket === 'people') return { kind: 'person', actions: [] };

  const seatsExcluded = nameHas(name, SEAT_EXCLUDE);
  const isSet = !seatsExcluded && nameHas(name, SET_CHAIR) && nameHas(name, SET_DESK);
  if (isSet) return { kind: 'seat-set', actions: ['sit'] };

  const seatByName = !seatsExcluded && nameHas(name, SEAT_WORDS);
  const seatBySlug = !seatsExcluded && hasToken(slug, SEAT_TOKENS);
  if (bucket !== 'rides' && bucket !== 'vehicles' && (seatByName || (bucket === 'seating' && seatBySlug))) {
    return { kind: 'seat', actions: ['sit'] };
  }

  if (nameHas(name, STAGE_WORDS) || (bucket === 'stage' && hasToken(slug, ['stage', 'platform', 'catwalk']))) {
    return { kind: 'stage', actions: ['wave', 'emote'] };
  }

  if (nameHas(name, OPERATE_WORDS) && bucket !== 'tables') {
    return { kind: 'operate', actions: [] };
  }

  if (nameHas(name, TALK_WORDS)) return { kind: 'booth', actions: ['talk'] };

  if (bucket === 'tables') return { kind: 'table', actions: ['talk'] };
  if (bucket === 'exhibition') {
    // 展陈里没有「台/亭/摊」字的多是游戏与展具，不给人动作。
    return { kind: 'none', actions: [] };
  }
  if (bucket === 'stage') {
    // 音箱、桁架、灯光归舞台桶，但人不会对着音箱挥手。
    return { kind: 'none', actions: [] };
  }
  if (bucket === 'audio' || bucket === 'lighting' || bucket === 'signage') {
    return { kind: 'none', actions: [] };
  }
  if (bucket === 'food') return nameHas(name, ['台', '吧', '柜']) ? { kind: 'table', actions: ['talk'] } : { kind: 'none', actions: [] };
  if (bucket === 'storage' || bucket === 'logistics' || bucket === 'digital') {
    return { kind: 'none', actions: [] };
  }
  if (bucket === 'structure' || bucket === 'decor' || bucket === 'plants' || bucket === 'vehicles' || bucket === 'rides' || bucket === 'tools' || bucket === 'sports') {
    return { kind: 'none', actions: [] };
  }
  return { kind: 'none', actions: [] };
}

const KIND_TO_OVERRIDE = {
  talk: { kind: 'booth', actions: ['talk'] },
  operate: { kind: 'operate', actions: [] },
  none: { kind: 'none', actions: [] },
  'seat-set': { kind: 'seat-set', actions: ['sit'] },
};

const entries = {};
const summary = { total: rows.length, byKind: {}, overridden: 0, byBucket: {} };

for (const row of rows) {
  const slug = String(row.slug ?? '');
  if (!slug) continue;
  const override = OVERRIDES[slug];
  const result = override ? KIND_TO_OVERRIDE[override] ?? classify(row) : classify(row);
  const kind = result.kind;
  const actions = result.actions;
  entries[slug] = {
    kind,
    actions,
    ...(override ? { source: 'curated' } : { source: 'rule' }),
  };
  if (override) summary.overridden += 1;
  summary.byKind[kind] = (summary.byKind[kind] ?? 0) + 1;
  const bucket = String(row.bucket ?? '');
  summary.byBucket[bucket] ??= {};
  summary.byBucket[bucket][kind] = (summary.byBucket[bucket][kind] ?? 0) + 1;
}

const header = `/**
 * 物料能力标签（生成文件，请勿手改）。
 *
 * 由 \`scripts/build-library-capabilities.mjs\` 从 \`assets/library/merged.json\` 生成：
 * - \`source: 'curated'\` 是人工定稿（OVERRIDES）；
 * - \`source: 'rule'\` 是按桶 + 名称 + slug 物件段的离线分类。
 *
 * 运行时只查这张表（\`prop-capabilities.ts\`），不再按 slug 子串猜能力。
 * 新增物料后重跑生成器；要改某件物料，改 OVERRIDES 再生成，别手改本文件。
 */
import type { PropCapabilityEntry } from './prop-capabilities';

export const LIBRARY_CAPABILITIES: Readonly<Record<string, PropCapabilityEntry>> = `;

const body = JSON.stringify(entries, null, 2)
  .replace(/"kind": "([a-z-]+)"/g, '"kind": \'$1\'')
  .replace(/"actions": \[\s*\]/g, '"actions": []')
  .replace(/"actions": \[\s*"([a-z]+)"\s*\]/g, '"actions": [\'$1\']')
  .replace(/"actions": \[\s*"([a-z]+)",\s*"([a-z]+)"\s*\]/g, '"actions": [\'$1\', \'$2\']')
  .replace(/"source": "([a-z]+)"/g, '"source": \'$1\'');

mkdirSync(dirname(outReport), { recursive: true });
writeFileSync(outTs, `${header}${body};` + "\n", 'utf8');
writeFileSync(outReport, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
console.log(`entries=${Object.keys(entries).length} overridden=${summary.overridden}`);
console.log('byKind:', summary.byKind);


