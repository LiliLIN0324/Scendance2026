import type { Metadata } from 'next';
import { CaptureGuide } from '@/components/capture-guide/capture-guide';
import '@/components/capture-guide/capture-guide.css';

export const metadata: Metadata = {
  title: '采集守门员 · 幕景 Scendance',
  description: '手机现场采集自检：三层环绕、尺度基准、GPS 覆盖、图像快检与可重建性评分。',
};

export default function CaptureGuidePage(): JSX.Element {
  return <CaptureGuide />;
}
