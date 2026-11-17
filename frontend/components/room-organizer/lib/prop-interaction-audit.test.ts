// @vitest-environment node
/**
 * 物料 ↔ 人物漫游动作 能力基线审计（2026-11-17）。
 *
 * 不测行为，只做两件事：
 * 1. 把真实判定链（`online-models` 的可见物料库 → `prop-interactions` / `seat-placement`）
 *    整库跑一遍，产出可 diff 的 JSON 摘要；
 * 2. 断言审计本身没退化（库非空、分类总量对得上），顺带把结果写进
 *    `deliverables/material-interaction-audit.json`，供人工标注时按清单勾。
 *
 * 为什么放在 test 里：仓库里只有 vitest 这一条通道能直接跑 TS + `@/` 别名 + JSON import，
 * 又不用给脚本单开一套编译配置。跑法：
 *   cd frontend && npx vitest run components/room-organizer/lib/prop-interaction-audit.test.ts
 *
 * 口径说明（与线上一致）：
 * - 物料可见集合 = `loadOnlineModels()`（icon 关联模型 + 人物），与物料面板同一份；
 * - 名称取 `onlineModelDisplayName()`（放场上写进 PlanFacility.name 的那一份），
 *   slug 走 `modelOverride` 同口径，传成 `ref`；
 * - `tags` 显式传空数组：现在没有任何入口往这里喂标签，就是要量出「标签通道为空」的代价。
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadOnlineModels, type OnlineModel } from './online-models';
import { propInteractionProfile, type PropKind } from './prop-interactions';
import { capabilityForSlug } from './prop-capabilities';

/** 默认人物 GLB 只重定向这两条剪辑；其余动作要靠人物生成链额外产出。 */
const PERSON_CLIPS = ['Idle_Loop', 'Walk_Loop'] as const;

/** 名称/ slug 里出现这些词，人就会默认「这东西应该能坐」——用来抓漏判。 */
const SEAT_EXPECT = /椅|沙发|凳|长椅|chair|sofa|bench|seat|stool/i;

/** 名字里带这些的一开始就不该算坐具（游乐设施 / 医疗器械 / 整片休息区），不算漏判。 */
const SEAT_EXCLUDED = /飞椅|疏散椅|吊椅|轮椅|休息区/;

/** 道具词：名称里带这些字，人就会默认它该有交互——用来圈人工标注范围。 */
const PROP_WORD = /桌|台|柜|架|摊|棚|椅|凳|沙发|舞台|吧台|货架|展柜|展架|摊位|counter|table|desk|booth|stall|shelf|stage/i;

/** 人物模型不是道具：物料面板里同一栏，但物料交互判定不该把它们算进来。 */
const PEOPLE_BUCKET = 'people';

interface AuditRow {
  slug: string;
  name: string;
  bucket: string;
  size: [number, number, number];
  kind: PropKind;
  interactions: string[];
  personAction: string | null;
  /** 名称说要能坐，判定却不是 seat —— 漏判候选。 */
  seatMiss: boolean;
  /** 同一件里既有桌又有椅（套装），按桌处理，只能「交谈」不能「坐」。 */
  tableSeatSet: boolean;
  /** 声称有动作，但默认人物没有对应剪辑 —— 承诺了播不出来。 */
  clipMissing: string[];
  /** 名称像道具却判不出任何动作 —— 最该人工标注的一批。 */
  needsAnnotation: boolean;
  /** 只有 slug 命中规则、光看名称判不出来 —— 场景名前缀污染的嫌疑。 */
  actionFromSlugOnly: boolean;
  /** 能力标签来源：curated / rule / heuristic（表外新物料）。 */
  capabilitySource: 'curated' | 'rule' | 'heuristic';
}

/**
 * 与面板 `onlineModelDisplayName()` 同一口径（去掉末尾括号里的出处），
 * 但不 import 那个 .tsx —— 审计跑在 node 环境，不把 React 拖进来。
 */
function normalizeName(model: OnlineModel): string {
  const subject = model.name.replace(/\s*\([^()]*\)\s*$/, '').trim();
  return subject || model.name;
}

function auditRow(model: OnlineModel): AuditRow {
  const name = normalizeName(model);
  const capabilities = capabilityForSlug(model.slug);
  const profile = propInteractionProfile({
    id: model.slug,
    name,
    position: { x: 0, y: 0 },
    ref: model.slug,
    height: model.height,
    category: model.bucket,
    tags: [],
    capabilities,
  });
  const text = `${name} ${model.slug} ${model.bucket}`;
  const seatMiss = SEAT_EXPECT.test(text)
    && !SEAT_EXCLUDED.test(name)
    && profile.kind !== 'seat'
    && profile.kind !== 'seat-set';
  const tableSeatSet = /桌|table|desk|吧台|counter/i.test(text) && /椅|chair|sofa|stool/i.test(text);
  // 只喂名称、不喂 slug：规则若还认得出，就不是场景名前缀在替它作主。
  const nameOnly = propInteractionProfile({
    id: model.slug,
    name,
    position: { x: 0, y: 0 },
    height: model.height,
    category: model.bucket,
    tags: [],
  });
  const actionFromSlugOnly = !capabilities
    && profile.interactions.length > 0
    && nameOnly.interactions.length === 0;
  const clipMissing = profile.interactions
    .filter(interaction => interaction === 'talk' || interaction === 'wave')
    .map(interaction => (interaction === 'talk' ? 'Idle_Talking_Loop' : 'Person_Wave'))
    .filter(clip => !PERSON_CLIPS.includes(clip as (typeof PERSON_CLIPS)[number]));
  return {
    slug: model.slug,
    name,
    bucket: model.bucket,
    size: [model.width, model.depth, model.height],
    kind: profile.kind,
    interactions: profile.interactions,
    personAction: profile.personAction ?? null,
    seatMiss,
    tableSeatSet,
    clipMissing,
    actionFromSlugOnly,
    capabilitySource: capabilities?.source ?? 'heuristic',
    needsAnnotation: model.bucket !== PEOPLE_BUCKET
      && PROP_WORD.test(name)
      && profile.interactions.length === 0,
  };
}

function countBy<T extends string>(rows: readonly AuditRow[], pick: (row: AuditRow) => T): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of rows) out[pick(row)] = (out[pick(row)] ?? 0) + 1;
  return Object.fromEntries(Object.entries(out).sort((a, b) => b[1] - a[1]));
}

describe('物料 ↔ 漫游动作 能力基线审计', () => {
  it('整库跑一遍，写出 JSON 摘要', async () => {
    const index = await loadOnlineModels();
    const allRows = index.models.map(auditRow);
    // 人物不是道具：能力统计只算道具，人物单列出来说明为什么被排除。
    const people = allRows.filter(row => row.bucket === PEOPLE_BUCKET);
    const rows = allRows.filter(row => row.bucket !== PEOPLE_BUCKET);

    const seat = rows.filter(row => row.kind === 'seat');
    /** 桌椅套装单列：它们是新的 kind，不再计进 seat。 */
    const seatSet = rows.filter(row => row.kind === 'seat-set');
    const talk = rows.filter(row => row.interactions.includes('talk'));
    const wave = rows.filter(row => row.interactions.includes('wave'));
    const unknown = rows.filter(row => row.kind === 'unknown');
    const noAction = rows.filter(row => row.interactions.length === 0);
    const seatMiss = rows.filter(row => row.seatMiss);
    const needsAnnotation = rows.filter(row => row.needsAnnotation);
    const tableSeatSet = rows.filter(row => row.tableSeatSet);
    const clipMissing = rows.filter(row => row.clipMissing.length > 0);
    const slugOnly = rows.filter(row => row.actionFromSlugOnly);
    const curated = rows.filter(row => row.capabilitySource === 'curated');
    const ruleLabelled = rows.filter(row => row.capabilitySource === 'rule');
    const heuristic = rows.filter(row => row.capabilitySource === 'heuristic');

    const summary = {
      generatedAt: new Date().toISOString(),
      library: {
        models: allRows.length,
        props: rows.length,
        people: people.length,
        buckets: index.buckets.map(bucket => ({ key: bucket.key, count: bucket.count })),
      },
      totals: {
        seat: seat.length,
        seatSet: seatSet.length,
        talk: talk.length,
        wave: wave.length,
        noAction: noAction.length,
        unknown: unknown.length,
        seatMiss: seatMiss.length,
        needsAnnotation: needsAnnotation.length,
        tableSeatSet: tableSeatSet.length,
        clipMissing: clipMissing.length,
        actionFromSlugOnly: slugOnly.length,
        curated: curated.length,
        ruleLabelled: ruleLabelled.length,
        heuristic: heuristic.length,
        labelled: curated.length + ruleLabelled.length,
      },
      byKind: countBy(rows, row => row.kind),
      byBucket: countBy(rows, row => row.bucket),
      /** 名称说能坐、判定不是 seat：先修这批。 */
      seatMiss: seatMiss.map(row => ({ slug: row.slug, name: row.name, bucket: row.bucket, kind: row.kind })),
      /** 家具类目但一个新动作都没有：人工标注的主战场。 */
      needsAnnotation: needsAnnotation.map(row => ({ slug: row.slug, name: row.name, bucket: row.bucket, size: row.size })),
      /** 桌椅套装：按桌判，缺「坐」。 */
      tableSeatSet: tableSeatSet.slice(0, 40).map(row => ({ slug: row.slug, name: row.name, kind: row.kind })),
      /** 有动作但人物没剪辑。 */
      clipMissing: clipMissing.slice(0, 40).map(row => ({ slug: row.slug, name: row.name, actions: row.interactions, missing: row.clipMissing })),
      /** 只有 slug 能命中：能力表外的物料才可能出现（表内一律按标签定稿）。 */
      actionFromSlugOnly: slugOnly.map(row => ({ slug: row.slug, name: row.name, bucket: row.bucket, actions: row.interactions })),
      /** 表外物料：新增目录后未重跑生成器，才会落在这里。 */
      unlabelled: heuristic.map(row => ({ slug: row.slug, name: row.name, bucket: row.bucket })),
      seatSamples: seat.slice(0, 30).map(row => ({ slug: row.slug, name: row.name, bucket: row.bucket })),
      unknownSamples: unknown.slice(0, 40).map(row => ({ slug: row.slug, name: row.name, bucket: row.bucket, size: row.size })),
      rows,
    };

    const out = fileURLToPath(new URL('../../../../deliverables/material-interaction-audit.json', import.meta.url));
    mkdirSync(fileURLToPath(new URL('../../../../deliverables/', import.meta.url)), { recursive: true });
    writeFileSync(out, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');

    // 审计自身的守卫：库为空说明数据链断了，数字就没有意义。
    expect(rows.length).toBeGreaterThan(100);
    expect(allRows.length).toBe(rows.length + people.length);
    expect(seat.length + seatSet.length + talk.length + wave.length + noAction.length).toBe(rows.length);
    // 库写出来了才允许通过（路径/权限坏了要立刻看见）。
    expect(out.endsWith('material-interaction-audit.json')).toBe(true);
  });
});
