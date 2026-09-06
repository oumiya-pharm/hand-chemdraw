import { uid, type Sketch } from '../core/types';
export type ChemicalFormat = 'smiles'|'mol-v2000'|'mol-v3000'|'sdf-v2000'|'sdf-v3000'|'cdxml'|'cdx'|'inchi'|'inchi-key'|'cml'|'ket';
interface Options { set(key:string,value:string):void; delete():void }
interface Vector { delete():void }
export interface Indigo {
 MapStringString: new()=>Options; VectorInt:new()=>Vector;
 convert(input:string,format:string,options:Options):string;
 dearomatize(input:string,format:string,options:Options):string;
 layout(input:string,format:string,options:Options):string;
 check(input:string,properties:string,options:Options):string;
 calculate(input:string,options:Options,selection:Vector):string;
}
// Chemical coordinates use a right-handed axis; screen coordinates point down.
export function sketchToMol(sketch:Sketch, atomMapping=false):string {
 if(!sketch.atoms.length)throw new Error('構造に原子がありません。');
 const ids=new Map(sketch.atoms.map((a,i)=>[a.id,i+1]));
 if(ids.size!==sketch.atoms.length)throw new Error('原子IDが重複しています。');
 const atoms=sketch.atoms.map((a,i)=>{
  if(!/^[A-Z][a-z]?$/.test(a.element)||!Number.isFinite(a.x)||!Number.isFinite(a.y))throw new Error('原子または座標が不正です。');
  const props:string[]=[];
  if(a.charge){if(!Number.isInteger(a.charge)||Math.abs(a.charge)>15)throw new Error('電荷が不正です。');props.push(`CHG=${a.charge}`)}
  if(a.isotope){if(!Number.isInteger(a.isotope)||a.isotope<1)throw new Error('同位体が不正です。');props.push(`MASS=${a.isotope}`)}
  if(a.hydrogens!==undefined){if(!Number.isInteger(a.hydrogens)||a.hydrogens<0)throw new Error('水素数が不正です。');const valence=sketch.bonds.reduce((n,b)=>n+(b.a===a.id||b.b===a.id?b.order:0),0)+a.hydrogens;props.push(`VAL=${valence||-1}`)}
  return `M  V30 ${i+1} ${a.element} ${(a.x/40).toFixed(6)} ${(-a.y/40).toFixed(6)} 0 ${atomMapping?i+1:0}${props.length?' '+props.join(' '):''}`;
 });
 const bonds=sketch.bonds.map((b,i)=>{
  if(!ids.has(b.a)||!ids.has(b.b)||b.a===b.b||![1,2,3].includes(b.order))throw new Error('結合の参照または次数が不正です。');
  return `M  V30 ${i+1} ${b.order} ${ids.get(b.a)} ${ids.get(b.b)}${b.stereo?` CFG=${b.stereo==='up'?1:b.stereo==='down'?3:2}`:''}`;
 });
 // The editor supports absolute wedge stereochemistry only. MOL chiral=0
 // would reinterpret those wedges as a relative/racemic enhanced stereo group.
 // An unspecified/either bond does not assert an absolute stereocenter.
 const chiral=sketch.bonds.some(b=>b.order===1&&(b.stereo==='up'||b.stereo==='down'))?1:0;
 return [sketch.title.replace(/[\r\n]/g,' ').slice(0,80),'  Hand Chemistry','', '  0  0  0  0  0  0  0  0  0  0  0 V3000','M  V30 BEGIN CTAB',`M  V30 COUNTS ${atoms.length} ${bonds.length} 0 0 ${chiral}`,'M  V30 BEGIN ATOM',...atoms,'M  V30 END ATOM','M  V30 BEGIN BOND',...bonds,'M  V30 END BOND','M  V30 END CTAB','M  END',''].join('\n');
}
function binaryToBase64(input:Uint8Array):string{let s='';for(const byte of input)s+=String.fromCharCode(byte);return btoa(s)}
function ketToSketch(text:string):Sketch {
 const ket=JSON.parse(text);const sketch:Sketch={version:1,title:'読み込んだ構造',atoms:[],bonds:[],ink:[]};
 for(const ref of ket.root?.nodes??[]){const node=ket[ref.$ref];if(!node||node.type!=='molecule')throw new Error('反応・注釈などを含む形式は、この編集モデルでは読み込めません。');
  if(node.sgroups?.length)throw new Error('Sグループを含む構造は対応していません。');
  const atoms=node.atoms.map((a:{label:string;location?:number[];charge?:number;isotope?:number;radical?:number;queryProperties?:unknown;implicitHCount?:number;stereoLabel?:string})=>{
   if(a.stereoLabel && a.stereoLabel !== 'abs')throw new Error('相対・混合立体グループは対応していません。');
   if(!/^[A-Z][a-z]?$/.test(a.label)||a.radical||a.queryProperties)throw new Error('クエリ原子・ラジカルは対応していません。');
   return {id:uid('atom'),element:a.label,x:(a.location?.[0]??0)*40,y:-(a.location?.[1]??0)*40,...(a.charge?{charge:a.charge}:{}),...(a.isotope?{isotope:a.isotope}:{}),...(a.implicitHCount!==undefined?{hydrogens:a.implicitHCount}:{})};
  });
  sketch.atoms.push(...atoms);
  for(const b of node.bonds??[]){if(![1,2,3].includes(b.type)||!atoms[b.atoms[0]]||!atoms[b.atoms[1]])throw new Error('対応していない結合です。');sketch.bonds.push({id:uid('bond'),a:atoms[b.atoms[0]].id,b:atoms[b.atoms[1]].id,order:b.type,...(b.stereo?{stereo:b.stereo===1?'up' as const:b.stereo===6?'down' as const:'either' as const}:{})})}
 }
 if(!sketch.atoms.length)throw new Error('読み込める原子がありません。');
 const minX=Math.min(...sketch.atoms.map(a=>a.x)),minY=Math.min(...sketch.atoms.map(a=>a.y));for(const a of sketch.atoms){a.x+=100-minX;a.y+=100-minY}
 return sketch;
}

type Coordinate = {x:number;y:number};
type LayoutAtom = {mapping?:number;location?:number[]};
const NOMINAL_BOND_LENGTH=60;
function median(values:number[],fallback:number):number {
 const sorted=values.filter(n=>Number.isFinite(n)&&n>1e-6).sort((a,b)=>a-b);
 if(!sorted.length)return fallback;
 const middle=Math.floor(sorted.length/2);
 return sorted.length%2?sorted[middle]:(sorted[middle-1]+sorted[middle])/2;
}
function centroid(points:Coordinate[]):Coordinate {
 return {x:points.reduce((sum,p)=>sum+p.x,0)/points.length,y:points.reduce((sum,p)=>sum+p.y,0)/points.length};
}
function components(sketch:Sketch):Sketch[] {
 const adjacency=new Map(sketch.atoms.map(a=>[a.id,[] as string[]]));
 for(const b of sketch.bonds){adjacency.get(b.a)!.push(b.b);adjacency.get(b.b)!.push(b.a)}
 const visited=new Set<string>();const result:Sketch[]=[];
 for(const atom of sketch.atoms){
  if(visited.has(atom.id))continue;
  const ids=new Set<string>();const queue=[atom.id];visited.add(atom.id);
  for(let i=0;i<queue.length;i++){const id=queue[i];ids.add(id);for(const next of adjacency.get(id)!){if(!visited.has(next)){visited.add(next);queue.push(next)}}}
  result.push({...sketch,atoms:sketch.atoms.filter(a=>ids.has(a.id)),bonds:sketch.bonds.filter(b=>ids.has(b.a)),ink:[]});
 }
 return result;
}
function alignedCoordinates(component:Sketch,points:Coordinate[],reflected=false):Coordinate[] {
 const oldCenter=centroid(component.atoms),newCenter=centroid(points);
 const centered=points.map(p=>({x:(p.x-newCenter.x)*(reflected?-1:1),y:p.y-newCenter.y}));
 const indices=new Map(component.atoms.map((a,i)=>[a.id,i]));
 const bondLengths=(coords:Coordinate[])=>component.bonds.map(b=>{const a=coords[indices.get(b.a)!],c=coords[indices.get(b.b)!];return Math.hypot(a.x-c.x,a.y-c.y)});
 // A single paper scale makes separate rings, chains and imported structures
 // consistent regardless of the size of the original handwriting.
 const scale=NOMINAL_BOND_LENGTH/median(bondLengths(centered),1);
 let dot=0,cross=0;
 for(let i=0;i<centered.length;i++){const a=centered[i],b=component.atoms[i];dot+=a.x*(b.x-oldCenter.x)+a.y*(b.y-oldCenter.y);cross+=a.x*(b.y-oldCenter.y)-a.y*(b.x-oldCenter.x)}
 const idealRotation=Math.atan2(cross,dot);
 const first=component.bonds[0],a=centered[indices.get(first.a)!],b=centered[indices.get(first.b)!];
 const firstAngle=Math.atan2(b.y-a.y,b.x-a.x),step=Math.PI/6;
 const rotation=Math.round((idealRotation+firstAngle)/step)*step-firstAngle;
 const cosine=Math.cos(rotation),sine=Math.sin(rotation);
 return centered.map(p=>({x:oldCenter.x+scale*(p.x*cosine-p.y*sine),y:oldCenter.y+scale*(p.x*sine+p.y*cosine)}));
}

/** An unfinished ring is also an open carbon chain. Retain its handed turns
 * instead of letting a fresh layout replace that conformation with a zigzag. */
function continuingPathCoordinates(component:Sketch,laidOut:Coordinate[]):Coordinate[]|undefined {
 if(component.atoms.length<3||component.bonds.length!==component.atoms.length-1||component.atoms.some(a=>a.element!=='C')||component.bonds.some(b=>b.order!==1||b.stereo))return;
 const indices=new Map(component.atoms.map((a,i)=>[a.id,i])),neighbors=component.atoms.map(()=>[] as number[]);
 for(const b of component.bonds){const a=indices.get(b.a)!,c=indices.get(b.b)!;neighbors[a].push(c);neighbors[c].push(a)}
 if(neighbors.some(n=>n.length>2))return;
 const first=neighbors.findIndex(n=>n.length===1);if(first<0)return;
 const path=[first];let previous=-1;
 while(path.length<component.atoms.length){const current=path.at(-1)!,next=neighbors[current].find(i=>i!==previous);if(next===undefined)return;previous=current;path.push(next)}
 const cross=(a:Coordinate,b:Coordinate,c:Coordinate)=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
 const turn=(a:Coordinate,b:Coordinate,c:Coordinate)=>Math.atan2(cross(a,b,c),(b.x-a.x)*(c.x-b.x)+(b.y-a.y)*(c.y-b.y));
 const length=median(component.bonds.map(b=>{const a=laidOut[indices.get(b.a)!],c=laidOut[indices.get(b.b)!];return Math.hypot(c.x-a.x,c.y-a.y)}),1);
 const points:Coordinate[]=[{x:0,y:0},{x:length,y:0}];let direction=0;
 for(let i=1;i<path.length-1;i++){
  const [a,b,c]=path.slice(i-1,i+2),sourceTurn=turn(component.atoms[a],component.atoms[b],component.atoms[c]);
  const targetTurn=Math.abs(turn(laidOut[a],laidOut[b],laidOut[c]));
  // Small freehand deviations are meaningful; almost-straight noise is not a
  // request to curl a chain. Let Indigo choose those ambiguous conformations.
  if(!Number.isFinite(sourceTurn)||Math.abs(sourceTurn)<Math.PI/6||Math.abs(Math.abs(sourceTurn)-targetTurn)>Math.PI/6)return;
  direction+=Math.sign(sourceTurn)*targetTurn;
  points.push({x:points[i].x+length*Math.cos(direction),y:points[i].y+length*Math.sin(direction)});
 }
 const unobstructed=(p:Coordinate[],minimumSeparation:number)=>{
  for(let i=0;i<p.length;i++)for(let j=i+2;j<p.length;j++){
   if(Math.hypot(p[i].x-p[j].x,p[i].y-p[j].y)<minimumSeparation)return false;
   if(i+1<j&&j+1<p.length&&cross(p[i],p[i+1],p[j])*cross(p[i],p[i+1],p[j+1])<0&&cross(p[j],p[j+1],p[i])*cross(p[j],p[j+1],p[i+1])<0)return false;
  }
  return true;
 };
 if(!unobstructed(path.map(i=>component.atoms[i]),1)||!unobstructed(points,length*.4))return;
 const result=Array<Coordinate>(path.length);for(let i=0;i<path.length;i++)result[path[i]]=points[i];return result;
}

export function createEngine(indigo:Indigo){
 function options<T>(fn:(o:Options)=>T):T{const o=new indigo.MapStringString();try{return fn(o)}finally{o.delete()}}
 // A user can draw a wedge before its atom has enough neighbors to be a
 // stereocenter. Indigo's documented MOL-loading option keeps these glyphs
 // while omitting nonexistent stereocenters from chemical identifiers. Without
 // it, WASM falls back to a query molecule and InChI/checks fail. Scope this
 // option to our explicit sketch graphs; external imports keep strict defaults.
 // https://lifescience.opensource.epam.com/indigo/options/index.html
 function sketchOptions<T>(fn:(o:Options)=>T):T{return options(o=>{o.set('ignore-stereochemistry-errors','true');return fn(o)})}
 return {
  clean(sketch:Sketch):Sketch {return sketchOptions(o=>{
   if(!sketch.atoms.length)return structuredClone(sketch);
   sketchToMol(sketch); // Validate the whole graph before walking its components.
   const coordinates=new Map<string,Coordinate>();
   for(const component of components(sketch)){
    if(!component.bonds.length){for(const a of component.atoms)coordinates.set(a.id,{x:a.x,y:a.y});continue}
    // Temporary atom-map numbers survive Indigo serialization and make the
    // identity boundary independent of output atom/fragment ordering.
    const ket=JSON.parse(indigo.layout(sketchToMol(component,true),'ket',o));
    const laidOut:LayoutAtom[]=(ket.root?.nodes??[]).flatMap((ref:{$ref:string})=>ket[ref.$ref]?.atoms??[]);
    const mapped=new Map<number,Coordinate>();
    for(const a of laidOut){
     if(!Number.isInteger(a.mapping)||a.mapping!<1||a.mapping!>component.atoms.length||mapped.has(a.mapping!)||!a.location||!Number.isFinite(a.location[0])||!Number.isFinite(a.location[1]))throw new Error('整形後の原子対応を確認できませんでした。');
     mapped.set(a.mapping!,{x:a.location[0],y:-a.location[1]});
    }
    if(mapped.size!==component.atoms.length)throw new Error('整形後の原子数が一致しません。');
    const points=component.atoms.map((_,i)=>mapped.get(i+1)!);
    // Indigo may relocate a wedge or mirror a fragment during layout. Keep the
    // user's wedge records and accept only geometry with the same chemical
    // identity, including absolute stereo and coordinate-defined double bonds.
    const identity=component.bonds.some(b=>b.stereo||b.order===2)?indigo.convert(sketchToMol(component),'inchi',o):undefined;
    const candidates=[alignedCoordinates(component,points),alignedCoordinates(component,points,true)];
    const continuingPath=continuingPathCoordinates(component,points);
    if(continuingPath)candidates.push(alignedCoordinates(component,continuingPath));
    const displacement=(candidate:Coordinate[])=>candidate.reduce((sum,p,i)=>sum+(p.x-component.atoms[i].x)**2+(p.y-component.atoms[i].y)**2,0);
    candidates.sort((a,b)=>displacement(a)-displacement(b));
    let positioned=candidates.find(candidate=>identity===undefined||indigo.convert(sketchToMol({...component,atoms:component.atoms.map((a,i)=>({...a,...candidate[i]}))}),'inchi',o)===identity);
    if(!positioned)throw new Error('立体配置を保持したまま整形できませんでした。構造は変更していません。');
    // Ignore serialization noise so repeated cleanup retains exact snapping
    // targets, without preserving visibly different sizes near the shared scale.
    if(positioned.every((p,i)=>Math.hypot(p.x-component.atoms[i].x,p.y-component.atoms[i].y)<1e-4))positioned=component.atoms;
    for(let i=0;i<component.atoms.length;i++)coordinates.set(component.atoms[i].id,positioned[i]);
   }
   return {...structuredClone(sketch),atoms:sketch.atoms.map(a=>({...a,...coordinates.get(a.id)!}))};
  })},
  convert(sketch:Sketch,format:ChemicalFormat):string|Uint8Array {return sketchOptions(o=>{o.set('molfile-saving-mode',format.endsWith('v3000')?'3000':'2000');const target=format.startsWith('mol-')?'molfile':format.startsWith('sdf-')?'sdf':format;const result=indigo.convert(sketchToMol(sketch),target,o);return format==='cdx'?Uint8Array.from(atob(result),c=>c.charCodeAt(0)):result})},
  parse(input:string|Uint8Array,format?:string):Sketch {return options(o=>{
   if(format==='inchi-key'||(typeof input==='string'&&/^[A-Z]{14}-[A-Z]{10}-[A-Z]$/.test(input.trim())))throw new Error('InChIKeyは識別子のため構造を復元できません。');
   const text=typeof input==='string'?input:binaryToBase64(input);
   if(text.length>10_000_000)throw new Error('ファイルが大きすぎます。');
   if(text.split('$$$$').filter(s=>s.trim()).length>1)throw new Error('複数レコードのSDFは対応していません。');
   // Inspect metadata before any layout/MOL projection can discard it.
   const originalKet=JSON.parse(indigo.convert(text,'ket',o));
   for(const node of Object.values(originalKet) as {atoms?:{mapping?:number;alias?:string}[]}[]){
    for(const atom of node.atoms??[]){
     if(atom.mapping)throw new Error('原子マッピングを保持できないため、読み込みを中止しました。');
     if(atom.alias!==undefined)throw new Error('原子エイリアスを保持できないため、読み込みを中止しました。');
    }
   }
   // MOL preserves atom parity until layout can turn it into wedges. KET alone
   // can discard parity for coordinate-free SMILES in Indigo 1.46.
   const mol=indigo.convert(text,'molfile',o);
   const atomCount=Number(mol.split('\n')[3]?.slice(0,3));
   const molCoords=mol.split('\n').slice(4,4+atomCount).map(line=>line.slice(0,20));
   const source=new Set(molCoords).size<=1?indigo.layout(text,'molfile',o):text;
   let ket=indigo.dearomatize(source,'ket',o);
   const parsed=JSON.parse(ket);const coords=(parsed.root?.nodes??[]).flatMap((r:{$ref:string})=>parsed[r.$ref]?.atoms??[]).map((a:{location?:number[]})=>a.location?.slice(0,2).join(','));
   if(new Set(coords).size<=1)ket=indigo.layout(ket,'ket',o);
   const sketch=ketToSketch(ket);
   const selection=new indigo.VectorInt();
   try{const original=JSON.parse(indigo.calculate(text,o,selection));const restored=JSON.parse(indigo.calculate(sketchToMol(sketch),o,selection));if(original['gross-formula']!==restored['gross-formula'])throw new Error('この構造の水素・原子情報を正確に保持できないため、読み込みを中止しました。')}finally{selection.delete()}
   return sketch;
  })},
  analyze(sketch:Sketch){return sketchOptions(o=>{const mol=sketchToMol(sketch);const v=new indigo.VectorInt();try{const calculated=JSON.parse(indigo.calculate(mol,o,v));const checks=JSON.parse(indigo.check(mol,'valence;ambiguous_h;stereo',o));return {smiles:indigo.convert(mol,'smiles',o),formula:calculated['gross-formula']??'',mass:calculated['molecular-weight']??'',issues:Object.values(checks).map(String)}}finally{v.delete()}})}
 };
}
