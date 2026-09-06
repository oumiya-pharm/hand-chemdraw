import { type Point, type Sketch, type Stroke, type Recognition, type Atom, uid } from './types';
import { bounds, crossesItself, distance, fitRing, resample, segmentDistance, simplify, strokeSegments } from './geometry';
import { bondLines } from './render';
import { symbolCandidates } from './recognition';
const copy=(s:Sketch):Sketch=>structuredClone(s);
export function addRing(sketch:Sketch,center:Point,radius:number,size:number,rotation:number):Sketch {
  const result=copy(sketch),ids:string[]=[];
  for(let i=0;i<size;i++){
    const point={x:center.x+radius*Math.cos(rotation+i*2*Math.PI/size),y:center.y+radius*Math.sin(rotation+i*2*Math.PI/size)};
    const existing=result.atoms.find(a=>distance(a,point)<Math.min(14,radius*.2)),id=existing?.id??uid('a');ids.push(id);
    if(!existing)result.atoms.push({id,...point,element:'C'});
  }
  for(let i=0;i<size;i++)if(!result.bonds.some(b=>(b.a===ids[i]&&b.b===ids[(i+1)%size])||(b.b===ids[i]&&b.a===ids[(i+1)%size])))result.bonds.push({id:uid('b'),a:ids[i],b:ids[(i+1)%size],order:size===6&&i%2===0?2:1});
  return result;
}
function addSegments(sketch:Sketch,points:Point[]):Sketch {
  const result=copy(sketch);
  for(let i=1;i<points.length;i++){
    const p=points[i-1],q=points[i];if(distance(p,q)<9)continue;
    const candidates=result.bonds.flatMap(b=>{
      const a=result.atoms.find(a=>a.id===b.a)!,c=result.atoms.find(a=>a.id===b.b)!;
      const len=distance(a,c),strokeLength=distance(p,q);
      const cos=Math.abs(((q.x-p.x)*(c.x-a.x)+(q.y-p.y)*(c.y-a.y))/(len*strokeLength));
      const mid={x:(p.x+q.x)/2,y:(p.y+q.y)/2},d=segmentDistance(mid,a,c);
      if(cos<.94||strokeLength<len*.45||strokeLength>len*1.45||d>=Math.min(18,len*.3))return [];
      return [{bond:b,distance:d,retraced:d<=Math.max(3,Math.min(5,len*.03))}];
    });
    const existing=candidates.sort((a,b)=>Number(b.retraced)-Number(a.retraced)||a.distance-b.distance)[0];
    if(existing){
      if(!existing.retraced&&existing.bond.order<3){existing.bond.order=(existing.bond.order+1) as 2|3;existing.bond.orderEdited=true;}
      continue;
    }
    const getAtom=(v:Point):Atom=>{
      const snap=Math.max(10,Math.min(30,(localBondLength(result,v)??distance(p,q))*.23));
      const nearby=result.atoms.filter(a=>distance(a,v)<snap).sort((a,b)=>distance(a,v)-distance(b,v))[0];
      if(nearby)return nearby;
      const atom={id:uid('a'),x:v.x,y:v.y,element:'C'};result.atoms.push(atom);return atom;
    };
    const a=getAtom(p),b=getAtom(q);
    if(a.id!==b.id&&!result.bonds.some(e=>(e.a===a.id&&e.b===b.id)||(e.b===a.id&&e.a===b.id))){
      const cycle=newSixCarbonCycle(result,a.id,b.id);
      const closing={id:uid('b'),a:a.id,b:b.id,order:1 as const};
      result.bonds.push(closing);
      if(cycle)for(const [index,bond] of [...cycle,closing].entries())bond.order=index%2===0?2:1;
    }
  }
  return result;
}

function localBondLength(sketch:Sketch,point:Point):number|undefined {
  const nearby=sketch.bonds.map(b=>{
    const a=sketch.atoms.find(a=>a.id===b.a)!,c=sketch.atoms.find(a=>a.id===b.b)!;
    return {length:distance(a,c),near:segmentDistance(point,a,c)};
  }).filter(b=>b.length>0&&b.near<b.length*1.5).sort((a,b)=>a.near-b.near).slice(0,5).map(b=>b.length).sort((a,b)=>a-b);
  return nearby.length?nearby[Math.floor(nearby.length/2)]:undefined;
}

/** Inspect the graph before inserting the closing edge; never re-aromatize old cycles. */
function newSixCarbonCycle(sketch:Sketch,from:string,to:string):Sketch['bonds']|null {
  const queue:[string,string[],Sketch['bonds']][]=[[from,[from],[]]];
  while(queue.length){
    const [at,vertices,path]=queue.shift()!;
    for(const bond of sketch.bonds.filter(b=>b.a===at||b.b===at)){
      const next=bond.a===at?bond.b:bond.a;
      if(vertices.includes(next))continue;
      if(next===to){
        if(path.length!==4)return null; // A shorter path makes a different ring.
        const ids=[...vertices,next],cycle=[...path,bond],atoms=ids.map(id=>sketch.atoms.find(a=>a.id===id)!);
        if(atoms.some(a=>a.element!=='C'||a.charge||a.isotope)||cycle.some(b=>b.order!==1||b.stereo||b.orderEdited))return null;
        const internal=sketch.bonds.filter(b=>ids.includes(b.a)&&ids.includes(b.b));
        if(internal.length!==5||crossesItself([...atoms,atoms[0]]))return null;
        const area=Math.abs(atoms.reduce((sum,a,i)=>{const b=atoms[(i+1)%atoms.length];return sum+a.x*b.y-b.x*a.y;},0)/2),box=bounds(atoms);
        if(area<box.width*box.height*.3)return null;
        // Alternation adds one valence at every vertex; avoid overbonded fused or
        // heavily substituted structures and leave their explicit orders alone.
        if(ids.some(id=>sketch.bonds.filter(b=>b.a===id||b.b===id).reduce((n,b)=>n+b.order,0)+(id===from||id===to?2:1)>4))return null;
        return cycle;
      }
      if(path.length<4)queue.push([next,[...vertices,next],[...path,bond]]);
    }
  }
  return null;
}
function recognizeSymbol(sketch:Sketch,strokes:Stroke[]):Recognition|null {
  const points=strokes.flatMap(s=>s.points);
  const box=bounds(points),near=sketch.atoms.filter(a=>distance(a,box.center)<32).sort((a,b)=>distance(a,box.center)-distance(b,box.center))[0];
  const symbols=symbolCandidates(strokes);
  if(Math.max(box.width,box.height)<75&&symbols[0]?.score>.88&&(near||Math.max(box.width,box.height)<36)){
    const match=symbols[0];if(near||match.score>.87){
      const result=copy(sketch);
      if(near)result.atoms.find(a=>a.id===near.id)!.element=match.element;
      else result.atoms.push({id:uid('a'),...box.center,element:match.element});
      return {sketch:result,recognized:true,label:`${match.element} に変換`,kind:'atom'};
    }
  }
  return null;
}

/** Ambiguous pen movement still becomes an editable, bounded carbon path. */
function fallbackPoints(points:Point[]):Point[] {
  const box=bounds(points),span=Math.hypot(box.width,box.height);
  if(span<12)return [box.center];
  const sampled=resample(points,97);
  let tolerance=Math.max(6,span*.045),path=simplify(sampled,tolerance);
  while(path.length>12){tolerance*=1.5;path=simplify(sampled,tolerance);}
  // A returning stroke can collapse to identical endpoints during simplification.
  // Keep its furthest excursion so a substantial mark still produces a bond.
  if(path.length<2||path.every(p=>distance(p,path[0])<12)){
    const farthest=sampled.reduce((best,p)=>distance(p,sampled[0])>distance(best,sampled[0])?p:best,sampled[0]);
    return distance(sampled[0],farthest)>=12?[sampled[0],farthest]:[box.center];
  }
  return path;
}

function addCarbonPoint(sketch:Sketch,point:Point):Sketch {
  const snap=Math.max(10,Math.min(30,(localBondLength(sketch,point)??60)*.23));
  if(sketch.atoms.some(a=>distance(a,point)<snap))return sketch;
  const result=copy(sketch);
  result.atoms.push({id:uid('a'),...point,element:'C'});
  return result;
}

export function recognize(sketch:Sketch,strokes:Stroke[]):Recognition {
  strokes=strokes.filter(stroke=>stroke.points.length>0);
  if(!strokes.length)return {sketch,recognized:false,label:'',kind:'bond'};
  // Recognize the whole group first, preserving letters such as three-stroke N.
  const symbol=recognizeSymbol(sketch,strokes);
  if(symbol)return symbol;
  let result=sketch,hasBond=false,ringSize=0,atomLabel='C に変換';
  for(const stroke of strokes){
    const strokeSymbol=strokes.length>1?recognizeSymbol(result,[stroke]):null;
    if(strokeSymbol){result=strokeSymbol.sketch;atomLabel=strokeSymbol.label;continue;}
    const ring=fitRing(stroke.points);
    if(ring){result=addRing(result,ring.center,ring.radius,ring.size,ring.rotation);ringSize=ring.size;continue;}
    const shape=strokeSegments(stroke.points,localBondLength(result,stroke.points[0]))??fallbackPoints(stroke.points);
    if(shape.length>1){result=addSegments(result,shape);hasBond=true;}
    else result=addCarbonPoint(result,shape[0]);
  }
  return {sketch:result,recognized:true,label:ringSize?(ringSize===6?'ベンゼン環に整えました':`${ringSize}員環に整えました`):hasBond?'結合を描きました':atomLabel,kind:ringSize?'ring':hasBond?'bond':'atom'};
}
export function erase(sketch:Sketch,path:Point[],radius:number):Sketch {
  if(!path.length)return sketch;
  const hit=(p:Point)=>path.some((v,i)=>i?segmentDistance(p,path[i-1],v)<=radius:distance(p,v)<=radius);
  const result=copy(sketch),lines=bondLines(sketch),erased=new Set<string>();
  for(const line of lines){
    let covered=0;for(let i=0;i<=24;i++)if(hit({x:line.from.x+(line.to.x-line.from.x)*i/24,y:line.from.y+(line.to.y-line.from.y)*i/24}))covered++;
    if(covered/25>=.55)erased.add(line.id);
  }
  const removedAtoms=new Set<string>();
  result.bonds=result.bonds.filter(b=>{
    const removed=lines.filter(l=>l.bondId===b.id&&erased.has(l.id)).length;
    if(removed>=b.order){removedAtoms.add(b.a);removedAtoms.add(b.b);return false;}
    if(removed){b.order=(b.order-removed) as 1|2|3;b.orderEdited=true;}return true;
  });
  for(const atom of result.atoms)if(atom.element!=='C'&&hit(atom)){atom.element='C';delete atom.charge;delete atom.isotope;delete atom.hydrogens;}
  result.atoms=result.atoms.filter(a=>{
    if(hit(a)&&!sketch.bonds.some(b=>b.a===a.id||b.b===a.id))return false;
    return !(removedAtoms.has(a.id)&&a.element==='C'&&!result.bonds.some(b=>b.a===a.id||b.b===a.id));
  });
  result.ink=sketch.ink.flatMap(s=>{
    const pieces:Stroke[]=[];let current:Point[]=[];
    for(const p of s.points){if(hit(p)){if(current.length>1)pieces.push({id:uid('ink'),points:current});current=[];}else current.push(p);}
    if(current.length>1)pieces.push({id:uid('ink'),points:current});return pieces;
  });
  return result;
}
