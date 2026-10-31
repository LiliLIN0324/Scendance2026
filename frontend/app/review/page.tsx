import { ReviewSharePage } from '@/components/review-share-page/review-share-page';
import type { Metadata } from 'next';
import './review-share-page.css';

export const metadata: Metadata = {
  title: '可评论方案 · 幕景 Scendance',
  description: '在分享的活动场地平面上点位置落钉。只读方案页，不含工作台。',
};

export default function Page(): JSX.Element {
  return <ReviewSharePage />;
}
