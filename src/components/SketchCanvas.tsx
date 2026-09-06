import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { Pencil, Move, Minus, Plus, Maximize, X } from 'lucide-react';
import { type Sketch, type Tool, type Stroke, type Point, uid } from '../core/types';
import { bounds, distance } from '../core/geometry';
import { recognize, erase } from '../core/editor';
import { regularBondLines, bondMarks, atomLabels, sketchBounds } from '../core/render';
import {atomAlongPath,paintAtom,rectangleAtoms,eraseRectangle,chargedElementLabel} from '../core/directEditing';
import {paintBond,bondAlongPath,BOND_KINDS,type BondKind} from '../core/bondEditing';
import BondGlyph from './BondGlyph';

type Props={sketch:Sketch;tool:Tool;paintElement:string|null;paintCharge:number;paintBondKind:BondKind|null;eraserSize:number;resetKey:number;grid:boolean;onChange:(sketch:Sketch,merge?:boolean)=>Sketch;onStatus:(message:string)=>void;onSelect:(id:string|null)=>void;selected:string|null};
type Group={base:Sketch;strokes:Stroke[];last:number;committed:boolean;kind:string;awaitingLabel?:boolean};
export type CanvasHandle={flush:()=>Sketch;isBusy:()=>boolean;acceptLayout:(before:Sketch,after:Sketch)=>Sketch|null};
const SketchCanvas=forwardRef<CanvasHandle,Props>(function SketchCanvas({sketch,tool,paintElement,paintCharge,paintBondKind,eraserSize,resetKey,grid,onChange,onStatus,onSelect,selected},ref) {
  const svg=useRef<SVGSVGElement>(null),root=useRef<HTMLDivElement>(null);
  const [size,setSize]=useState({width:1200,height:800});
  const [view,setView]=useState({x:0,y:0,scale:1});
  const [active,setActive]=useState<Point[]>([]),[pending,setPending]=useState<Stroke[]>([]),[cursor,setCursor]=useState<Point|null>(null);
  const [space,setSpace]=useState(false),[temporaryEraser,setTemporaryEraser]=useState(false),[hint,setHint]=useState(true);
  const input=useRef<{points:Point[];base:Sketch;mode:'pencil'|'atom'|'bond'|'eraser'|'box-erase'|'pan'|'move';start:Point;view:typeof view;atomId?:string;element?:string;charge?:number;bondKind?:BondKind}|null>(null);
  const group=useRef<Group|null>(null),timer=useRef<ReturnType<typeof setTimeout>|null>(null);
  const current=useRef(sketch);current.current=sketch;
  const actualTool=temporaryEraser?'eraser':tool;
  useEffect(()=>{
    const observer=new ResizeObserver(([entry])=>setSize({width:entry.contentRect.width,height:entry.contentRect.height}));
    if(root.current)observer.observe(root.current);return()=>observer.disconnect();
  },[]);
  useEffect(()=>{if(timer.current)clearTimeout(timer.current);timer.current=null;group.current=null;input.current=null;setPending([]);setActive([]);},[resetKey]);
  useEffect(()=>()=>{if(timer.current)clearTimeout(timer.current);},[]);
  useEffect(()=>{
    const down=(e:KeyboardEvent)=>{if((e.target as HTMLElement).matches('input,textarea,select')||document.querySelector('dialog[open], [role="dialog"][aria-modal="true"]'))return;if(e.code==='Space'){e.preventDefault();setSpace(true);}if(e.code==='KeyE')setTemporaryEraser(true);if(e.code==='Escape'){if(timer.current)clearTimeout(timer.current);timer.current=null;setActive([]);setPending([]);input.current=null;group.current=null;}};
    const up=(e:KeyboardEvent)=>{if(e.code==='Space')setSpace(false);if(e.code==='KeyE')setTemporaryEraser(false);};
    const blur=()=>{setSpace(false);setTemporaryEraser(false);input.current=null;setActive([]);};
    window.addEventListener('keydown',down);window.addEventListener('keyup',up);window.addEventListener('blur',blur);
    return()=>{window.removeEventListener('keydown',down);window.removeEventListener('keyup',up);window.removeEventListener('blur',blur);};
  },[]);
  function point(e:{clientX:number;clientY:number}):Point {
    const rect=svg.current!.getBoundingClientRect();return{x:view.x+(e.clientX-rect.left)/view.scale,y:view.y+(e.clientY-rect.top)/view.scale,t:performance.now()};
  }
  function finishGroup(g:Group) {
    const result=recognize(g.base,g.strokes);onStatus(result.label);
    const previous=current.current,accepted=onChange(result.sketch,g.committed);
    g.committed=g.committed||accepted!==previous;g.kind=result.kind;
    const box=bounds(g.strokes.flatMap(s=>s.points));
    // A short label can span several pen lifts. Show the best chemical candidate
    // immediately, but keep its original base until the remaining strokes arrive.
    g.awaitingLabel=result.kind==='bond'&&Math.max(box.width,box.height)<42&&g.base.atoms.some(a=>distance(a,box.center)<32);
    current.current=accepted;
    setPending([]);if(result.kind==='ring'||result.kind==='atom')group.current=null;
    return accepted;
  }
  function flushPending():Sketch {
    if(timer.current){clearTimeout(timer.current);timer.current=null;if(group.current)return finishGroup(group.current);}
    return current.current;
  }
  const inputBusy=()=>!!input.current||!!timer.current||!!(group.current?.awaitingLabel&&Date.now()-group.current.last<2400);
  useImperativeHandle(ref,()=>({flush:flushPending,isBusy:inputBusy,acceptLayout:(before,after)=>{
    if(inputBusy()||current.current!==before)return null;
    group.current=null;
    current.current=after;return after;
  }}));
  function down(e:ReactPointerEvent<SVGSVGElement>) {
    if(e.button!==0&&e.button!==1)return;e.preventDefault();svg.current!.setPointerCapture(e.pointerId);
    const p=point(e);setCursor(p);
    const base=flushPending();
    const mode=space||e.button===1?'pan':actualTool==='select'?'move':actualTool==='pencil'&&paintElement?'atom':actualTool==='pencil'&&paintBondKind?'bond':actualTool;
    if(mode==='move'){
      const atom=base.atoms.filter(a=>distance(a,p)<22).sort((a,b)=>distance(a,p)-distance(b,p))[0];
      onSelect(atom?.id??null);input.current={points:[p],base,mode,start:p,view,atomId:atom?.id};return;
    }
    if(mode==='pencil'){
      const g=group.current,box=g?bounds(g.strokes.flatMap(s=>s.points)):null;
      if(!g||Date.now()-g.last>2400||!box||p.x<box.left-45||p.x>box.right+45||p.y<box.top-45||p.y>box.bottom+45)group.current={base,strokes:[],last:Date.now(),committed:false,kind:'ink'};
    }else group.current=null;
    input.current={points:[p],base,mode,start:p,view,...(mode==='atom'?{element:paintElement!,charge:paintCharge}:{}),...(mode==='bond'?{bondKind:paintBondKind!}:{})};setActive([p]);onSelect(null);
  }
  function move(e:ReactPointerEvent<SVGSVGElement>) {
    const p=point(e);setCursor(p);const data=input.current;if(!data)return;
    if(data.mode==='pan'){
      const dx=(e.movementX||0)/view.scale,dy=(e.movementY||0)/view.scale;setView(v=>({...v,x:v.x-dx,y:v.y-dy}));return;
    }
    if(distance(data.points.at(-1)!,p)>.6)data.points.push(p);setActive([...data.points]);
  }
  function up(e:ReactPointerEvent<SVGSVGElement>) {
    const data=input.current;if(!data)return;input.current=null;
    if(svg.current?.hasPointerCapture(e.pointerId))svg.current.releasePointerCapture(e.pointerId);
    const p=point(e);if(distance(data.points.at(-1)!,p)>.2)data.points.push(p);
    if(data.mode==='pan'){setActive([]);return;}
    if(data.mode==='move'){
      if(data.atomId&&distance(p,data.start)>2){const next=structuredClone(data.base),atom=next.atoms.find(a=>a.id===data.atomId)!;atom.x+=p.x-data.start.x;atom.y+=p.y-data.start.y;onChange(next);onStatus('位置を調整しました');}
      setActive([]);return;
    }
    if(data.mode==='eraser'){const next=erase(data.base,data.points,eraserSize/view.scale);if(JSON.stringify(next)!==JSON.stringify(data.base))onChange(next);onStatus('消しゴムで消しました');setActive([]);return;}
    if(data.mode==='box-erase'){
      const next=eraseRectangle(data.base,data.start,p),count=data.base.atoms.length-next.atoms.length;
      onStatus(count?`${count} 原子と接続する結合を消しました`:'範囲内に原子がありません');
      if(count)current.current=onChange(next);setActive([]);return;
    }
    if(data.mode==='atom'){
      const next=paintAtom(data.base,data.points,data.element!,18/data.view.scale,data.charge);
      onStatus(`${chargedElementLabel(data.element!,data.charge??0)} に変更しました`);current.current=onChange(next);setActive([]);return;
    }
    if(data.mode==='bond'){
      const next=paintBond(data.base,data.points,data.bondKind!,12/data.view.scale);
      if(next!==data.base){onStatus(`${BOND_KINDS.find(k=>k.kind===data.bondKind)!.label} に変更しました`);current.current=onChange(next);}
      setActive([]);return;
    }
    const stroke={id:uid('ink'),points:data.points},g=group.current??{base:data.base,strokes:[],last:Date.now(),committed:false,kind:'ink'};
    g.strokes.push(stroke);g.last=Date.now();group.current=g;setPending(g.strokes);setActive([]);
    timer.current=setTimeout(()=>{timer.current=null;finishGroup(g);},280);
  }
  function zoom(factor:number){setView(v=>{const scale=Math.max(.3,Math.min(3,v.scale*factor));return{x:v.x+size.width/2/v.scale-size.width/2/scale,y:v.y+size.height/2/v.scale-size.height/2/scale,scale};});}
  function fit(){if(!sketch.atoms.length&&!sketch.ink.length){setView({x:0,y:0,scale:1});return;}const box=sketchBounds(sketch),scale=Math.min(1.3,(size.width-180)/box.width,(size.height-160)/box.height);setView({x:box.x-(size.width/scale-box.width)/2,y:box.y-(size.height/scale-box.height)/2,scale});}
  const empty=!sketch.atoms.length&&!sketch.ink.length&&!pending.length&&!active.length;
  const inkPath=(pts:Point[])=>pts.map(p=>`${p.x},${p.y}`).join(' ');
  const lines=regularBondLines(sketch),marks=bondMarks(sketch),labelMap=new Map(atomLabels(sketch).map(label=>[label.atomId,label]));
  const selection=input.current?.mode==='box-erase'&&active.length?bounds([input.current.start,active.at(-1)!]):null;
  const eraseTargets=selection?rectangleAtoms(sketch,input.current!.start,active.at(-1)!):new Set<string>();
  const erasedBonds=new Set(sketch.bonds.filter(b=>eraseTargets.has(b.a)||eraseTargets.has(b.b)).map(b=>b.id));
  const bondColor=(id:string)=>erasedBonds.has(id)?'#bb6b55':'#263e35';
  const atomTarget=actualTool==='pencil'&&paintElement&&!space?atomAlongPath(sketch,input.current?.mode==='atom'?active:cursor?[cursor]:[],18/view.scale):undefined;
  const bondTarget=actualTool==='pencil'&&paintBondKind&&!space?bondAlongPath(sketch,input.current?.mode==='bond'?active:cursor?[cursor]:[],12/view.scale):undefined;
  const targetFrom=bondTarget&&sketch.atoms.find(a=>a.id===bondTarget.a),targetTo=bondTarget&&sketch.atoms.find(a=>a.id===bondTarget.b);
  return <div className={`paper ${grid?'paper-grid':''}`} ref={root}>
    <div className="paper-meta"><span>ノート / 01</span><span>思いついた構造を、そのまま。</span></div>
    <svg ref={svg} className={`sketch-canvas tool-${space?'pan':actualTool}`} data-testid="sketch-canvas" role="application" aria-label="鉛筆で構造式を描く紙面" viewBox={`${view.x} ${view.y} ${size.width/view.scale} ${size.height/view.scale}`} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={()=>{input.current=null;setActive([]);}} onPointerLeave={()=>{if(!input.current)setCursor(null);}} onWheel={e=>{if(input.current)return;if(e.ctrlKey||e.metaKey)zoom(e.deltaY>0?.94:1.06);else setView(v=>({...v,x:v.x+e.deltaX/v.scale,y:v.y+e.deltaY/v.scale}));}}>
      <defs><mask id="eraser-mask"><rect x={view.x} y={view.y} width={size.width/view.scale} height={size.height/view.scale} fill="white"/>{input.current?.mode==='eraser'&&active.length>0&&<polyline points={inkPath(active)} stroke="black" strokeWidth={eraserSize*2/view.scale} strokeLinecap="round" strokeLinejoin="round" fill="none"/>}</mask></defs>
      <g mask="url(#eraser-mask)" className="molecule" strokeLinecap="round" strokeLinejoin="round">
        {targetFrom&&targetTo&&<line className="bond-target" x1={targetFrom.x} y1={targetFrom.y} x2={targetTo.x} y2={targetTo.y} stroke="#b8d6c6" strokeWidth={12/view.scale} opacity=".5"/>}
        {lines.map(l=><line key={l.id} data-bond-id={l.bondId} data-bond-index={l.index} x1={l.from.x} y1={l.from.y} x2={l.to.x} y2={l.to.y} stroke={bondColor(l.bondId)} strokeWidth="2.1"/>)}
        {marks.map(mark=><g key={mark.bondId} data-bond-id={mark.bondId}>{mark.kind==='hash'?mark.segments.map((segment,i)=><line key={i} x1={segment.from.x} y1={segment.from.y} x2={segment.to.x} y2={segment.to.y} stroke={bondColor(mark.bondId)} strokeWidth="1.7"/>):mark.kind==='wedge'?<polygon points={inkPath(mark.points)} fill={bondColor(mark.bondId)} stroke="none"/>:<polyline points={inkPath(mark.points)} fill="none" stroke={bondColor(mark.bondId)} strokeWidth="2.1"/>}</g>)}
        {sketch.atoms.map(a=><g key={a.id} data-atom-id={a.id} data-element={a.element} data-charge={a.charge??0} data-x={a.x} data-y={a.y}>
          {selected===a.id&&<circle cx={a.x} cy={a.y} r="18" fill="#d9e9e2" stroke="#5c8e77" strokeWidth="1"/>}
          {eraseTargets.has(a.id)&&<circle className="erase-target" cx={a.x} cy={a.y} r={11/view.scale}/>}
          {atomTarget?.id===a.id&&<circle className="atom-target" cx={a.x} cy={a.y} r={17/view.scale} strokeWidth={1/view.scale}/>}
          {labelMap.has(a.id)&&<text x={a.x} y={a.y} textAnchor="middle" dominantBaseline="central" className="atom-label">{labelMap.get(a.id)!.parts.map((part,i)=>part.script?<tspan key={i} baselineShift={part.script} fontSize="12">{part.text}</tspan>:<tspan key={i}>{part.text}</tspan>)}</text>}
        </g>)}
        {sketch.ink.map(s=><polyline key={s.id} className="raw-ink" points={inkPath(s.points)}/>)}
      </g>
      {pending.map(s=><polyline key={s.id} className="live-ink" points={inkPath(s.points)}/>)}
      {(input.current?.mode==='pencil'||input.current?.mode==='atom')&&<polyline className="live-ink" points={inkPath(active)}/>}
      {input.current?.mode==='bond'&&active.length>1&&<g className="live-bond"><BondGlyph kind={input.current.bondKind!} from={active[0]} to={active.at(-1)!}/></g>}
      {selection&&<rect className="erase-selection" x={selection.left} y={selection.top} width={selection.width} height={selection.height} strokeWidth={1/view.scale} strokeDasharray={`${5/view.scale} ${4/view.scale}`}/>}
      {cursor&&actualTool==='pencil'&&paintElement&&!space&&<text className="element-cursor" x={cursor.x+16/view.scale} y={cursor.y-12/view.scale} fontSize={14/view.scale}>{chargedElementLabel(paintElement,paintCharge)}</text>}
      {cursor&&actualTool==='eraser'&&!space&&<circle cx={cursor.x} cy={cursor.y} r={eraserSize/view.scale} className="eraser-cursor" strokeWidth={1/view.scale}/>}
      {input.current?.mode==='move'&&active.length>1&&<line x1={active[0].x} y1={active[0].y} x2={active.at(-1)!.x} y2={active.at(-1)!.y} stroke="#719484" strokeDasharray="4 4"/>}
    </svg>
    {empty&&<div className="empty-paper"><div className="sketch-example"><svg viewBox="0 0 230 100"><path d="M25 49 44 15 82 18 99 51 79 84 41 81 25 49" fill="none" stroke="#9ea9a2" strokeWidth="1.8" strokeLinecap="round"/><path d="M115 50h22m-6-5 6 5-6 5" stroke="#9ea9a2" strokeWidth="1.5" fill="none"/><g stroke="#426452" fill="none" strokeWidth="1.8"><path d="M156 50 173 20 207 20 224 50 207 80 173 80Z"/><path d="m178 27 24 0m14 23-12 22m-36-22 12 22"/></g></svg></div><h1>紙に描くように、構造式を。</h1><p>六角形を描く。Nを選んで、頂点をなぞる。<br/>描いた線は、その場で構造式に。</p><span className="start-hint"><Pencil size={14}/> 好きな場所から、描きはじめる</span></div>}
    {hint&&<div className="paper-hint"><span><kbd>E</kbd> を押している間は消しゴム</span><button aria-label="ヒントを閉じる" onClick={()=>setHint(false)}><X size={13}/></button></div>}
    <div className="zoom-controls"><Move size={14} className="pan-icon"/><span className="pan-caption">Space で移動</span><div className="zoom-divider"/><button aria-label="縮小" onClick={()=>zoom(.8)}><Minus size={15}/></button><span>{Math.round(view.scale*100)}%</span><button aria-label="拡大" onClick={()=>zoom(1.25)}><Plus size={15}/></button><button aria-label="構造を画面に収める" onClick={fit}><Maximize size={15}/></button></div>
  </div>;
});
export default SketchCanvas;
