'use client';

import { useParams } from 'next/navigation';
import { ReviewSharePage } from '@/components/room-organizer/panels/review-share-page';

/** 分享出去的方案页。不挂工作台编辑器。 */
export function ReviewLinkClient(): JSX.Element {
  const params = useParams();
  const raw = params?.id;
  const shareId = typeof raw === 'string' ? raw : Array.isArray(raw) ? raw[0] ?? '' : '';
  return <ReviewSharePage shareId={shareId} />;
}
