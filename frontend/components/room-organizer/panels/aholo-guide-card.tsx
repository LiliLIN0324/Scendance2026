'use client';

import { useEffect, useRef, useState } from 'react';
import { HelpCircle, Layers, MousePointerClick, PencilLine, Timer, X, Globe } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

interface GuideStep { icon: LucideIcon; title: string; text: string; }
const LUX_STEPS: GuideStep[] = [
  { icon: PencilLine, title: '① 描述或传图', text: '文字建模：一句话描述物件；图片建模：传一张照片按图建模更还原，描述作为补充。' },
  { icon: Timer, title: '② 云端生成', text: '点「直连生成」提交给 Aholo Lux3D，通常约 3-5 分钟，期间可点「查看最新」跟踪进度。' },
  { icon: MousePointerClick, title: '③ 取回上场地', text: '完成后取回产物放入场地。描述越具体（材质、颜色、风格）效果越好；每次生成消耗云额度。' },
];
const LIBRARY_STEPS: GuideStep[] = [
  { icon: PencilLine, title: '① 描述或传图', text: '在下方输入一句话描述物件，或附一张参考图（现场照片、示意图均可，按图建模更还原）。' },
  { icon: Timer, title: '② 云端生成', text: '点「生成物件」提交，由 Aholo Lux3D 云端生成，通常约 3-5 分钟，可先继续布置其他内容。' },
  { icon: MousePointerClick, title: '③ 加入场地', text: '生成完成后在「历史模型」里点「加入场地预览」，设定摆放尺寸即可上场地；失败不会重复扣额度。' },
];
const WORLD_STEPS: GuideStep[] = [
  { icon: Globe, title: '① 描述场景', text: '填场景名称与描述，室内场景效果最佳；提交后由 Aholo World 生成 3DGS 场景，通常约 10-20 分钟。' },
  { icon: Layers, title: '② 铺成 3D 背景', text: '完成后取回产物，按真实尺度铺在场地里；仅用于环境氛围展示，不参与布置与碰撞计算。' },
];
/** 图文并茂的浮窗教程卡：触发钮 + 浮层步骤卡，Esc/点击外部关闭。 */
export function AholoGuideCard({ world = false, surface = 'direct' }: { world?: boolean; surface?: 'direct' | 'library' }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    const onDown = (event: MouseEvent) => {
      if (rootRef.current && event.target instanceof Node && !rootRef.current.contains(event.target)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('mousedown', onDown); };
  }, [open]);
  const steps = world ? WORLD_STEPS : surface === 'library' ? LIBRARY_STEPS : LUX_STEPS;
  return <div className="sc-aholo-guide" ref={rootRef}>
    <button type="button" className="sc-aholo-guide-trigger" aria-label="生成教程" aria-expanded={open}
      onClick={() => setOpen(value => !value)}>
      <HelpCircle size={13} aria-hidden="true" />教程
    </button>
    {open && <div className="sc-aholo-guide-card" role="dialog" aria-label="生成教程">
      <div className="sc-aholo-guide-head">
        <strong>{world ? '场景生成怎么用' : '生成物件怎么用'}</strong>
        <button type="button" className="sc-aholo-guide-close" aria-label="关闭生成教程" onClick={() => setOpen(false)}>
          <X size={13} aria-hidden="true" />
        </button>
      </div>
      {steps.map(step => {
        const Icon = step.icon;
        return <div className="sc-aholo-guide-step" key={step.title}>
          <span className="sc-aholo-guide-icon" aria-hidden="true"><Icon size={15} /></span>
          <span><strong>{step.title}</strong><span className="sc-aholo-guide-text">{step.text}</span></span>
        </div>;
      })}
      {world && <p className="sc-aholo-guide-foot">提示：非室内场景处于 Beta，质量可能不稳，演示优先用室内文案。</p>}
    </div>}
  </div>;
}
