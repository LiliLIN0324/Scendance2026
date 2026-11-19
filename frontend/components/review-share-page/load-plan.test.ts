import { describe, expect, it, vi } from 'vitest';
import { STORAGE_KEY } from '../room-organizer/lib/constants';
import { INITIAL_LAYOUT } from '../room-organizer/lib/initial-layout';
import { collectViolations } from '../../lib/placement-rules';
import { encodeShareUrl } from '../room-organizer/lib/share';
import { createStarterOutdoorPlan } from '../room-organizer/lib/outdoor-project-store';
import { readReviewLink } from './review-link-cloud';
import {
  loadReviewPlan,
  localPlanKey,
  readLocalReviewLayout,
  REVIEW_PLAN_NOTICES,
  REVIEW_SHARE_PATH,
  reviewShareHref,
} from './load-plan';
import type { RoomLayout } from '../room-organizer/lib/types';

vi.mock('./review-link-cloud', async importOriginal => {
  const actual = await importOriginal<typeof import('./review-link-cloud')>();
  return { ...actual, readReviewLink: vi.fn() };
});

function memory(): Storage {
  const data = new Map<string, string>();
  return {
    get length() { return data.size; },
    clear: () => data.clear(),
    getItem: (key) => data.get(key) ?? null,
    key: (index) => [...data.keys()][index] ?? null,
    removeItem: (key) => { data.delete(key); },
    setItem: (key, value) => { data.set(key, value); },
  };
}

describe('review share plan loading', () => {
  it('独立示例不读取现有项目内容，且分享会无粗略检查告警', async () => {
    const existing={...INITIAL_LAYOUT,name:'不应出现在示例中的项目'};
    const result=await loadReviewPlan({hash:'',search:'?example=sharing',localLayout:existing});
    expect(result.ok).toBe(true);
    if(!result.ok)return;
    expect(result.plan.layout.name).toContain('虚构');
    expect(result.plan.layout.floors[0]!.items.filter(item=>item.type==='chair')).toHaveLength(16);
    expect(result.plan.layout.id).toBeUndefined();
    expect(result.plan.notice).toContain('均为示意');
    expect(collectViolations(result.plan.layout)).toEqual([]);
  });

  it('Hall D5 只展示官方标称尺寸与空的示意矩形，不继承原场地事实', async () => {
    const existing={...INITIAL_LAYOUT,name:'已有项目',id:'existing-activity'};
    const result=await loadReviewPlan({hash:'',search:'?example=hall-d5',localLayout:existing});
    expect(result.ok).toBe(true);
    if(!result.ok)return;
    expect(result.plan.layout).toMatchObject({width:16.5,height:17.2});
    expect(result.plan.layout.id).toBeUndefined();
    expect(result.plan.layout.floors[0]!.items).toEqual([]);
    expect(result.plan.layout.backendVenue).toBeUndefined();
    expect(result.plan.layout.backendSceneV2).toBeUndefined();
    expect(result.plan.notice).toContain('门位、门宽、开启方向、通道及现场条件未知');
    expect(result.plan.notice).toContain('未作消防或无障碍验收');
  });
  it('builds a /review/ link from the editor hash and opens that snapshot', async () => {
    const encoded = await encodeShareUrl({ ...INITIAL_LAYOUT, name: '发布会主场' }, 'https://app.example/editor');
    const hash = new URL(encoded.url).hash;
    const href = reviewShareHref('https://app.example/editor?local=1', hash);
    expect(href).toBe(`https://app.example${REVIEW_SHARE_PATH}${hash}`);
    expect(reviewShareHref('https://app.example/editor?local=1', hash, 'abcdef123456'))
      .toBe('https://app.example/r/abcdef123456');
    const loaded = await loadReviewPlan({ hash, search: '?demo=1', localLayout: { ...INITIAL_LAYOUT, name: '本机另一份' } });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.plan.source).toBe('link');
    expect(loaded.plan.layout.name).toBe('发布会主场');
    expect(loaded.plan.notice).toBe(REVIEW_PLAN_NOTICES.link);
    expect(loaded.plan.identity).toMatchObject({ deliveryVersion: 'v1.0', status: 'draft', verified: true });
    expect(loaded.plan.identity?.snapshotId).toBe(encoded.identity.snapshotId);
    const again = await loadReviewPlan({ hash, search: '', localLayout: null });
    expect(again.ok && again.plan.planKey).toBe(loaded.plan.planKey);
  });
  it('opens a short link and keeps the canonical long hash for pins and receipts', async () => {
    const encoded = await encodeShareUrl({ ...INITIAL_LAYOUT, name: '短链方案' }, 'https://app.example/editor');
    const longHash = new URL(encoded.url).hash;
    vi.mocked(readReviewLink).mockResolvedValueOnce({ ok: true, value: { longHash, payload: encoded.payload } });

    const short = await loadReviewPlan({ hash: '', search: '', pathname: '/r/abcdef123456', localLayout: null });
    const long = await loadReviewPlan({ hash: longHash, search: '', localLayout: null });
    expect(short.ok).toBe(true);
    expect(long.ok).toBe(true);
    if (!short.ok || !long.ok) return;
    expect(short.plan.layout.name).toBe('短链方案');
    expect(short.plan.shareHash).toBe(longHash);
    expect(short.plan.planKey).toBe(long.plan.planKey);
    expect(short.plan.identity).toEqual(long.plan.identity);
    expect(short.plan.reviewAccess).toMatchObject({ pins: true, levels: true, basemap: true, basemapStyle: 'map' });

    vi.mocked(readReviewLink).mockResolvedValueOnce({ ok: false, reason: 'not-found' });
    await expect(loadReviewPlan({ hash: '#review=abcdef123456', search: '', localLayout: null }))
      .resolves.toEqual({ ok: false, reason: 'not-found' });
  });

  it('keeps send-time locks that were stored beside the snapshot', async () => {
    const encoded = await encodeShareUrl({ ...INITIAL_LAYOUT, name: '锁定方案' }, 'https://app.example/editor');
    const longHash = new URL(encoded.url).hash;
    vi.mocked(readReviewLink).mockResolvedValueOnce({
      ok: true,
      value: {
        longHash,
        payload: {
          ...encoded.payload,
          reviewAccess: { pins: false, levels: false, basemap: false, levelId: 'level-2', basemapStyle: 'satellite' },
        },
      },
    });
    const loaded = await loadReviewPlan({ hash: '', search: '', pathname: '/r/abcdef123456', localLayout: null });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.plan.reviewAccess).toEqual({
      pins: false,
      levels: false,
      basemap: false,
      levelId: 'level-2',
      basemapStyle: 'satellite',
    });
    expect(loaded.plan.layout.name).toBe('锁定方案');
  });

  it('carries the outdoor site plan in the review link', async () => {
    const outdoor = createStarterOutdoorPlan();
    const encoded = await encodeShareUrl(INITIAL_LAYOUT, 'https://app.example/editor', outdoor);
    const hash = new URL(encoded.url).hash;
    const result = await loadReviewPlan({ hash, search: '', localLayout: null });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.outdoorPlan?.schemaVersion).toBe(1);
    expect(result.plan.outdoorPlan?.anchor?.lng).toBe(outdoor.anchor?.lng);
  });

  it('opens an older link without a version section and keeps local/sample plans unversioned', async () => {
    const legacy = `#layout=${Buffer.from(JSON.stringify({ ...INITIAL_LAYOUT, name: '旧链接' })).toString('base64url')}`;
    const loaded = await loadReviewPlan({ hash: legacy, search: '', localLayout: null });
    expect(loaded.ok && loaded.plan.layout.name).toBe('旧链接');
    expect(loaded.ok && loaded.plan.identity).toBeNull();
    const local = await loadReviewPlan({ hash: '', search: '', localLayout: INITIAL_LAYOUT });
    expect(local.ok && local.plan.identity).toBeNull();
  });

  it('stops on a broken hash instead of showing another plan', async () => {
    const broken = await loadReviewPlan({ hash: '#layout=!!!', search: '', localLayout: INITIAL_LAYOUT });
    expect(broken).toEqual({ ok: false, reason: 'unreadable' });
    const huge = `#layout=${'a'.repeat(70_000)}`;
    const oversized = await loadReviewPlan({ hash: huge, search: '', localLayout: null });
    expect(oversized).toEqual({ ok: false, reason: 'too-large' });
    expect(reviewShareHref('https://app.example', '#other')).toBeNull();
    expect(reviewShareHref('not a url', '#layout=abc')).toBeNull();
  });

  it('uses the saved local plan, the sample, or demo=1', async () => {
    const local = { ...INITIAL_LAYOUT, id: 'local-plan-1', name: '本机共创' } satisfies RoomLayout;
    const fromLocal = await loadReviewPlan({ hash: '', search: '', localLayout: local });
    expect(fromLocal.ok && fromLocal.plan.source).toBe('local');
    expect(fromLocal.ok && fromLocal.plan.layout.name).toBe('本机共创');
    expect(fromLocal.ok && fromLocal.plan.planKey).toBe('local:local-plan-1');
    const sample = await loadReviewPlan({ hash: '', search: '', localLayout: null });
    expect(sample.ok && sample.plan.source).toBe('sample');
    expect(sample.ok && sample.plan.planKey).toBe('sample:initial');
    expect(sample.ok && sample.plan.layout.name).toBe(INITIAL_LAYOUT.name);
    const forced = await loadReviewPlan({ hash: '', search: '?demo=1', localLayout: local });
    expect(forced.ok && forced.plan.source).toBe('sample');
  });

  it('reads a stored editor layout and keeps a stable key when it has no id', () => {
    const storage = memory();
    const saved = { ...INITIAL_LAYOUT, name: '周末场' };
    storage.setItem(STORAGE_KEY, JSON.stringify(saved));
    const layout = readLocalReviewLayout(storage);
    expect(layout?.name).toBe('周末场');
    expect(localPlanKey(saved)).toBe(localPlanKey({ ...saved, width: saved.width }));
    expect(localPlanKey({ ...saved, name: '另一场' })).not.toBe(localPlanKey(saved));
    storage.setItem(STORAGE_KEY, '{');
    expect(readLocalReviewLayout(storage)).toBeNull();
  });
});
