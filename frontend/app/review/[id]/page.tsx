import { ReviewLinkClient } from './review-link-client';

/**
 * `output: 'export'` requires at least one concrete path.
 * Cloudflare Pages rewrites every `/review/:id` onto this shell; the client reads the real id from the URL.
 */
export function generateStaticParams(): Array<{ id: string }> {
  return [{ id: 'local' }];
}

export default function ReviewLinkPage(): JSX.Element {
  return <ReviewLinkClient />;
}
