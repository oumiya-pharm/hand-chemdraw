import type { Sketch, BondLine, Point } from './types';
export function bondLines(sketch: Sketch): BondLine[] {
  const atomMap=new Map(sketch.atoms.map(a=>[a.id,a])),lines:BondLine[]=[];
  const labelled=new Set(atomLabels(sketch).map(a=>a.atomId));
  for(const bond of sketch.bonds){
    const a=atomMap.get(bond.a),b=atomMap.get(bond.b);if(!a||!b)continue;
    const dx=b.x-a.x,dy=b.y-a.y,len=Math.hypot(dx,dy);if(len<.01)continue;
    const ux=dx/len,uy=dy/len;
    const neighbours=sketch.bonds.filter(e=>e.id!==bond.id&&(e.a===a.id||e.b===a.id||e.a===b.id||e.b===b.id)).flatMap(e=>[atomMap.get(e.a),atomMap.get(e.b)]).filter(v=>v&&v.id!==a.id&&v.id!==b.id);
    const cross=neighbours.reduce((s,n)=>s+dx*(n!.y-(a.y+b.y)/2)-dy*(n!.x-(a.x+b.x)/2),0);
    const side=cross<0?-1:1,offset=Math.min(9,Math.max(5,len*.13));
    for(let index=0;index<bond.order;index++){
      const off=bond.order===3?(index-1)*offset:index*offset*side;
      const shorten=index>0&&bond.order===2?Math.min(10,len*.16):0;
      const trimA=labelled.has(a.id)?Math.min(13,len*.3):0,trimB=labelled.has(b.id)?Math.min(13,len*.3):0;
      const from:Point={x:a.x+ux*(trimA+shorten)-uy*off,y:a.y+uy*(trimA+shorten)+ux*off};
      const to:Point={x:b.x-ux*(trimB+shorten)-uy*off,y:b.y-uy*(trimB+shorten)+ux*off};
      lines.push({id:`${bond.id}:${index}`,bondId:bond.id,index,from,to});
    }
  }
  return lines;
}
export type LabelPart = { text: string; script?: 'super' | 'sub' };
export type AtomLabel = { atomId: string; x: number; y: number; parts: LabelPart[] };
export function atomLabels(sketch: Sketch): AtomLabel[] {
  return sketch.atoms.filter(a=>a.element!=='C'||!!a.isotope||!!a.charge||!!a.hydrogens||!sketch.bonds.some(b=>b.a===a.id||b.b===a.id)).map(a=>{
    const parts:LabelPart[]=[];
    if(a.isotope)parts.push({text:String(a.isotope),script:'super'});
    parts.push({text:a.element});
    if(a.hydrogens){parts.push({text:'H'});if(a.hydrogens>1)parts.push({text:String(a.hydrogens),script:'sub'});}
    if(a.charge)parts.push({text:(Math.abs(a.charge)===1?'':String(Math.abs(a.charge)))+(a.charge>0?'+':'−'),script:'super'});
    return {atomId:a.id,x:a.x,y:a.y,parts};
  });
}
export type BondMark = { bondId: string; kind: 'wedge' | 'either'; points: Point[] } | { bondId: string; kind: 'hash'; segments: {from: Point; to: Point}[] };
export function bondMarks(sketch: Sketch): BondMark[] {
  const lines=new Map(bondLines(sketch).filter(l=>l.index===0).map(l=>[l.bondId,l]));
  const marks:BondMark[]=[];
  for(const bond of sketch.bonds){
    if(!bond.stereo||bond.order!==1)continue;
    const line=lines.get(bond.id);if(!line)continue;
    const {from,to}=line,dx=to.x-from.x,dy=to.y-from.y,len=Math.hypot(dx,dy);
    const nx=-dy/len,ny=dx/len,width=Math.min(7,len*.16);
    const point=(t:number,offset=0):Point=>({x:from.x+dx*t+nx*offset,y:from.y+dy*t+ny*offset});
    if(bond.stereo==='up')marks.push({bondId:bond.id,kind:'wedge',points:[from,point(1,width),point(1,-width)]});
    else if(bond.stereo==='down'){
      const count=Math.max(4,Math.ceil(len/7));
      const segments=Array.from({length:count},(_,i)=>{const t=(i+1)/count;return {from:point(t,-width*t),to:point(t,width*t)};});
      marks.push({bondId:bond.id,kind:'hash',segments});
    }else{
      const count=Math.max(4,Math.ceil(len/5));
      const points=[from,...Array.from({length:count-1},(_,i)=>point((i+1)/count,(i%2===0?1:-1)*Math.min(3,len*.1))),to];
      marks.push({bondId:bond.id,kind:'either',points});
    }
  }
  return marks;
}
export function regularBondLines(sketch:Sketch):BondLine[] {
  const marked=new Set(bondMarks(sketch).map(m=>m.bondId));
  return bondLines(sketch).filter(l=>!marked.has(l.bondId));
}
export function sketchBounds(sketch:Sketch) {
  const points=[...sketch.atoms,...sketch.ink.flatMap(s=>s.points)];
  if(!points.length)return {x:0,y:0,width:600,height:400};
  const left=Math.min(...points.map(p=>p.x))-30,top=Math.min(...points.map(p=>p.y))-30;
  return {x:left,y:top,width:Math.max(...points.map(p=>p.x))-left+30,height:Math.max(...points.map(p=>p.y))-top+30};
}
const escape=(text:string)=>text.replace(/[<>&"']/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'}[c]!));
export function toSvg(sketch:Sketch,includeInk=false):string {
  const box=sketchBounds({...sketch,ink:includeInk?sketch.ink:[]});
  const lines=regularBondLines(sketch).map(l=>`<line x1="${l.from.x}" y1="${l.from.y}" x2="${l.to.x}" y2="${l.to.y}"/>`).join('');
  const points=(p:Point[])=>p.map(v=>`${v.x},${v.y}`).join(' ');
  const marks=bondMarks(sketch).map(mark=>mark.kind==='hash'
    ?mark.segments.map(l=>`<line x1="${l.from.x}" y1="${l.from.y}" x2="${l.to.x}" y2="${l.to.y}"/>`).join('')
    :mark.kind==='wedge'?`<polygon points="${points(mark.points)}" fill="#24342f" stroke="none"/>`:`<polyline points="${points(mark.points)}"/>`).join('');
  const labels=atomLabels(sketch).map(a=>`<text x="${a.x}" y="${a.y}" text-anchor="middle" dominant-baseline="central" font-family="Arial,sans-serif" font-size="22" fill="#24342f" stroke="none">${a.parts.map(p=>p.script?`<tspan baseline-shift="${p.script}" font-size="12">${escape(p.text)}</tspan>`:escape(p.text)).join('')}</text>`).join('');
  const ink=includeInk?sketch.ink.map(s=>`<polyline points="${s.points.map(p=>`${p.x},${p.y}`).join(' ')}"/>`).join(''):'';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${box.width}" height="${box.height}" viewBox="${box.x} ${box.y} ${box.width} ${box.height}"><g fill="none" stroke="#24342f" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${lines}${marks}${ink}${labels}</g></svg>`;
}
