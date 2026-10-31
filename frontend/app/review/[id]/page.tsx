import { ReviewLinkClient } from './review-link-client';

/**
 * 静态导出要求动态段声明参数。具体分享 id 在打开的浏览器里读，
 * 构建时不预生成每一条链接。
 */
export function generateStaticParams(): Array<{ id: string }> {
  return [{ id: 'local' }];
}

export default function ReviewLinkPage(): JSX.Element {
  return <ReviewLinkClient />;
}
