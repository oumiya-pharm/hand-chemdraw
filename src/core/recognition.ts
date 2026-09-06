import { bounds, distance, resample } from './geometry';
import type { Point, Stroke } from './types';
const path=(pairs:number[][]):Point[]=>pairs.map(([x,y])=>({x,y}));
const arc=(start:number,end:number):Point[]=>Array.from({length:40},(_,i)=>({x:.5+.5*Math.cos(start+(end-start)*i/39),y:.5+.5*Math.sin(start+(end-start)*i/39)}));
const templates: [string,Point[][]][]=[
  ['N',[path([[0,1],[0,0],[1,1],[1,0]])]],
  ['N',[path([[0,0],[0,1]]),path([[0,0],[1,1]]),path([[1,0],[1,1]])]],
  ['O',[arc(0,Math.PI*2)]], ['C',[arc(Math.PI*.22,Math.PI*1.78)]],
  ['H',[path([[0,0],[0,1]]),path([[1,0],[1,1]]),path([[0,.5],[1,.5]])]],
  ['F',[path([[0,1],[0,0],[1,0]]),path([[0,.45],[.8,.45]])]],
  ['P',[path([[0,1],[0,0],[.8,0],[1,.15],[1,.35],[.8,.5],[0,.5]])]],
  ['S',[path([[1,.12],[.8,0],[.2,0],[0,.2],[.15,.4],[.8,.6],[1,.8],[.8,1],[.2,1],[0,.9]])]],
  ['B',[path([[0,1],[0,0],[.7,0],[1,.18],[.7,.48],[0,.48],[.8,.48],[1,.72],[.8,1],[0,1]])]],
];
function normalize(strokes:Point[][]):Point[] {
  const all=strokes.flat(),box=bounds(all);
  return strokes.flatMap(s=>resample(s,Math.max(12,Math.round(64*s.length/all.length)))).map(p=>({x:(p.x-box.left)/Math.max(box.width,1),y:(p.y-box.top)/Math.max(box.height,1)}));
}
const normalized=templates.map(([label,strokes])=>({label,points:normalize(strokes)}));
function cloudDistance(a:Point[],b:Point[]):number {
  const directed=(p:Point[],q:Point[])=>p.reduce((s,v)=>s+Math.min(...q.map(w=>distance(v,w))),0)/p.length;
  return (directed(a,b)+directed(b,a))/2;
}
export function symbolCandidates(strokes:Stroke[]):{element:string;score:number}[] {
  const all=strokes.flatMap(s=>s.points);if(all.length<4)return [];
  const box=bounds(all);if(box.height<9||box.width<5||box.width/box.height>2.6)return [];
  const input=normalize(strokes.map(s=>s.points)),best=new Map<string,number>();
  for(const t of normalized){const d=cloudDistance(input,t.points);best.set(t.label,Math.min(best.get(t.label)??Infinity,d));}
  return [...best].map(([element,d])=>({element,score:1-d*3})).sort((a,b)=>b.score-a.score);
}
