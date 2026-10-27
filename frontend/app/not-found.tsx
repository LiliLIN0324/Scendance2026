import Link from 'next/link';
import { Compass } from 'lucide-react';

// Static 404 (exported as 404.html). Design spec §三.2: one line of what
// happened, one way back — no illustration, no error colour, no error code.

export default function NotFound(): JSX.Element {
  return (
    <div className="sc-page-error">
      <div className="sc-page-error-card">
        <span className="sc-page-error-icon" style={{ color: 'var(--faint, #a6aab2)' }} aria-hidden>
          <Compass size={24} strokeWidth={1.75} />
        </span>
        <h1 className="sc-page-error-title">页面走丢了</h1>
        <p className="sc-page-error-copy">
          这个地址没有对应的页面，可能是链接过期，或者内容已经被删除。
        </p>
        <div className="sc-page-error-acts">
          <Link href="/" className="sc-page-error-ghost">
            返回工作台
          </Link>
        </div>
      </div>
    </div>
  );
}