import { Box, Compass, MapPin, MousePointerClick, Scan, Sparkles } from '@/components/solid-icons';
import { useAgent } from './agent-panel';
import './canvas-workflow.css';

type Props = {
  venue?: { name: string; length: number; width: number; onFocus: () => void; onWalk: () => void };
  placedCount: number;
  onMaterials: () => void;
  onSpace: () => void;
  onReview: () => void;
};

/** A single work surface anchored to the live canvas, using the editor's existing actions. */
export function CanvasWorkflow({ venue, placedCount, onMaterials, onSpace, onReview }: Props): JSX.Element {
  const { mapPickerOpen, startMapVenuePicker } = useAgent();
  const size = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 1 });
  return <section className="sc-canvas-workflow" aria-label="场地工作流">
    <div className="sc-canvas-workflow-context">
      <MapPin size={17} aria-hidden="true"/>
      <div>
        <strong title={venue?.name}>{venue?.name ?? '活动画布'}</strong>
        <small>{venue
          ? `${size.format(venue.length)} × ${size.format(venue.width)} 米 · ${placedCount ? `本层 ${placedCount} 件物料` : '本层未放物料'}`
          : '从地图选址，或使用已有场景'}</small>
      </div>
      {venue && <button type="button" className="sc-canvas-workflow-focus" onClick={venue.onFocus} aria-label="聚焦场地" title="聚焦场地"><MousePointerClick size={17} aria-hidden="true"/></button>}
    </div>
    <div className="sc-canvas-workflow-actions">
      {venue ? <>
        <button type="button" className="is-primary" onClick={onMaterials}><Box size={15} aria-hidden="true"/>放物料</button>
        <button type="button" onClick={venue.onWalk}><Compass size={15} aria-hidden="true"/>试走场地</button>
        {placedCount > 0
          ? <button type="button" onClick={onReview}><Sparkles size={15} aria-hidden="true"/>审校布置</button>
          : <button type="button" onClick={onSpace}><Scan size={15} aria-hidden="true"/>场景库</button>}
      </> : <>
        <button type="button" className="is-primary" aria-pressed={mapPickerOpen} onClick={startMapVenuePicker}><MapPin size={15} aria-hidden="true"/>地图选址</button>
        <button type="button" onClick={onSpace}><Scan size={15} aria-hidden="true"/>场景库</button>
        {placedCount > 0 && <button type="button" onClick={onReview}><Sparkles size={15} aria-hidden="true"/>审校布置</button>}
      </>}
    </div>
  </section>;
}
