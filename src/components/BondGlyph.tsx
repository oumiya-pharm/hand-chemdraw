import type {BondKind} from '../core/bondEditing';
import type {Point} from '../core/types';

/** The same directional glyph is used by the palette and the live pen preview. */
export default function BondGlyph({kind,from={x:3,y:10},to={x:31,y:10}}:{kind:BondKind;from?:Point;to?:Point}) {
  const dx=to.x-from.x,dy=to.y-from.y,length=Math.hypot(dx,dy);
  if(length<1)return null;
  const angle=Math.atan2(dy,dx)*180/Math.PI,width=Math.min(6,length*.18);
  return <g transform={`translate(${from.x} ${from.y}) rotate(${angle})`} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    {kind==='up'?<path d={`M0 0 L${length} ${-width} L${length} ${width} Z`} fill="currentColor" stroke="none"/>:
      kind==='down'?Array.from({length:7},(_,i)=>{const t=(i+1)/7;return <line key={i} x1={length*t} y1={-width*t} x2={length*t} y2={width*t}/>;}):
      kind==='either'?<polyline points={Array.from({length:11},(_,i)=>`${length*i/10},${i===0||i===10?0:(i%2?1:-1)*Math.min(2.4,length*.1)}`).join(' ')}/>:
      (kind==='triple'?[-4,0,4]:kind==='double'?[-2.5,2.5]:[0]).map(y=><line key={y} x1="0" y1={y} x2={length} y2={y}/>)}
  </g>;
}
