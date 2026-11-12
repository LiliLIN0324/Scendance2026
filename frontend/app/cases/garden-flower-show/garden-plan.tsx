import { change, detour, flowers, garden, guidePoints, nodes, path, stockPoint, trees, type NodeId, type Version } from './garden-sample';
import styles from './garden.module.css';

export function GardenPlan({ selected, select, version, compare, boundary, guideMoved, handoffRole }: {
  selected: NodeId;
  select: (id: NodeId) => void;
  version: Version;
  compare: boolean;
  boundary: boolean;
  guideMoved: boolean;
  handoffRole: number | null;
}) {
  const [guideX, guideY] = guidePoints[Number(guideMoved)];
  const showDetour = compare && version === 'B' && (handoffRole === null || handoffRole === 2);
  return <svg className={styles.plan} viewBox={`0 0 ${garden.width} ${garden.height}`} aria-labelledby="garden-plan-title" role="group">
    <title id="garden-plan-title">秋圃示范园平面图，可选择三个展点</title>
    <defs>
      <pattern id="garden-grid" width="30" height="30" patternUnits="userSpaceOnUse">
        <path d="M 30 0 H 0 V 30" fill="none" stroke="#667b52" strokeOpacity=".15" />
      </pattern>
      <pattern id="garden-hatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(40)">
        <path d="M0 0V8" stroke="#854a30" strokeWidth="2" opacity=".64" />
      </pattern>
      <clipPath id="garden-extent">
        <path d="M49 105 120 55 303 47 412 54 595 55 676 112 676 322 639 396 517 417 334 424 169 420 65 398 46 331Z" />
      </clipPath>
    </defs>
    <rect width="720" height="460" fill="#eaecdf" />
    <rect width="720" height="460" fill="url(#garden-grid)" />
    <path d="M49 105 120 55 303 47 412 54 595 55 676 112 676 322 639 396 517 417 334 424 169 420 65 398 46 331Z"
      fill="#d3dbc0" stroke={boundary ? '#425f42' : '#a1ae8f'} strokeDasharray={boundary ? '7 5' : undefined} strokeWidth={boundary ? 2.5 : 1.5} />
    <g clipPath="url(#garden-extent)" aria-hidden="true">
      <path fill="#c0ceaa" d="M34 108Q95 63 151 68T268 74Q294 86 260 116T143 141Q111 155 113 204T70 274L28 291ZM451 51Q465 108 535 104T649 147L699 119 689 33ZM122 339Q168 324 200 349T298 366Q376 348 421 374T528 388L587 426 120 430ZM565 299Q603 252 690 250L708 388 575 414Q548 376 565 299Z" />
      <path fill="#abc2ba" stroke="#ebf0df" strokeWidth="4" d="M202 315Q223 287 269 293C306 299 329 281 358 298S405 320 433 303Q477 282 493 321C507 352 478 361 432 360S356 342 311 355 223 375 203 354Q187 338 202 315Z" />
      <path fill="none" stroke="#dbe7d9" strokeWidth="1.4" d="M218 324q22-17 55-14m-41 37q31 6 56-4m39-30q21-5 53 13m47 18q34 1 49-16" />
      <text className={styles.mapNote} x="325" y="337" textAnchor="middle">水生花境</text>
      <path fill="none" stroke="#b5c39f" d="M113 83q115-44 190-15m-166 57q99 8 136-35m38 300q70-20 134 5m151-28q31-17 52-78m-40-162q-52-23-100-18" />
      {trees.map(([x, y, radius], index) => <g key={x} transform={`translate(${x} ${y})`}>
        <circle cx="2" cy="3" r={radius} fill="#8eaa82" opacity=".25" />
        <circle r={radius} fill={index % 3 === 0 ? '#99b289' : '#adc29a'} stroke="#819b76" strokeOpacity=".55" />
        <path d={`M0 ${-radius * .55}V${radius * .55} M${-radius * .55} 0H${radius * .55}`} stroke="#67896b" strokeOpacity=".45" />
      </g>)}
    </g>
    <g fill="none" strokeLinejoin="round" strokeLinecap="round" aria-hidden="true">
      <polyline points={detour.map(p => p.join(',')).join(' ')} stroke="#b6bc9f" strokeWidth="21" />
      <polyline points={detour.map(p => p.join(',')).join(' ')} stroke="#f6efdc" strokeWidth="17" />
      <polyline points={path.map(p => p.join(',')).join(' ')} stroke="#b4bb9c" strokeWidth="29" />
      <polyline points={path.map(p => p.join(',')).join(' ')} stroke="#faf2df" strokeWidth="24" />
      <path d="M198 206 219 259M381 227 381 215M554 188 551 231M550 318V231" stroke="#f9f1df" strokeWidth="12" />
      {showDetour && <polyline points={detour.map(p => p.join(',')).join(' ')} stroke="#3e6676" strokeWidth="4" strokeDasharray="2 8" />}
    </g>
    <g aria-hidden="true">
      <path d="M64 403 86 418M70 396 92 411" stroke="#304b37" strokeWidth="4" strokeLinecap="round" />
      <text className={styles.mapLabel} x="103" y="420">南入口</text>
      <rect x="510" y="318" width="80" height="56" rx="7" fill="#e8dfbe" stroke="#8d8464" strokeDasharray="4 3" />
      <path d="M523 334h11v11h-11zm15 0h11v11h-11zm15 0h11v11h-11z" fill="#a69873" />
      <text className={styles.mapLabel} x="550" y="364" textAnchor="middle">备花点</text>
      <g transform={`translate(${guideX - 10} ${guideY - 9})`}>
        <rect width="20" height="18" rx="4" fill="#496c79" stroke="#f8f5ea" strokeWidth="2" />
        <path d="M5 9h9m-3-3 3 3-3 3" fill="none" stroke="white" strokeWidth="1.5" />
      </g>
      <text className={styles.mapNote} x={guideX + 14} y={guideY + 14}>导视</text>
      {handoffRole === 0 && <>
        <path d={`M${stockPoint[0]} 318V235Q550 226 536 222L493 206 420 213 406 230`} fill="none" stroke="#715939" strokeWidth="3" strokeDasharray="5 5" />
        <path d="m405 221 0 10 9-4" fill="none" stroke="#715939" strokeWidth="3" />
      </>}
      {handoffRole === 1 && <>
        <rect x={change.node.x - 57} y={change.node.y - 48} width="114" height="96" rx="14" fill="none" stroke="#884b32" strokeWidth="3" strokeDasharray="6 4" />
        <path d="m315 230 18 11m-18-7 18 11m97-9 18-11m-18 15 18-11" fill="none" stroke="#884b32" strokeWidth="2.5" />
      </>}
      {handoffRole === 2 && <circle cx="79" cy="409" r="17" fill="none" stroke="#3e6676" strokeWidth="2.5" strokeDasharray="3 3" />}
      <g transform="translate(665 34)" fill="#40543d" textAnchor="middle">
        <text className={styles.mapNote} y="-8">N</text><path d="M0 0 6 17 0 13-6 17Z" />
      </g>
      <path d="M615 438v-5m0 3h50m0-3v5" fill="none" stroke="#4b5a45" strokeWidth="1.5" />
      <text className={styles.mapNote} x="665" y="429" textAnchor="end">5 m</text>
    </g>
    {nodes.map((node, index) => {
      const active = selected === node.id;
      const affected = compare && node.id === 'B02';
      const box = { x: -node.width * 5, y: -node.depth * 5, width: node.width * 10, height: node.depth * 10 };
      return <g key={node.id} className={styles.mapNode} transform={`translate(${node.x} ${node.y})`}
        tabIndex={0} role="button" aria-pressed={active} aria-label={`${node.id} ${node.name}`}
        onClick={() => select(node.id)} onKeyDown={event => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            select(node.id);
          }
        }}>
        <rect {...box} rx={index === 2 ? 23 : 9} fill="#eeead9" stroke={active ? '#38563f' : '#819072'} strokeWidth={active ? 3 : 1.5} />
        {index === 1 && <path d="M-38 10Q0-37 38 10M-30 19Q0-17 30 19" fill="none" stroke="#bfae80" strokeWidth="5" />}
        {index === 2 && <path d="M-35-8Q-12 26 33-14" fill="none" stroke="#bdc5a9" strokeWidth="7" strokeLinecap="round" />}
        {flowers[index].map(([x, y], cluster) => {
          const changed = affected && cluster < 5;
          const color = changed ? (version === 'A' ? '#956f5b' : '#e9ad43') : node.color;
          return <g key={cluster} transform={`translate(${x} ${y})`}>
            <path d="M0-7 3-4 7-3 6 1 5 5 1 6-3 7-5 3-7 0-5-4-2-5Z" fill={color} />
            <circle r="2" fill="#fff5cf" />
          </g>;
        })}
        {affected && <rect x="-40" y="9" width="80" height="24" rx="8" fill={version === 'A' ? 'url(#garden-hatch)' : 'none'}
          stroke={version === 'A' ? '#884b32' : '#647747'} strokeWidth="2" strokeDasharray={version === 'B' ? '4 3' : undefined} />}
        <rect x="-24" y={box.y - 29} width="48" height="24" rx="12" fill={active ? '#314d3b' : '#f9f5e8'} stroke={active ? '#314d3b' : '#829075'} />
        <text className={styles.nodeCode} x="0" y={box.y - 12} fill={active ? '#fff' : '#314d3b'}>{node.id}</text>
      </g>;
    })}
  </svg>;
}
