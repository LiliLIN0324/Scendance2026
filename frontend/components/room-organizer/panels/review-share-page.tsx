'use client';

/**
 * 对方打开的方案壳：只读平面 + 评论。没有晴光，没有模式轨，没有布置工具。
 * 数据来自 review-share 的本机演示存储。
 */
import { useEffect, useState } from 'react';
import {
  addReviewComment,
  listReviewComments,
  readReviewShare,
  type ReviewComment,
  type ReviewPlanItem,
  type ReviewShareSnapshot,
} from '../lib/review-share';

export function ReviewSharePage({ shareId }: { shareId: string }): JSX.Element {
  const [phase, setPhase] = useState<'loading' | 'ready' | 'missing'>('loading');
  const [snapshot, setSnapshot] = useState<ReviewShareSnapshot | null>(null);
  const [comments, setComments] = useState<ReviewComment[]>([]);
  const [author, setAuthor] = useState('访客');
  const [body, setBody] = useState('');
  const [parentId, setParentId] = useState<string | null>(null);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    const found = readReviewShare(shareId);
    setSnapshot(found);
    setComments(found ? listReviewComments(shareId) : []);
    setPhase(found ? 'ready' : 'missing');
    setParentId(null);
    setNotice('');
  }, [shareId]);

  const publish = () => {
    if (!snapshot) return;
    try {
      const comment = addReviewComment(snapshot.id, { parentId, author, body });
      setComments(listReviewComments(snapshot.id));
      setBody('');
      setParentId(null);
      setNotice(comment.parentId ? '回复已留在这台浏览器。' : '评论已留在这台浏览器。');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '评论没有写下。');
    }
  };

  return <main className="sc-share-page sc-review-share" data-storage="local-demo">
    <header className="sc-share-masthead">
      <span>幕景 <small>Scendance</small></span>
      <span>方案评审 · 只读</span>
    </header>
    {phase === 'loading' ? <section className="sc-share-state" role="status"><h1>正在打开方案</h1><p>正在读取这台浏览器里的评审链接。</p></section> : phase === 'missing' || !snapshot ? <section className="sc-share-state" role="alert">
      <h1>打不开这份方案</h1>
      <p>评审链接存在创建它的那台浏览器里。换设备、无痕窗口或清除站点数据后，这里没有方案可看。这是本机演示，不是云端发布。</p>
    </section> : <>
      <div className="sc-share-title">
        <div>
          <p>本机演示 · 只读方案</p>
          <h1>{snapshot.title}</h1>
          <p>{snapshot.width} × {snapshot.depth} 米 · {snapshot.items.length} 件物料</p>
        </div>
      </div>
      <p className="sc-share-notice" role="note">可以查看和留言。不能改布置。评论只存在这台浏览器，不会同步到云端。</p>
      <PlanFigure snapshot={snapshot}/>
      <section className="sc-share-materials" aria-labelledby="sc-review-materials-title">
        <div className="sc-share-heading"><h2 id="sc-review-materials-title">物料</h2><span>共 {snapshot.items.length} 件</span></div>
        {snapshot.items.length === 0 ? <p>这份方案还没有物料。</p> : <div className="sc-share-table-scroll"><table>
          <thead><tr><th scope="col">物料</th><th scope="col">尺寸（宽 × 深 × 高 / 米）</th><th scope="col">位置</th></tr></thead>
          <tbody>
            {snapshot.items.map(item => <tr key={item.id}>
              <td><span className="sc-share-color" style={{ backgroundColor: item.color }}/>{item.name}</td>
              <td>{formatMeters(item.width)} × {formatMeters(item.depth)} × {formatMeters(item.height)}</td>
              <td>{item.x === null || item.z === null ? '未落位' : `${formatMeters(item.x)} , ${formatMeters(item.z)}`}</td>
            </tr>)}
          </tbody>
        </table></div>}
      </section>
      <CommentThread
        comments={comments}
        author={author}
        body={body}
        parentId={parentId}
        notice={notice}
        onAuthor={setAuthor}
        onBody={setBody}
        onReply={setParentId}
        onCancelReply={() => setParentId(null)}
        onPublish={publish}
      />
    </>}
  </main>;
}

function PlanFigure({ snapshot }: { snapshot: ReviewShareSnapshot }): JSX.Element {
  const width = 640;
  const height = 400;
  const pad = 28;
  const scale = Math.min((width - pad * 2) / snapshot.width, (height - pad * 2) / snapshot.depth);
  const ox = width / 2;
  const oy = height / 2;
  const px = (x: number) => ox + x * scale;
  const py = (z: number) => oy + z * scale;
  return <figure className="sc-review-plan" aria-label="只读平面">
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${snapshot.title} 的只读平面`}>
      <rect x={px(-snapshot.width / 2)} y={py(-snapshot.depth / 2)} width={snapshot.width * scale} height={snapshot.depth * scale} className="sc-review-floor"/>
      {snapshot.items.map(item => item.x === null || item.z === null ? null : <ItemMark key={item.id} item={item} scale={scale} cx={px(item.x)} cy={py(item.z)}/>)}
    </svg>
  </figure>;
}

function ItemMark({ item, scale, cx, cy }: { item: ReviewPlanItem; scale: number; cx: number; cy: number }): JSX.Element {
  const w = Math.max(item.width * scale, 2);
  const d = Math.max(item.depth * scale, 2);
  const degrees = -(item.rotation * 180) / Math.PI;
  return <g transform={`translate(${cx} ${cy}) rotate(${degrees})`}>
    <title>{item.name}</title>
    <rect x={-w / 2} y={-d / 2} width={w} height={d} fill={item.color} stroke="#243028" strokeWidth="1"/>
  </g>;
}

function CommentThread({ comments, author, body, parentId, notice, onAuthor, onBody, onReply, onCancelReply, onPublish }: {
  comments: readonly ReviewComment[];
  author: string;
  body: string;
  parentId: string | null;
  notice: string;
  onAuthor(value: string): void;
  onBody(value: string): void;
  onReply(id: string): void;
  onCancelReply(): void;
  onPublish(): void;
}): JSX.Element {
  const roots = comments.filter(comment => comment.parentId === null);
  const parent = parentId ? comments.find(comment => comment.id === parentId) : undefined;
  return <section className="sc-review-comments" aria-labelledby="sc-review-comments-title">
    <div className="sc-share-heading"><h2 id="sc-review-comments-title">评论</h2><span>{comments.length} 条</span></div>
    {roots.length === 0 ? <p>还没有评论。看方案的人可以在这里留一条。</p> : <ol className="sc-review-thread">
      {roots.map(comment => <li key={comment.id}>
        <CommentBody comment={comment} onReply={() => onReply(comment.id)}/>
        <ul>
          {comments.filter(reply => reply.parentId === comment.id).map(reply => <li key={reply.id}><CommentBody comment={reply}/></li>)}
        </ul>
      </li>)}
    </ol>}
    <form className="sc-review-composer" onSubmit={event => { event.preventDefault(); onPublish(); }}>
      {parent && <p className="sc-review-replying">回复 {parent.author}<button type="button" onClick={onCancelReply}>取消回复</button></p>}
      <label>名字<input value={author} maxLength={24} onChange={event => onAuthor(event.target.value)}/></label>
      <label>{parent ? '回复' : '评论'}
        <textarea value={body} maxLength={500} rows={3} aria-label={parent ? '回复内容' : '评论内容'} onChange={event => onBody(event.target.value)}/>
      </label>
      <button type="submit">{parent ? '发表回复' : '发表评论'}</button>
      {notice && <p role="status">{notice}</p>}
    </form>
  </section>;
}

function CommentBody({ comment, onReply }: { comment: ReviewComment; onReply?(): void }): JSX.Element {
  return <article>
    <header><strong>{comment.author}</strong><time dateTime={comment.createdAt}>{comment.createdAt.slice(0, 16).replace('T', ' ')}</time></header>
    <p>{comment.body}</p>
    {onReply && <button type="button" onClick={onReply}>回复</button>}
  </article>;
}

function formatMeters(value: number): string {
  return String(Math.round(value * 100) / 100);
}
