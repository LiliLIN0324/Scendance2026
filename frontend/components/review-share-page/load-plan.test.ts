import { describe, expect, it } from 'vitest';
import { STORAGE_KEY } from '../room-organizer/lib/constants';
import { INITIAL_LAYOUT } from '../room-organizer/lib/initial-layout';
import { encodeShareUrl } from '../room-organizer/lib/share';
import {
  loadReviewPlan,
  localPlanKey,
  readLocalReviewLayout,
  REVIEW_PLAN_NOTICES,
  REVIEW_SHARE_PATH,
  reviewShareHref,
} from './load-plan';
import type { RoomLayout } from '../room-organizer/lib/types';

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
  it('builds a /review/ link from the editor hash and opens that snapshot', async () => {
    const encoded = await encodeShareUrl({ ...INITIAL_LAYOUT, name: '发布会主场' }, 'https://app.example/editor');
    const hash = new URL(encoded.url).hash;
    const href = reviewShareHref('https://app.example/editor?local=1', hash);
    expect(href).toBe(`https://app.example${REVIEW_SHARE_PATH}${hash}`);
    const loaded = await loadReviewPlan({ hash, search: '?demo=1', localLayout: { ...INITIAL_LAYOUT, name: '本机另一份' } });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.plan.source).toBe('link');
    expect(loaded.plan.layout.name).toBe('发布会主场');
    expect(loaded.plan.notice).toBe(REVIEW_PLAN_NOTICES.link);
    const again = await loadReviewPlan({ hash, search: '', localLayout: null });
    expect(again.ok && again.plan.planKey).toBe(loaded.plan.planKey);
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
