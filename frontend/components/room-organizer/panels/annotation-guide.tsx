import { ZONE_SEMANTIC_LABELS, type ZoneSemanticType } from '@/lib/plan-annotation';
import './annotation-guide.css';

type Mode = 'zone' | 'route' | 'measure' | 'door';

export function AnnotationGuide({ mode, zoneType, onModeChange, onZoneTypeChange, onFinish }: {
  mode: Mode; zoneType: ZoneSemanticType; onModeChange: (mode: Mode) => void;
  onZoneTypeChange: (type: ZoneSemanticType) => void; onFinish: () => void;
}) {
  return <section className="sc-annotation-guide" aria-label="场地规划工具">
    <div className="sc-annotation-guide__header"><strong>在平面图上规划</strong><button type="button" onClick={onFinish}>完成绘制</button></div>
    <p>画出活动区域，查看系统给出的布置建议；确认前不会添加物料。</p>
    <div className="sc-annotation-guide__modes" role="group" aria-label="选择规划工具">
      {([['zone', '画区域'], ['route', '画路线'], ['measure', '量距离'], ['door', '标出入口']] as const).map(([key, label]) =>
        <button key={key} type="button" aria-pressed={mode === key} onClick={() => onModeChange(key)}>{label}</button>)}
    </div>
    {mode === 'zone' && <>
      <p>1. 选择区域用途　2. 在场地上按住拖出范围　3. 在右上角查看方案</p>
      <div className="sc-annotation-guide__types" role="group" aria-label="选择区域用途">
        {(Object.keys(ZONE_SEMANTIC_LABELS) as ZoneSemanticType[]).map(key =>
          <button key={key} type="button" aria-pressed={zoneType === key} onClick={() => onZoneTypeChange(key)}>{ZONE_SEMANTIC_LABELS[key]}</button>)}
      </div>
      <p>可连续画多个区域；完成后点击右上角的方案进行核对。</p>
    </>}
    {mode === 'route' && <p>在平面图上依次点击路线经过的位置，至少选择两点，再按 Enter 或双击结束。切换工具会取消未完成的线。</p>}
    {mode === 'measure' && <p>在平面图上依次点击起点和终点，即可标出两点距离。</p>}
    {mode === 'door' && <p>在平面图的墙边点击入口位置。门宽、开启方向与现场情况仍需核对。</p>}
    <p>出入口、通行和现场条件仍需人工核对。</p>
  </section>;
}
