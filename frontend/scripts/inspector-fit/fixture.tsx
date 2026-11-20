/**
 * 属性卡版式夹具（2026-11-17「文字生成点不动」的回归）。
 *
 * 用真实组件同一份版式常量，渲染出属性卡的骨架：候选条 + 「生成或导入模型」三颗按钮。
 * 候选数给 24 个（素材库真实量级），正是它把整张卡撑到上千像素宽的那一排。
 *
 * 组件本体太重（three.js + 全套上下文），没法在夹具里整块渲染；
 * 但撑宽的根因只在版式常量里，所以夹具复用常量、复刻这段 DOM，
 * 量出来的宽度与命中栈顶就是组件在生产里的真实表现。
 */
import { createRoot } from 'react-dom/client';
import { PLANNING_LAYER_COLORS } from '@/lib/outdoor-plan-tokens';
import {
  FACILITY_MODEL_ACTION_ROW_STYLE,
  FACILITY_MODEL_STRIP_STYLE,
  FACILITY_MODEL_STRIP_WRAPPER_STYLE,
  inspectorCardBodyStyle,
  inspectorCardStyle,
  inspectorStackStyle,
} from '@/components/room-organizer/components/outdoor-inspector-layout';

const CANDIDATES = 24;

/** 标注浮卡定宽（与生产同一份常量口径）：2026-11-20 用户「这个标注为什么搞那么宽」。 */
const ANNOTATE_CARD_WIDTH = 286;

/** 一行长文本标注：真实场景里备注能写很长，正是它把标注卡撑开的那一行。 */
const LONG_NOTE = '文本：仪式与观景优先；人数按已提供需求；入场方向为南侧假设；景观方向未知，保留假设。占位件尺寸是估计，路线与真实门的关系需要核实。';

function CandidateStrip() {
  return (
    <div style={FACILITY_MODEL_STRIP_WRAPPER_STYLE}>
      <div role="group" aria-label="3D 模型候选" data-testid="facility-model-strip" style={FACILITY_MODEL_STRIP_STYLE}>
        {Array.from({ length: CANDIDATES }, (_, index) => (
          <button
            key={index}
            type="button"
            style={{ flex: '0 0 auto', width: 64, height: 60, padding: 0, border: '1px solid #e4e4e7', borderRadius: 4, overflow: 'hidden' }}
          >
            <span style={{ display: 'block', height: 40, width: '100%', background: '#f4f5f7' }} />
            <span style={{ display: 'block', height: 18, width: '100%', fontSize: 10, overflow: 'hidden', whiteSpace: 'nowrap' }}>{`模型 ${index + 1}`}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function InspectorCard() {
  return (
    <section data-testid="outdoor-inspector-selection" style={inspectorCardStyle({ key: 'selection' })}>
      <div data-inspector-header="" style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 6px 6px 8px' }}>
        <button type="button" style={{ flex: 1, display: 'flex', gap: 8, padding: '3px 6px 3px 4px', border: 0, background: 'none' }}>
          <span style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>属性</span>
        </button>
      </div>
      <div style={inspectorCardBodyStyle({ key: 'selection' })}>
        <div style={{ fontWeight: 600, marginBottom: 4 }}>模型</div>
        <CandidateStrip />
        <div role="group" aria-label="生成或导入模型" style={FACILITY_MODEL_ACTION_ROW_STYLE}>
          <button type="button" className="sc-model-action" data-testid="facility-model-generate">
            <span>文字生成</span>
          </button>
          <button type="button" className="sc-model-action" data-testid="facility-model-upload">
            <span>图片生成</span>
          </button>
          <button type="button" className="sc-model-action" data-testid="facility-model-import">
            <span>导入 GLB</span>
          </button>
        </div>
      </div>
    </section>
  );
}

/** 标注浮卡：贴着底条「标注」钮上浮的 popover，宽度必须定死，长文本在卡内省略。 */
function AnnotateCard() {
  return (
    <section
      data-testid="outdoor-inspector-annotate"
      className="sc-outdoor-toolcard sc-outdoor-toolcard--annotate"
      data-anchored="above-tool"
      style={inspectorCardStyle({ key: 'annotate', annotateAnchor: { left: 640, bottom: 120 }, fixedWidth: ANNOTATE_CARD_WIDTH })}
    >
      <div style={inspectorCardBodyStyle({ key: 'annotate' })}>
        <div
          role="button"
          tabIndex={0}
          data-testid="annotate-row"
          style={{
            all: 'unset',
            boxSizing: 'border-box',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            width: '100%',
            padding: '5px 6px',
            paddingLeft: 30,
          }}
        >
          <span aria-hidden style={{ width: 12, height: 12, flex: '0 0 auto', borderRadius: 999, background: PLANNING_LAYER_COLORS.annotate }} />
          <span data-testid="annotate-row-label" style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {LONG_NOTE}
          </span>
          <button type="button" className="sc-danger-quiet" style={{ cursor: 'pointer', fontSize: 12 }}>删除</button>
        </div>
      </div>
    </section>
  );
}

/** 3D 接管态的宿主是整块覆盖层（room-organizer.tsx 的 #outdoor-inspector-host，inset:0）。 */
export function mountInspectorFit() {
  const host = document.getElementById('outdoor-inspector-host');
  if (!host) throw new Error('缺少宿主节点');
  const root = createRoot(host);
  root.render(
    <>
      <div data-testid="outdoor-inspector-stack" style={inspectorStackStyle(null)}>
        <InspectorCard />
      </div>
      <AnnotateCard />
    </>,
  );
  return root;
}
