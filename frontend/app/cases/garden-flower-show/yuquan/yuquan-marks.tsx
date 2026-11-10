import type { Point } from './yuquan-data';

export const layerTypes = [
  { id: 'boundary', title: '活动边界', color: '#bd652c', closed: true },
  { id: 'area', title: '用途分区', color: '#547e40', closed: true },
  { id: 'public', title: '观众路线', color: '#245d82', closed: false },
  { id: 'logistics', title: '物流路线', color: '#92507e', closed: false },
] as const;

export type LayerId = (typeof layerTypes)[number]['id'];
export type Mark = { id: number; type: LayerId; points: Point[] };

export function Marks({ items, draft, hidden }: {
  items: Mark[];
  draft: Omit<Mark, 'id'> | null;
  hidden: readonly LayerId[];
}) {
  return <g aria-hidden="true" pointerEvents="none">
    {items.filter(mark => !hidden.includes(mark.type)).map(mark => {
      const layer = layerTypes.find(type => type.id === mark.type)!;
      const geometry = mark.points.map(point => `${point.x},${point.y}`).join(' ');
      const first = mark.points[0];
      return <g key={mark.id}>
        {layer.closed
          ? <polygon points={geometry} fill={layer.color} fillOpacity=".23" stroke={layer.color} strokeWidth=".45" />
          : <polyline points={geometry} fill="none" stroke={layer.color} strokeWidth=".7" strokeDasharray={mark.type === 'logistics' ? '1.15 .65' : undefined} />}
        <text x={first.x + .7} y={first.y - .85} fill={layer.color} fontSize="1.7" fontWeight="700"
          paintOrder="stroke" stroke="#f9f6ed" strokeWidth=".5">{layer.title} L{mark.id}</text>
      </g>;
    })}
    {draft && <g>
      <polyline points={draft.points.map(point => `${point.x},${point.y}`).join(' ')} fill="none" stroke="#4c554c" strokeWidth=".4" strokeDasharray="1 .6" />
      {draft.points.map((point, index) => <circle key={index} cx={point.x} cy={point.y} r=".65" fill="#4c554c" />)}
    </g>}
  </g>;
}
