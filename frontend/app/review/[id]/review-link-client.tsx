'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { ReviewSharePage } from '@/components/room-organizer/panels/review-share-page';

function shareIdFromPath(pathname: string, fallback: string): string {
  const segment = pathname.split('/').filter(Boolean)[1];
  if (!segment || segment === 'local.html') return fallback;
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/** 分享出去的方案页。不挂工作台编辑器。静态导出只有一个壳，真实 id 从地址栏读。 */
export function ReviewLinkClient(): JSX.Element {
  const params = useParams();
  const raw = params?.id;
  const fromParams = typeof raw === 'string' ? raw : Array.isArray(raw) ? raw[0] ?? '' : '';
  const [shareId, setShareId] = useState(fromParams);

  useEffect(() => {
    setShareId(shareIdFromPath(window.location.pathname, fromParams));
  }, [fromParams]);

  return <ReviewSharePage shareId={shareId} />;
}
