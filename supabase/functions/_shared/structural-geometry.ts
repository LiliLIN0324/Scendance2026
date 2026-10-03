// Shared deterministic metre-space geometry. No renderer or browser dependency.
import type { Point, Scene, SceneObject, SceneV2, DimensionConstraint, SourceImage } from './domain.ts';
export type StructuralViolation={objectId:string;obstacleId:string;penetration:number;code:'WALL_COLLISION'|'COLUMN_COLLISION'|'OUT_OF_BOUNDS'};
const EPS=1e-6;
function cross(a:Point,b:Point,c:Point){return(b.x-a.x)*(c.z-a.z)-(b.z-a.z)*(c.x-a.x);}
function on(p:Point,a:Point,b:Point){return Math.abs(cross(a,b,p))<EPS&&p.x>=Math.min(a.x,b.x)-EPS&&p.x<=Math.max(a.x,b.x)+EPS&&p.z>=Math.min(a.z,b.z)-EPS&&p.z<=Math.max(a.z,b.z)+EPS;}
export function pointInPolygon(p:Point,poly:Point[]){let hit=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){const a=poly[i],b=poly[j];if(on(p,a,b))return true;if((a.z>p.z)!==(b.z>p.z)&&p.x<(b.x-a.x)*(p.z-a.z)/(b.z-a.z)+a.x)hit=!hit;}return hit;}
export function footprint(o:Pick<SceneObject,'position'|'size'|'rotation'>):Point[]{const a=o.rotation*Math.PI/180;return[[-1,-1],[1,-1],[1,1],[-1,1]].map(([x,z])=>({x:o.position.x+x*o.size.width/2*Math.cos(a)-z*o.size.depth/2*Math.sin(a),z:o.position.z+x*o.size.width/2*Math.sin(a)+z*o.size.depth/2*Math.cos(a)}));}
export function polygonPenetration(a:Point[],b:Point[]){let depth=Infinity;for(const poly of[a,b])for(let i=0;i<poly.length;i++){const p=poly[i],q=poly[(i+1)%poly.length],length=Math.hypot(q.x-p.x,q.z-p.z);if(length<EPS)continue;const nx=-(q.z-p.z)/length,nz=(q.x-p.x)/length;const aa=a.map(v=>v.x*nx+v.z*nz),bb=b.map(v=>v.x*nx+v.z*nz);const overlap=Math.min(Math.max(...aa)-Math.min(...bb),Math.max(...bb)-Math.min(...aa));if(overlap<=EPS)return 0;depth=Math.min(depth,overlap);}return Number.isFinite(depth)?depth:0;}
function distance(p:Point,a:Point,b:Point){const dx=b.x-a.x,dz=b.z-a.z,t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.z-a.z)*dz)/(dx*dx+dz*dz||1)));return Math.hypot(p.x-a.x-t*dx,p.z-a.z-t*dz);}
function boundaryPenetration(p:Point[],poly:Point[]){let score=0;for(let i=0;i<p.length;i++){const a=p[i],b=p[(i+1)%p.length];const t=[0,1];for(let j=0;j<poly.length;j++){const c=poly[j],d=poly[(j+1)%poly.length],dx=b.x-a.x,dz=b.z-a.z,ex=d.x-c.x,ez=d.z-c.z,den=dx*ez-dz*ex;if(Math.abs(den)<EPS)continue;const u=((c.x-a.x)*ez-(c.z-a.z)*ex)/den,v=((c.x-a.x)*dz-(c.z-a.z)*dx)/den;if(u>0&&u<1&&v>=0&&v<=1)t.push(u);}t.sort((a,b)=>a-b);for(let k=0;k<t.length;k++){const candidates=[t[k],k?t[k-1]+(t[k]-t[k-1])/2:t[k]];for(const f of candidates){const sample={x:a.x+(b.x-a.x)*f,z:a.z+(b.z-a.z)*f};if(!pointInPolygon(sample,poly))score=Math.max(score,EPS*2+Math.min(...poly.map((v,j)=>distance(sample,v,poly[(j+1)%poly.length]))));}}}return score;}
function validMount(o:SceneObject,w:SceneV2['structure']['walls'][number]){
 if(o.wallId!==w.id||!['decoration','backdrop','display'].includes(o.materialId)||o.size.depth>0.6||(o.elevation??0)+o.size.height>w.height+EPS)return false;
 const dx=w.end.x-w.start.x,dz=w.end.z-w.start.z,length=Math.hypot(dx,dz),angle=Math.atan2(dz,dx)*180/Math.PI,difference=Math.abs(((o.rotation-angle)%180+270)%180-90);
 if(difference>0.5)return false;
 const local=footprint(o).map(a=>({along:((a.x-w.start.x)*dx+(a.z-w.start.z)*dz)/length,across:((a.x-w.start.x)*-dz+(a.z-w.start.z)*dx)/length}));
 if(Math.min(...local.map(a=>a.along))<-EPS||Math.max(...local.map(a=>a.along))>length+EPS)return false;
 const low=Math.min(...local.map(a=>a.across)),high=Math.max(...local.map(a=>a.across));
 // Back face sits against a wall face, with at most 25 mm attachment penetration.
 return Math.abs(low-w.thickness/2)<=0.025+EPS||Math.abs(high+w.thickness/2)<=0.025+EPS;
}
export function structuralViolations(scene:Scene):StructuralViolation[]{const result:StructuralViolation[]=[];const v=scene.venue,poly=v.polygon??[{x:0,z:0},{x:v.width,z:0},{x:v.width,z:v.depth},{x:0,z:v.depth}];for(const o of scene.objects){const p=footprint(o),bottom=o.elevation??0,top=bottom+o.size.height;const exteriorMount=scene.schemaVersion===2&&scene.structure.walls.some(w=>w.kind==='exterior'&&validMount(o,w));const outside=Math.max(exteriorMount?0:boundaryPenetration(p,poly),top-v.height);if(outside>EPS)result.push({objectId:o.id,obstacleId:'venue',penetration:outside,code:'OUT_OF_BOUNDS'});if(scene.schemaVersion!==2)continue;for(const c of scene.structure.columns){if(bottom>=c.size.height-EPS)continue;const penetration=polygonPenetration(p,footprint(c));if(penetration>EPS)result.push({objectId:o.id,obstacleId:c.id,penetration,code:'COLUMN_COLLISION'});}for(const w of scene.structure.walls){if(bottom>=w.height-EPS)continue;const dx=w.end.x-w.start.x,dz=w.end.z-w.start.z,length=Math.hypot(dx,dz),angle=Math.atan2(dz,dx)*180/Math.PI;if(validMount(o,w))continue;
      const holes=scene.structure.openings.filter(h=>h.wallId===w.id&&bottom>=h.sillHeight-EPS&&top<=h.sillHeight+h.height+EPS).map(h=>[h.offset,h.offset+h.width]).sort((a,b)=>a[0]-b[0]);let cursor=0,maximum=0;for(const [start,end] of [...holes,[length,length]]){if(start>cursor+EPS){const width=start-cursor,center=(cursor+start)/2,wall=footprint({position:{x:w.start.x+dx*center/length,z:w.start.z+dz*center/length},rotation:angle,size:{width,depth:w.thickness,height:w.height}});maximum=Math.max(maximum,polygonPenetration(p,wall));}cursor=Math.max(cursor,end);}if(maximum>EPS)result.push({objectId:o.id,obstacleId:w.id,penetration:maximum,code:'WALL_COLLISION'});
    }}
  if(scene.schemaVersion===2)for(const [i,c]of scene.structure.columns.entries()){
    const shape=footprint(c),outside=Math.max(boundaryPenetration(shape,poly),c.size.height-v.height);
    if(outside>EPS)result.push({objectId:c.id,obstacleId:'venue',penetration:outside,code:'OUT_OF_BOUNDS'});
    for(const other of scene.structure.columns.slice(0,i)){const penetration=polygonPenetration(shape,footprint(other));if(penetration>EPS)result.push({objectId:c.id,obstacleId:other.id,penetration,code:'COLUMN_COLLISION'});}
  }
  return result;}
export function canApplyStructuralChange(before:Scene,after:Scene){const old=new Map(structuralViolations(before).map(v=>[[v.objectId,v.obstacleId].sort().join(':'),v.penetration]));return structuralViolations(after).every(v=>v.penetration<=(old.get([v.objectId,v.obstacleId].sort().join(':'))??0)+EPS);}
export function structuralWarnings(scene:Scene){return structuralViolations(scene).map(v=>({code:v.code,ids:v.obstacleId==='venue'?[v.objectId]:[v.objectId,v.obstacleId]}));}

type FloorplanMapping={state:'mapped';map:(point:Point)=>Point}|{state:'insufficient'|'inconsistent'};
/** Fit all same-image wall endpoint correspondences, keeping pixel aspect ratio and rejecting contradictory evidence. */
function floorplanMapping(scene:SceneV2,source:SourceImage):FloorplanMapping{
 const pairs=scene.structure.walls.flatMap(w=>(w.evidence??[]).filter(e=>e.sourceAssetId===source.assetId).flatMap(e=>[
  {pixel:{x:e.start.x*source.width,z:e.start.z*source.height},world:w.start},
  {pixel:{x:e.end.x*source.width,z:e.end.z*source.height},world:w.end},
 ]));
 if(pairs.length<3)return{state:'insufficient'};
 const n=pairs.length,center=pairs.reduce((s,p)=>({px:s.px+p.pixel.x/n,pz:s.pz+p.pixel.z/n,wx:s.wx+p.world.x/n,wz:s.wz+p.world.z/n}),{px:0,pz:0,wx:0,wz:0});
 let xx=0,xz=0,zz=0,xwx=0,zwx=0,xwz=0,zwz=0;
 for(const p of pairs){const x=p.pixel.x-center.px,z=p.pixel.z-center.pz,wx=p.world.x-center.wx,wz=p.world.z-center.wz;xx+=x*x;xz+=x*z;zz+=z*z;xwx+=x*wx;zwx+=z*wx;xwz+=x*wz;zwz+=z*wz;}
 const determinant=xx*zz-xz*xz;
 // At least three distinct, non-collinear image points are required. Near-line fits amplify small recognition errors.
 if(xx+zz<4||determinant<=(xx+zz)**2*1e-8)return{state:'insufficient'};
 const a=(xwx*zz-zwx*xz)/determinant,b=(zwx*xx-xwx*xz)/determinant,c=(xwz*zz-zwz*xz)/determinant,d=(zwz*xx-xwz*xz)/determinant;
 const worldDeterminant=a*d-b*c;
 if(Math.abs(worldDeterminant)<=(a*a+b*b+c*c+d*d)*1e-8)return{state:'inconsistent'};
 const mapPixel=(point:Point)=>({x:center.wx+a*(point.x-center.px)+b*(point.z-center.pz),z:center.wz+c*(point.x-center.px)+d*(point.z-center.pz)});
 // Test residuals back in pixels so this gate remains unchanged after metre-scale calibration.
 const tolerance=Math.max(3,Math.hypot(source.width,source.height)*0.01);
 for(const pair of pairs){const predicted=mapPixel(pair.pixel),rx=predicted.x-pair.world.x,rz=predicted.z-pair.world.z;
  if(Math.hypot((d*rx-b*rz)/worldDeterminant,(-c*rx+a*rz)/worldDeterminant)>tolerance)return{state:'inconsistent'};
 }
 return{state:'mapped',map:point=>mapPixel({x:point.x*source.width,z:point.z*source.height})};
}

/** Actual scene measurements, without changing geometry or claimed evidence. */
export function measurement(scene:SceneV2,d:DimensionConstraint):number|undefined{
 if(d.kind==='width')return scene.venue.width;if(d.kind==='depth')return scene.venue.depth;if(d.kind==='height')return scene.venue.height;
 const wall=scene.structure.walls.find(w=>w.id===d.targetId);
 if(d.sourceAssetId&&(d.kind==='distance'||d.kind==='wall')){
  const source=scene.sources.find(s=>s.assetId===d.sourceAssetId&&s.kind==='floorplan');
  if(!source||!d.start||!d.end)return undefined;
  const pixel=(p:Point)=>({x:p.x*source.width,z:p.z*source.height}),start=pixel(d.start),end=pixel(d.end),segmentLength=Math.hypot(end.x-start.x,end.z-start.z);
  if(segmentLength<2)return undefined;
  const mapping=floorplanMapping(scene,source);
  if(mapping.state==='mapped'){const a=mapping.map(d.start),b=mapping.map(d.end);return Math.hypot(b.x-a.x,b.z-a.z);}
  if(mapping.state==='inconsistent')return undefined;
  // A locally associated wall segment still works when there is insufficient evidence for a whole-plan transform.
  const evidence=wall?.evidence?.find(e=>e.sourceAssetId===d.sourceAssetId);
  if(!wall||!evidence)return undefined;
  const a=pixel(evidence.start),b=pixel(evidence.end),evidenceLength=Math.hypot(b.x-a.x,b.z-a.z),tolerance=Math.max(2,evidenceLength*0.01);
  if(evidenceLength<2||distance(start,a,b)>tolerance||distance(end,a,b)>tolerance)return undefined;
  return Math.hypot(wall.end.x-wall.start.x,wall.end.z-wall.start.z)*segmentLength/evidenceLength;
 }
 if(wall)return d.measure==='height'?wall.height:Math.hypot(wall.end.x-wall.start.x,wall.end.z-wall.start.z);
 const opening=scene.structure.openings.find(o=>o.id===d.targetId);if(opening)return d.measure==='height'?opening.height:opening.width;
 const column=scene.structure.columns.find(c=>c.id===d.targetId),other=scene.structure.columns.find(c=>c.id===d.targetEndId);
 if(column&&other)return Math.hypot(column.position.x-other.position.x,column.position.z-other.position.z);
 if(column&&d.measure&&d.measure!=='length')return column.size[d.measure];
 if(d.kind==='distance'&&!d.sourceAssetId&&d.start&&d.end)return Math.hypot(d.end.x-d.start.x,d.end.z-d.start.z);
 return undefined;
}
export type DimensionConflict={code:'DIMENSION_CONFLICT'|'DIMENSION_TARGET_REQUIRED';message:string;targetId:string;dimensionId:string;actual?:number};
export function dimensionConflicts(scene:Scene):DimensionConflict[]{
 if(scene.schemaVersion!==2)return[];
 return scene.dimensions.filter(d=>d.status==='confirmed').flatMap<DimensionConflict>(d=>{const actual=measurement(scene,d);return actual===undefined?[{code:'DIMENSION_TARGET_REQUIRED' as const,message:`请关联尺寸“${d.label||d.kind}”的对应结构`,targetId:d.targetId??d.id,dimensionId:d.id}]:Math.abs(actual-d.valueMeters)>0.001?[{code:'DIMENSION_CONFLICT' as const,message:`${d.label||d.kind}：确认 ${d.valueMeters} 米，实际 ${actual.toFixed(3)} 米`,targetId:d.targetId??d.id,dimensionId:d.id,actual}]:[];});
}
