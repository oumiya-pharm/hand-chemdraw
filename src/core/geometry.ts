import type { Point } from './types';
export const distance = (a: Point, b: Point) => Math.hypot(a.x-b.x,a.y-b.y);
export function segmentDistance(p: Point, a: Point, b: Point): number {
  const dx=b.x-a.x,dy=b.y-a.y, length=dx*dx+dy*dy;
  const t=length ? Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/length)) : 0;
  return Math.hypot(p.x-a.x-t*dx,p.y-a.y-t*dy);
}
export function bounds(points: Point[]) {
  const xs=points.map(p=>p.x),ys=points.map(p=>p.y);
  const left=Math.min(...xs),right=Math.max(...xs),top=Math.min(...ys),bottom=Math.max(...ys);
  return {left,right,top,bottom,width:right-left,height:bottom-top,center:{x:(left+right)/2,y:(top+bottom)/2}};
}
export function simplify(points: Point[], epsilon: number): Point[] {
  if(points.length<3) return points;
  let max=0,index=0;
  for(let i=1;i<points.length-1;i++) { const d=segmentDistance(points[i],points[0],points.at(-1)!);if(d>max){max=d;index=i;} }
  if(max<=epsilon) return [points[0],points.at(-1)!];
  return [...simplify(points.slice(0,index+1),epsilon).slice(0,-1),...simplify(points.slice(index),epsilon)];
}
export function resample(points: Point[], count=48): Point[] {
  if(points.length<2) return points;
  const cumulative=[0];
  for(let i=1;i<points.length;i++) cumulative.push(cumulative.at(-1)!+distance(points[i-1],points[i]));
  const length=cumulative.at(-1)!;
  if(length<0.001) return [points[0]];
  let segment=1;
  return Array.from({length:count},(_,i)=>{
    const at=length*i/(count-1);
    while(segment<cumulative.length-1&&cumulative[segment]<at)segment++;
    const f=(at-cumulative[segment-1])/(cumulative[segment]-cumulative[segment-1]||1);
    return {x:points[segment-1].x+(points[segment].x-points[segment-1].x)*f,y:points[segment-1].y+(points[segment].y-points[segment-1].y)*f};
  });
}
export function fitRing(points: Point[]): {center:Point;radius:number;size:number;rotation:number}|null {
  if(points.length<6)return null;
  const box=bounds(points),diag=Math.hypot(box.width,box.height);
  if(Math.min(box.width,box.height)<28||distance(points[0],points.at(-1)!)>diag*.28)return null;
  const sampled=resample([...points,points[0]],121).slice(0,-1);
  const smooth=sampled.map((_,i)=>average(Array.from({length:5},(_,j)=>sampled[(i+j+sampled.length-2)%sampled.length])));
  if(crossesItself([...simplify([...smooth,smooth[0]],diag*.012)]))return null;

  // Analyze an affine-normalized copy: shear and unequal hand-drawn sides should
  // not change the atom count. The sketch coordinates themselves are untouched.
  const center=average(smooth),xx=smooth.reduce((s,p)=>s+(p.x-center.x)**2,0)/smooth.length;
  const yy=smooth.reduce((s,p)=>s+(p.y-center.y)**2,0)/smooth.length,xy=smooth.reduce((s,p)=>s+(p.x-center.x)*(p.y-center.y),0)/smooth.length;
  const angle=Math.atan2(2*xy,xx-yy)/2,c=Math.cos(angle),s=Math.sin(angle);
  const spread=Math.hypot(xx-yy,2*xy),major=Math.sqrt((xx+yy+spread)/2),minor=Math.sqrt(Math.max(1,(xx+yy-spread)/2));
  if(major/minor>3.5)return null;
  const normalized=smooth.map(p=>({x:((p.x-center.x)*c+(p.y-center.y)*s)/major,y:((p.y-center.y)*c-(p.x-center.x)*s)/minor}));
  const normalizedBox=bounds(normalized),scale=Math.hypot(normalizedBox.width,normalizedBox.height);
  let area=0;normalized.forEach((p,i)=>{const next=normalized[(i+1)%normalized.length];area+=p.x*next.y-next.x*p.y;});
  if(Math.abs(area/2)/(normalizedBox.width*normalizedBox.height)<.42)return null;

  // A ring started in the middle of a side must give the same corners as one
  // started at a vertex. Use a stable extremum, then discard collinear starts.
  const start=normalized.reduce((best,p,i)=>p.x<normalized[best].x?i:best,0);
  const loop=[...normalized.slice(start),...normalized.slice(0,start)];
  let corners:Point[]|undefined;
  let unsupportedPolygon=false;
  for(const tolerance of [.025,.035,.045,.055]){
    const candidate=closedCorners(loop,scale*tolerance);
    if(candidate.length<3)continue;
    const residual=loop.reduce((sum,p)=>sum+Math.min(...candidate.map((a,i)=>segmentDistance(p,a,candidate[(i+1)%candidate.length]))),0)/loop.length;
    if(candidate.length>7){
      if(tolerance===.055&&residual<scale*.01)unsupportedPolygon=true;
      continue;
    }
    // Smooth circles have no evidence for a particular polygon size. Six is the
    // default only for these otherwise valid, ring-sized closed contours.
    if(residual<scale*.014&&(!corners||candidate.length<corners.length))corners=candidate;
  }
  const sharpCorner=sampled.some((p,i)=>{
    const a=sampled[(i+sampled.length-2)%sampled.length],b=sampled[(i+2)%sampled.length];
    return Math.abs(Math.atan2((p.x-a.x)*(b.y-p.y)-(p.y-a.y)*(b.x-p.x),(p.x-a.x)*(b.x-p.x)+(p.y-a.y)*(b.y-p.y)))>.6;
  });
  if(!corners&&unsupportedPolygon&&sharpCorner)return null;
  const size=corners?.length??6;
  const originalCorners=corners?.map(p=>smooth[normalized.indexOf(p)]);
  const ringCenter=originalCorners?average(originalCorners):center;
  const radius=originalCorners?originalCorners.reduce((sum,p)=>sum+distance(p,ringCenter),0)/size:Math.sqrt(Math.abs(area/2)*major*minor/Math.PI);
  const first=originalCorners?.[0]??points[0],rotation=Math.atan2(first.y-ringCenter.y,first.x-ringCenter.x);
  return {center:ringCenter,radius,size,rotation};
}

function average(points:Point[]):Point {
  return {x:points.reduce((sum,p)=>sum+p.x,0)/points.length,y:points.reduce((sum,p)=>sum+p.y,0)/points.length};
}

function closedCorners(points:Point[],epsilon:number):Point[] {
  const corners=simplify([...points,points[0]],epsilon).slice(0,-1);
  let removed=true;
  while(removed&&corners.length>3){
    removed=false;
    for(let i=corners.length-1;i>=0&&corners.length>3;i--){
      const p=corners[i],a=corners[(i+corners.length-1)%corners.length],b=corners[(i+1)%corners.length];
      const turn=Math.abs(Math.atan2((p.x-a.x)*(b.y-p.y)-(p.y-a.y)*(b.x-p.x),(p.x-a.x)*(b.x-p.x)+(p.y-a.y)*(b.y-p.y)));
      if(segmentDistance(p,a,b)<epsilon||turn<.45){corners.splice(i,1);removed=true;}
    }
  }
  return corners;
}

export function crossesItself(points:Point[]):boolean {
  const cross=(a:Point,b:Point,c:Point)=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
  for(let i=1;i<points.length;i++)for(let j=i+2;j<points.length;j++){
    if(i===1&&j===points.length-1&&distance(points[0],points.at(-1)!)<1)continue;
    const a=points[i-1],b=points[i],c=points[j-1],d=points[j];
    if(cross(a,b,c)*cross(a,b,d)<0&&cross(c,d,a)*cross(c,d,b)<0)return true;
  }
  return false;
}

/** Keep localized, deliberate turns; distributed curvature is pen movement. */
export function strokeSegments(points:Point[],bondLength?:number):Point[]|null {
  if(points.length<2)return null;
  const first=points[0],last=points.at(-1)!,chord=distance(first,last);
  if(chord<12)return null;
  const length=points.slice(1).reduce((sum,p,i)=>sum+distance(points[i],p),0);
  const rough=simplify(points,Math.max(2,length*.008));
  if(crossesItself(rough))return null;
  const deviation=Math.max(...points.map(p=>segmentDistance(p,first,last)));
  if(deviation<chord*.085&&length/chord<1.5)return [first,last];
  const sampled=resample(points,97);
  const smooth=sampled.map((p,i)=>i<2||i>=sampled.length-2?p:average(sampled.slice(i-2,i+3)));
  const turns=smooth.map((p,i)=>{
    if(i<4||i>=smooth.length-4)return 0;
    const a=smooth[i-4],b=smooth[i+4],ux=p.x-a.x,uy=p.y-a.y,vx=b.x-p.x,vy=b.y-p.y;
    return Math.abs(Math.atan2(ux*vy-uy*vx,ux*vx+uy*vy));
  });
  const peaks:number[]=[];
  for(let i=4;i<turns.length-4;i++)if(turns[i]>.6){
    let peak=i;
    while(i+1<turns.length-4&&turns[i+1]>.6){i++;if(turns[i]>turns[peak])peak=i;}
    peaks.push(peak);
  }
  if(!peaks.length)return deviation<chord*.35&&length/chord<1.6?[first,last]:null;
  const minimum=Math.max(12,Math.min(bondLength??length*.18,length*.25)*.3);
  const corners=[first,...peaks.map(i=>sampled[i]),last];
  for(let i=corners.length-2;i>0;i--)if(distance(corners[i],corners[i+1])<minimum||distance(corners[i],corners[i-1])<minimum)corners.splice(i,1);
  return corners.length<=14?corners:null;
}
