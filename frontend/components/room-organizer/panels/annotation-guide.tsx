import { ZONE_SEMANTIC_LABELS, type ZoneSemanticType } from '@/lib/plan-annotation';
import './annotation-guide.css';

type Mode = 'zone' | 'route' | 'fire-route' | 'measure' | 'door';

export function AnnotationGuide({ mode, zoneType, onModeChange, onZoneTypeChange, onFinish }: {
  mode: Mode; zoneType: ZoneSemanticType; onModeChange: (mode: Mode) => void;
  onZoneTypeChange: (type: ZoneSemanticType) => void; onFinish: () => void;
}) {
  return <section className="sc-annotation-guide" aria-label="场地规划工具">
    <div className="sc-annotation-guide__header"><strong>在平面图上规划</strong><button type="button" onClick={onFinish}>完成绘制</button></div>
    <div className="sc-annotation-guide__modes" role="group" aria-label="选择规划工具">
      {([['zone', '画区域'], ['route', '画路线'], ['fire-route', '画疏散路线'], ['measure', '量距离'], ['door', '标出入口']] as const).map(([key, label]) =>
        <button key={key} type="button" aria-pressed={mode === key} onClick={() => onModeChange(key)}>{label}</button>)}
    </div>
    {mode === 'zone' && <>
      <p className="sc-annotation-guide__lead">先给要画的块选个用途，再在画布上按住拖出范围；可以连续画多块。</p>
      <p className="sc-annotation-guide__section-label">区域用途（只是给这块区域打的标签，之后也能改）</p>
      <div className="sc-annotation-guide__types" role="group" aria-label="选择区域用途">
        {(Object.keys(ZONE_SEMANTIC_LABELS) as ZoneSemanticType[]).map(key =>
          <button key={key} type="button" aria-pressed={zoneType === key} onClick={() => onZoneTypeChange(key)}>{ZONE_SEMANTIC_LABELS[key]}</button>)}
      </div>
      <p className="sc-annotation-guide__hint">画好后在右上角查看方案，确认前不会添加物料。</p>
    </>}
    {mode === 'route' && <p className="sc-annotation-guide__hint">在平面图上依次点击路线经过的位置，至少选择两点，再按 Enter 或双击结束。切换工具会取消未完成的线。</p>}
    {mode === 'fire-route' && <p className="sc-annotation-guide__hint">在平面图上依次点击疏散路线经过的位置，至少选择两点，再按 Enter 或双击结束。切换工具会取消未完成的线。</p>}
    {mode === 'measure' && <p className="sc-annotation-guide__hint">在平面图上依次点击起点和终点，即可标出两点距离。</p>}
    {mode === 'door' && <p className="sc-annotation-guide__hint">在平面图的墙边点击入口位置。门宽、开启方向与现场情况仍需核对。</p>}
    <details>
      <summary>标注如何影响方案</summary>
      <p>画出的区域会影响区域方案；部分自动布置暂时不会参考这些区域。</p>
      <p>路线可用于检查是否被物料挡住；部分自动布置尚不检查入口净空。门的位置、宽度和方向仍需核对。</p>
      <p>量距只显示距离，不会自动作为布置条件。具体结果请查看方案检查。</p>
    </details>
  </section>;
}
