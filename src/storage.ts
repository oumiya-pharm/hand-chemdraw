import { emptySketch, type Sketch } from './core/types';
export const STORAGE_KEY='te.sketch.v1';
export function parseSketch(text:string):Sketch {
  const d=JSON.parse(text);
  if(!d||d.version!==1||typeof d.title!=='string'||!Array.isArray(d.atoms)||!Array.isArray(d.bonds)||!Array.isArray(d.ink))throw Error('このノートの形式には対応していません。');
  if(d.atoms.length>5000||d.bonds.length>10000||d.ink.length>10000)throw Error('ノートが大きすぎます。');
  const point=(p:unknown)=>p&&typeof p==='object'&&Number.isFinite((p as {x:number}).x)&&Number.isFinite((p as {y:number}).y);
  const ids=new Set<string>();
  for(const a of d.atoms){if(!point(a)||typeof a.id!=='string'||ids.has(a.id)||typeof a.element!=='string'||!/^[A-Z][a-z]?$/.test(a.element))throw Error('原子の情報が壊れています。');ids.add(a.id);}
  const bondIds=new Set<string>();
  for(const b of d.bonds){if(!b||typeof b.id!=='string'||bondIds.has(b.id)||!ids.has(b.a)||!ids.has(b.b)||b.a===b.b||![1,2,3].includes(b.order))throw Error('結合の情報が壊れています。');bondIds.add(b.id);}
  for(const s of d.ink)if(!s||typeof s.id!=='string'||!Array.isArray(s.points)||s.points.length>100000||!s.points.every(point))throw Error('手書きの情報が壊れています。');
  return d as Sketch;
}
export function loadSketch():{sketch:Sketch;error:string|null} {
  try {const text=localStorage.getItem(STORAGE_KEY);return {sketch:text?parseSketch(text):emptySketch(),error:null};}
  catch{return {sketch:emptySketch(),error:'保存済みのノートを開けませんでした。元の保存データは保持しています。'};}
}
export function saveSketch(sketch:Sketch):void {localStorage.setItem(STORAGE_KEY,JSON.stringify(sketch));}
export function download(data:string|Uint8Array,filename:string,type:string) {
  const blob=typeof data==='string'?new Blob([data],{type}):new Blob([new Uint8Array(data).buffer],{type});
  const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
