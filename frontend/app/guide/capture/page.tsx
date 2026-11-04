import type { Metadata } from 'next';
import { CaptureGuide } from '@/components/capture-guide/capture-guide';
import '@/components/capture-guide/capture-guide.css';

export const metadata: Metadata = {
  title: '拍摄场地 · 出 3D · 幕景 Scendance',
  description: '手机现场采集：三层环绕、尺度基准、GPS 覆盖、逐张判定与覆盖环，拍完生成重建任务包并导出归一化 GLB。',
};

export default function CaptureGuidePage(): JSX.Element {
  return <CaptureGuide />;
}
