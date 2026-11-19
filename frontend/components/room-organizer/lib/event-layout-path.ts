import type { PlanPoint } from '../../../../supabase/functions/_shared/site-plan';
import { facilityPlacementIssues } from './site-plan-facilities';
import { outdoorCorridorStrips, outdoorRingsOverlap } from './outdoor-event-logic';

/** Width-aware bounded A*. The result is proposed circulation, never proof of a real entrance. */
export function eventLayoutPath(input: {
  boundary: PlanPoint[]; blocked: PlanPoint[][]; start: PlanPoint; end: PlanPoint; widthM: number;
}): PlanPoint[] | null {
  const xs = input.boundary.map(p => p.x), ys = input.boundary.map(p => p.y);
  const west = Math.min(...xs), south = Math.min(...ys);
  const width = Math.max(...xs) - west, depth = Math.max(...ys) - south;
  const step = Math.max(0.75, width / 75, depth / 75);
  const cols = Math.floor(width / step) + 1, rows = Math.floor(depth / step) + 1;
  const at = (id: number): PlanPoint => ({ x: west + id % cols * step, y: south + Math.floor(id / cols) * step });
  const passable = new Map<number, boolean>();
  const clearRing = (ring: PlanPoint[]): boolean => !facilityPlacementIssues(ring, input.boundary).length
    && !input.blocked.some(block => outdoorRingsOverlap(ring, block));
  const safe = (id: number): boolean => {
    if (!passable.has(id)) {
      const p = at(id), r = input.widthM / 2;
      passable.set(id, clearRing([{ x: p.x-r, y: p.y-r }, { x: p.x+r, y: p.y-r }, { x: p.x+r, y: p.y+r }, { x: p.x-r, y: p.y+r }]));
    }
    return passable.get(id)!;
  };
  const edge = (a: PlanPoint, b: PlanPoint) => Math.hypot(a.x-b.x, a.y-b.y) < 0.001
    || outdoorCorridorStrips([a,b], input.widthM).every(clearRing);
  const snap = (target: PlanPoint): number | null => {
    let best: number | null = null, distance = Math.max(4, step * 2);
    const col = Math.round((target.x-west)/step), row = Math.round((target.y-south)/step);
    for (let dy=-5; dy<=5; dy++) for (let dx=-5; dx<=5; dx++) {
      const x=col+dx, y=row+dy;
      if (x<0 || x>=cols || y<0 || y>=rows) continue;
      const id=y*cols+x, p=at(id), d=Math.hypot(p.x-target.x,p.y-target.y);
      if (d<distance && safe(id) && edge(target,p)) { best=id; distance=d; }
    }
    return best;
  };
  const start=snap(input.start), end=snap(input.end);
  if (start===null || end===null) return null;
  const scores=new Map<number,number>([[start,0]]), previous=new Map<number,number>();
  const open=new Set<number>([start]), closed=new Set<number>();
  const heuristic=(id:number)=>Math.hypot(at(id).x-at(end).x,at(id).y-at(end).y)/step;
  for (let iteration=0; open.size && iteration<6500; iteration++) {
    let current=-1, score=Infinity;
    for (const id of open) { const value=scores.get(id)!+heuristic(id); if(value<score){current=id;score=value;} }
    if(current===end){
      const ids=[end]; while(ids.at(-1)!==start){const p=previous.get(ids.at(-1)!);if(p===undefined)return null;ids.push(p);}
      const raw=[input.start,...ids.reverse().map(at),input.end];
      const unique=raw.filter((p,i)=>!i || Math.hypot(p.x-raw[i-1].x,p.y-raw[i-1].y)>0.001);
      const points=unique.filter((p,i)=>!i || i===unique.length-1 || Math.abs((p.x-unique[i-1].x)*(unique[i+1].y-p.y)-(p.y-unique[i-1].y)*(unique[i+1].x-p.x))>0.001);
      return points.length>=2 && points.length<=128 ? points : null;
    }
    open.delete(current);closed.add(current);
    const x=current%cols,y=Math.floor(current/cols);
    for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){
      const nx=x+dx,ny=y+dy;if(nx<0||nx>=cols||ny<0||ny>=rows)continue;
      const next=ny*cols+nx;if(closed.has(next)||!safe(next)||!edge(at(current),at(next)))continue;
      const nextScore=scores.get(current)!+1;
      if(nextScore<(scores.get(next)??Infinity)){scores.set(next,nextScore);previous.set(next,current);open.add(next);}
    }
  }
  return null;
}
