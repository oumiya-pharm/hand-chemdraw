import {bounds,distance,segmentDistance} from './geometry';
import {type Atom,type Point,type Sketch,uid} from './types';

/** One gesture edits one atom, preferring the vertex where the gesture started. */
export function atomAlongPath(sketch:Sketch,path:Point[],radius:number):Atom|undefined {
  if(!path.length)return;
  const start=sketch.atoms.filter(a=>distance(a,path[0])<=radius).sort((a,b)=>distance(a,path[0])-distance(b,path[0]))[0];
  if(start)return start;
  for(let i=1;i<path.length;i++){
    const hit=sketch.atoms.filter(a=>segmentDistance(a,path[i-1],path[i])<=radius)
      .sort((a,b)=>distance(a,path[i-1])-distance(b,path[i-1]))[0];
    if(hit)return hit;
  }
}

export function paintAtom(sketch:Sketch,path:Point[],element:string,radius:number,charge=0):Sketch {
  if(!path.length)return sketch;
  const target=atomAlongPath(sketch,path,radius);
  if(target?.element===element&&(target.charge??0)===charge)return sketch;
  const replacement:Atom=target?{...target,element}:{id:uid('a'),...bounds(path).center,element};
  if(charge)replacement.charge=charge;else delete replacement.charge;
  return {...sketch,atoms:target?sketch.atoms.map(a=>a.id===target.id?replacement:a):[...sketch.atoms,replacement]};
}

export function chargedElementLabel(element:string,charge:number):string {
  const superscript=['⁰','¹','²','³','⁴','⁵','⁶','⁷','⁸','⁹'];
  return element+(charge?(Math.abs(charge)===1?'':String(Math.abs(charge)).split('').map(n=>superscript[Number(n)]).join(''))+(charge>0?'⁺':'⁻'):'');
}

export function rectangleAtoms(sketch:Sketch,from:Point,to:Point):Set<string> {
  const box=bounds([from,to]);
  if(box.width<2||box.height<2)return new Set();
  return new Set(sketch.atoms.filter(a=>a.x>=box.left&&a.x<=box.right&&a.y>=box.top&&a.y<=box.bottom).map(a=>a.id));
}

export function eraseRectangle(sketch:Sketch,from:Point,to:Point):Sketch {
  const removed=rectangleAtoms(sketch,from,to);
  if(!removed.size)return sketch;
  return {...sketch,atoms:sketch.atoms.filter(a=>!removed.has(a.id)),bonds:sketch.bonds.filter(b=>!removed.has(b.a)&&!removed.has(b.b))};
}
