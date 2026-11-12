import { hallMarker, mainPool, site, traces, type Point } from './yuquan-data';

const coordinates = (points: readonly Point[]) => points.map(point => `${point.x},${point.y}`).join(' ');

export function YuquanBase({ activePoint, choosePoint }: {
  activePoint: string;
  choosePoint: (id: string) => void;
}) {
  return <>
    <defs>
      <pattern id="yuquan-grid" width="5" height="5" patternUnits="userSpaceOnUse">
        <path d="M5 0H0V5" fill="none" stroke="#798477" strokeWidth=".12" strokeOpacity=".28" />
      </pattern>
    </defs>
    <rect width={site.width} height={site.height} fill="#f2f1e9" />
    <rect width={site.width} height={site.height} fill="url(#yuquan-grid)" />
    <g aria-hidden="true">
      {traces.map(feature => feature.kind === 'hall'
        ? <polygon key={feature.id} points={coordinates(feature.points)} fill="#c6bdac" stroke="#6a665b" strokeWidth=".32" />
        : <polyline key={feature.id} points={coordinates(feature.points)} fill="none"
            stroke={feature.kind === 'path' ? '#8b8274' : '#555b51'}
            strokeWidth={feature.kind === 'path' ? '.45' : '.36'}
            strokeDasharray={feature.kind === 'path' ? '1.15 .65' : undefined}
            strokeLinejoin="round" />)}
      <polygon points={coordinates(mainPool)} fill="#a6c9c3" stroke="#356c68" strokeWidth=".4" />
      <text x="84.3" y="61" textAnchor="middle" fontSize="2.1" fontWeight="700" fill="#294f4b">玉泉主池</text>
      <text x="84.3" y="65" textAnchor="middle" fontSize="1.6" fill="#294f4b">27.6 × 15.4 m · 调查值</text>
      <text x="31" y="94" fontSize="1.7" fill="#68685c">原图线条无法可靠辨认处留白</text>
      <g transform="translate(8 8)">
        <path d="M0 0-1.5 4.5 0 3.5 1.5 4.5Z" fill="#385348" />
        <text y="-1" textAnchor="middle" fontSize="1.8" fill="#385348">N</text>
      </g>
      <path d="M5 103v1.2h10V103m-5 .55v.65" fill="none" stroke="#345147" strokeWidth=".25" />
      <text x="5" y="107" fontSize="1.5" fill="#345147">0</text>
      <text x="15" y="107" textAnchor="end" fontSize="1.5" fill="#345147">10 m</text>
    </g>
    <g transform={`translate(${hallMarker.x} ${hallMarker.y})`}
      role="button" tabIndex={0} aria-label="鱼乐园长廊" aria-pressed={activePoint === '01'}
      onClick={() => choosePoint('01')}
      onKeyDown={event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          choosePoint('01');
        }
      }} style={{ cursor: 'pointer' }}>
      <circle r="3.3" fill="transparent" />
      <circle r="2.15" fill={activePoint === '01' ? '#275846' : '#fff8e7'} stroke="#275846" strokeWidth=".35" />
      <text textAnchor="middle" y=".65" fill={activePoint === '01' ? '#fff' : '#275846'} fontSize="1.6" fontWeight="700">01</text>
      <text x="2.9" y=".7" fill="#2c463a" fontSize="1.75" fontWeight="600" paintOrder="stroke" stroke="#f8f4e7" strokeWidth=".65">鱼乐园长廊</text>
    </g>
  </>;
}
