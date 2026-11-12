import { YuquanPlanner } from './yuquan-planner';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: '玉泉鱼跃 · 真实场地试排 | 幕景',
  description: '在杭州植物园玉泉鱼跃公开现状图的可辨线条上试排摊位，并查看 2026 菊展实拍。',
};

export default function Page() {
  return <YuquanPlanner />;
}
