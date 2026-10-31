'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { layoutToSvg } from '../room-organizer/lib/plan-export/svg';
import {
  appendReviewComment,
  commentThreads,
  readReviewComments,
  REVIEW_COMMENT_AUTHOR_MAX,
  REVIEW_COMMENT_BODY_MAX,
  REVIEW_COMMENT_STORAGE_KEY,
  type ReviewComment,
  type ReviewCommentFailure,
} from './comments';
import {
  loadReviewPlan,
  readLocalReviewLayout,
  REVIEW_PLAN_ERRORS,
  type LoadedReviewPlan,
} from './load-plan';
import { markReviewReturned, readReviewReturn } from './review-return';
import type { FloorLayout, FurnitureItem, RoomLayout } from '../room-organizer/lib/types';

const FORM_ERRORS: Record<ReviewCommentFailure, string> = {
  author: '请填写称呼，最多 24 个字。',
  body: '请写下意见，最多 500 个字。',
  'reply-target': '要回复的那条评论已经不在了。',
  'reply-nested': '回复只到一层。请直接回复原来的那条意见。',
  full: '这份方案的演示评论已有 80 条，新的意见没有保存。',
  storage: '浏览器没有收下这条评论。',
  plan: '这条评论没有对应的方案，没有保存。',
};

type Phase =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; plan: LoadedReviewPlan };

export function ReviewSharePage(): JSX.Element {
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [floorIndex, setFloorIndex] = useState(0);
  const [comments, setComments] = useState<ReviewComment[]>([]);
  const [author, setAuthor] = useState('');
  const [body, setBody] = useState('');
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [formError, setFormError] = useState('');
  const [returned, setReturned] = useState(false);
  const [returnNote, setReturnNote] = useState('');

  useEffect(() => {
    let active = true;
    let ticket = 0;
    const load = () => {
      const current = ++ticket;
      setPhase({ kind: 'loading' });
      const localLayout = readLocalReviewLayout(safeStorage());
      void loadReviewPlan({
        hash: window.location.hash,
        search: window.location.search,
        localLayout,
      }).then((result) => {
        if (!active || current !== ticket) return;
        setFloorIndex(0);
        setBody('');
        setReplyTo(null);
        setFormError('');
        if (!result.ok) {
          setPhase({ kind: 'error', message: REVIEW_PLAN_ERRORS[result.reason] });
          setComments([]);
          return;
        }
        const stored = readStored(result.plan.planKey);
        setComments(stored.comments);
        setAuthor(stored.lastAuthor);
        const receipt = readReviewReturn(safeStorage());
        const already = receipt?.planKey === result.plan.planKey;
        setReturned(already);
        setReturnNote(already ? '这份方案已记下完成。创作者在这台浏览器收起球时，球会带上红环。' : '');
        setPhase({ kind: 'ready', plan: result.plan });
      });
    };
    load();
    window.addEventListener('hashchange', load);
    return () => {
      active = false;
      ticket += 1;
      window.removeEventListener('hashchange', load);
    };
  }, []);

  useEffect(() => {
    if (replyTo && !comments.some((comment) => comment.id === replyTo && comment.parentId === null)) {
      setReplyTo(null);
    }
  }, [comments, replyTo]);

  const plan = phase.kind === 'ready' ? phase.plan : null;
  const floor = plan ? plan.layout.floors[floorIndex] ?? plan.layout.floors[0] : undefined;
  const svg = useMemo(() => (plan && floor ? safeSvg(plan.layout, floor) : null), [plan, floor]);
  const legend = floor ? itemLegend(floor.items) : { rows: [], hidden: 0 };
  const threads = commentThreads(comments);
  const replyTarget = replyTo ? comments.find((comment) => comment.id === replyTo) ?? null : null;

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!plan) return;
    const storage = safeStorage();
    if (!storage) {
      setFormError(FORM_ERRORS.storage);
      return;
    }
    const result = appendReviewComment(storage, {
      planKey: plan.planKey,
      author,
      body,
      parentId: replyTo,
    });
    if (!result.ok) {
      setFormError(FORM_ERRORS[result.reason]);
      return;
    }
    setComments(result.comments);
    setAuthor(result.lastAuthor);
    setBody('');
    setReplyTo(null);
    setFormError('');
  };

  const onComplete = () => {
    if (!plan) return;
    const storage = safeStorage();
    if (!storage) {
      setReturnNote('这台浏览器没有记下完成。');
      return;
    }
    const result = markReviewReturned(storage, { planKey: plan.planKey });
    if (!result.ok) {
      setReturnNote('这台浏览器没有记下完成。');
      return;
    }
    setReturned(true);
    setReturnNote('已记下完成。创作者在这台浏览器打开工作台并收起球时，球会带上红环。');
  };

  return (
    <main className="rsp" data-review-share-page="true" data-review-side="client" data-review-source={plan?.source ?? phase.kind}>
      <header className="rsp-mast">
        <p className="rsp-brand"><span>幕景</span><small>Scendance</small></p>
        <p className="rsp-mast-status">可评论方案 · 只读</p>
      </header>
      {phase.kind === 'loading' ? (
        <section className="rsp-state" role="status"><h1>正在打开方案</h1><p>正在读取平面。</p></section>
      ) : phase.kind === 'error' ? (
        <section className="rsp-state" role="alert"><h1>评审链接没有打开</h1><p>{phase.message}</p></section>
      ) : plan && floor ? (
        <div className="rsp-main">
          <section className="rsp-plan" aria-labelledby="rsp-plan-title">
            <p className="rsp-kicker">平面预览</p>
            <h1 id="rsp-plan-title">{plan.layout.name}</h1>
            <p className="rsp-meta">{metres(plan.layout.width)} × {metres(plan.layout.height)} 米 · {floor.name} · 平面上 {placedCount(floor.items)} 件</p>
            <p className="rsp-notice">{plan.notice}</p>
            {plan.layout.floors.length > 1 && (
              <div className="rsp-floors" role="group" aria-label="楼层">
                {plan.layout.floors.map((entry, index) => (
                  <button key={entry.id} type="button" aria-pressed={entry.id === floor.id} onClick={() => setFloorIndex(index)}>{entry.name}</button>
                ))}
              </div>
            )}
            <div className="rsp-sheet">
              {svg ? <PlanSheet src={svgSrc(svg)} alt={`${plan.layout.name}，${floor.name}平面预览`} /> : (
                <p className="rsp-sheet-fallback" role="status">这层平面暂时画不出来。下面仍列出场内物件。</p>
              )}
            </div>
            <div className="rsp-legend">
              <h2>场内物件</h2>
              {legend.rows.length === 0 ? <p>这一层平面上还没有物件。</p> : (
                <ul>
                  {legend.rows.map((row) => (
                    <li key={`${row.name}-${row.color}`}>
                      <span className="rsp-swatch" style={{ backgroundColor: swatch(row.color) }} aria-hidden="true" />
                      <span>{row.count > 1 ? `${row.name} × ${row.count}` : row.name}</span>
                    </li>
                  ))}
                </ul>
              )}
              {legend.hidden > 0 && <p className="rsp-zones">还有 {legend.hidden} 种物件，都画在平面上。</p>}
              {(floor.zones ?? []).length > 0 && (
                <p className="rsp-zones">分区：{(floor.zones ?? []).map((zone) => zone.name).join('、')}</p>
              )}
            </div>
          </section>
          <section className="rsp-comments" aria-labelledby="rsp-comments-title">
            <div className="rsp-comments-scroll">
              <h2 id="rsp-comments-title">评论</h2>
              <p className="rsp-persist">评论留在这台浏览器，刷新还在，不会同步到其他设备。</p>
              {threads.length === 0 ? <p className="rsp-empty">还没有评论。看完平面后可以留下一条意见。</p> : (
                <ol className="rsp-thread">
                  {threads.map((thread) => (
                    <li key={thread.root.id}>
                      <CommentCard comment={thread.root} />
                      <button type="button" className="rsp-reply" aria-label={`回复 ${thread.root.author}`} onClick={() => { setReplyTo(thread.root.id); setFormError(''); }}>回复</button>
                      {thread.replies.length > 0 && (
                        <ol className="rsp-replies">
                          {thread.replies.map((reply) => <li key={reply.id}><CommentCard comment={reply} /></li>)}
                        </ol>
                      )}
                    </li>
                  ))}
                </ol>
              )}
              <details className="rsp-entry">
                <summary>分享链接怎么进这一页</summary>
                <p>评审链接是 <code>/review/#layout=…</code>。井号后的片段与编辑器里的方案哈希相同，路径用 /review/。对方打开后就是这一页：平面和评论。</p>
                <p>评论写在 localStorage，键名 <code>{REVIEW_COMMENT_STORAGE_KEY}</code>。这是演示存储，不进 Supabase。</p>
              </details>
            </div>
            <div className="rsp-finish">
              <button type="button" onClick={onComplete}>{returned ? '已完成评审' : '完成评审'}</button>
              <p role="status">{returnNote || '点完成评审后，创作者这边的球会变红。这一笔只留在这台浏览器。'}</p>
            </div>
            <form className="rsp-form" onSubmit={onSubmit} noValidate>
              {replyTarget && (
                <p className="rsp-replying">正在回复 {replyTarget.author}：{excerpt(replyTarget.body)} <button type="button" onClick={() => setReplyTo(null)}>取消回复</button></p>
              )}
              <label htmlFor="rsp-author">称呼</label>
              <input id="rsp-author" name="author" autoComplete="nickname" maxLength={REVIEW_COMMENT_AUTHOR_MAX} value={author} onChange={(event) => setAuthor(event.target.value)} />
              <label htmlFor="rsp-body">意见</label>
              <textarea id="rsp-body" name="body" rows={4} maxLength={REVIEW_COMMENT_BODY_MAX} value={body} onChange={(event) => setBody(event.target.value)} />
              <div className="rsp-form-row">
                <button type="submit">{replyTo ? '发表回复' : '发表评论'}</button>
                <span>{[...body].length}/{REVIEW_COMMENT_BODY_MAX}</span>
              </div>
              {formError && <p className="rsp-form-error" role="alert">{formError}</p>}
            </form>
          </section>
        </div>
      ) : (
        <section className="rsp-state" role="alert"><h1>方案没有可看的楼层</h1><p>这份快照里没有楼层，平面没有展开。</p></section>
      )}
    </main>
  );
}

function PlanSheet({ src, alt }: { src: string; alt: string }): JSX.Element {
  // 平面是当场生成的 SVG data URL。用 img 让脚本不执行；next/image 优化不了这种地址。
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={alt} />
  );
}

function CommentCard({ comment }: { comment: ReviewComment }): JSX.Element {
  return (
    <article className="rsp-card">
      <header><strong>{comment.author}</strong><time dateTime={comment.createdAt}>{formatWhen(comment.createdAt)}</time></header>
      <p>{comment.body}</p>
    </article>
  );
}

function readStored(planKey: string): { comments: ReviewComment[]; lastAuthor: string } {
  try {
    return readReviewComments(planKey, safeStorage());
  } catch {
    return { comments: [], lastAuthor: '' };
  }
}

function safeStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function safeSvg(layout: RoomLayout, floor: FloorLayout): string | null {
  try {
    return layoutToSvg(layout, floor);
  } catch {
    return null;
  }
}

function svgSrc(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function placedCount(items: readonly FurnitureItem[]): number {
  return items.filter((item) => item.position).length;
}

function itemLegend(items: readonly FurnitureItem[]): { rows: { name: string; color: string; count: number }[]; hidden: number } {
  const rows = new Map<string, { name: string; color: string; count: number }>();
  for (const item of items) {
    if (!item.position) continue;
    const name = item.name.trim() || '未命名物件';
    const color = item.color;
    const key = `${name}\0${color}`;
    const current = rows.get(key);
    if (current) current.count += 1;
    else rows.set(key, { name, color, count: 1 });
  }
  const all = [...rows.values()];
  return { rows: all.slice(0, 24), hidden: Math.max(0, all.length - 24) };
}

function swatch(color: string): string {
  return /^#[0-9a-fA-F]{3,8}$/.test(color) ? color : '#c8c8c2';
}

function metres(value: number): string {
  if (!Number.isFinite(value)) return '—';
  const rounded = Math.round(value * 100) / 100;
  return String(Object.is(rounded, -0) ? 0 : rounded);
}

function formatWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function excerpt(text: string): string {
  const chars = [...text];
  return chars.length > 36 ? `${chars.slice(0, 36).join('')}…` : text;
}
