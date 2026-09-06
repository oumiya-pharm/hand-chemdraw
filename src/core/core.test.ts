import { describe, it, expect } from 'vitest';
import { emptySketch, type Point } from './types';
import { recognize, erase, addRing } from './editor';
import { bondLines } from './render';

const hex: Point[] = [{x:160,y:100},{x:130,y:152},{x:70,y:152},{x:40,y:100},{x:70,y:48},{x:130,y:48},{x:160,y:100}];
const dense = (p: Point[]) => p.flatMap((a,i)=>i===p.length-1?[a]:Array.from({length:12},(_,j)=>({x:a.x+(p[i+1].x-a.x)*j/12,y:a.y+(p[i+1].y-a.y)*j/12})));
describe('paper editing', () => {
  it('turns a rough hexagon into a benzene graph', () => {
    const result = recognize(emptySketch(), [{id:'ink1',points:dense(hex)}]);
    expect(result.kind).toBe('ring');
    expect(result.sketch.atoms).toHaveLength(6);
    expect(result.sketch.bonds).toHaveLength(6);
    expect(result.sketch.bonds.filter(b=>b.order===2)).toHaveLength(3);
  });
  it('recognizes a rough hexagon from a vertex or edge in either drawing direction',()=>{
    for(const rotation of [0,.37,Math.PI/2])for(const reverse of [false,true])for(const start of [0,5,17]){
      const loop=dense(hex).slice(0,-1).map((p,i)=>({x:300+(p.x-100)*Math.cos(rotation)-(p.y-100)*Math.sin(rotation)+Math.sin(i)*.7,y:300+(p.x-100)*Math.sin(rotation)+(p.y-100)*Math.cos(rotation)+Math.cos(i)*.7}));
      const points=[...loop.slice(start),...loop.slice(0,start)];if(reverse)points.reverse();points.push(points[0]);
      const result=recognize(emptySketch(),[{id:'ring',points}]);
      expect(result.kind).toBe('ring');expect(result.sketch.atoms).toHaveLength(6);
      expect(result.sketch.bonds.filter(b=>b.order===2)).toHaveLength(3);
    }
  });
  it('replaces a vertex with N without adding extra atoms or bonds', () => {
    const sketch = addRing(emptySketch(), {x:100,y:100}, 60, 6, 0);
    const n = [{x:149,y:111},{x:149,y:89},{x:171,y:111},{x:171,y:89}];
    const result = recognize(sketch,[{id:'n',points:dense(n)}]);
    expect(result.kind).toBe('atom');
    expect(result.sketch.atoms).toHaveLength(6);
    expect(result.sketch.bonds).toHaveLength(6);
    expect(result.sketch.atoms.filter(a=>a.element==='N')).toHaveLength(1);
    expect(result.sketch.atoms.find(a=>a.element==='N')?.id).toBe(sketch.atoms[0].id);
  });
  it('erases only one stroke of a double bond and keeps the ring connected', () => {
    const sketch = addRing(emptySketch(), {x:100,y:100}, 60, 6, 0);
    const line = bondLines(sketch).find(l=>l.index===1)!;
    const result=erase(sketch,dense([line.from,line.to]),3);
    expect(result.bonds).toHaveLength(6);
    expect(result.atoms).toHaveLength(6);
    expect(result.bonds.filter(b=>b.order===2)).toHaveLength(2);
  });
  it('does not aromatize a ring again after all double strokes are erased', () => {
    let sketch=addRing(emptySketch(),{x:100,y:100},60,6,0);
    for(let i=0;i<3;i++) {
      const line=bondLines(sketch).find(l=>l.index===1)!;
      sketch=erase(sketch,dense([line.from,line.to]),3);
    }
    expect(sketch.bonds.map(b=>b.order)).toEqual([1,1,1,1,1,1]);
  });
  it('erases an atom label back to implicit carbon while retaining bonds', () => {
    const sketch=addRing(emptySketch(),{x:100,y:100},60,6,0);
    sketch.atoms[0].element='N';
    const result=erase(sketch,[{x:160,y:100}],10);
    expect(result.atoms[0].element).toBe('C');
    expect(result.bonds).toHaveLength(6);
  });
  it('converts a tiny mark to one carbon atom', () => {
    const result=recognize(emptySketch(),[{id:'doodle',points:dense([{x:100,y:100},{x:102,y:100}])}]);
    expect(result.kind).toBe('atom');
    expect(result.recognized).toBe(true);
    expect(result.sketch.atoms.map(a=>a.element)).toEqual(['C']);
    expect(result.sketch.bonds).toHaveLength(0);
    expect(result.sketch.ink).toHaveLength(0);
  });
  it('converts partial N strokes immediately and recognizes the completed group from its original graph',()=>{
    const sketch=addRing(emptySketch(),{x:100,y:100},60,6,0);
    const partial=[{id:'left',points:dense([{x:147,y:87},{x:147,y:113}])},{id:'diagonal',points:dense([{x:147,y:87},{x:173,y:113}])}];
    const result=recognize(sketch,partial);
    expect(result.kind).not.toBe('ink');
    expect(result.recognized).toBe(true);
    expect(result.sketch.ink).toHaveLength(0);
    const completed=recognize(sketch,[...partial,{id:'right',points:dense([{x:173,y:87},{x:173,y:113}])}]);
    expect(completed.kind).toBe('atom');
    expect(completed.sketch.atoms).toHaveLength(6);
    expect(completed.sketch.bonds).toEqual(sketch.bonds);
    expect(completed.sketch.atoms.filter(a=>a.element==='N')).toHaveLength(1);
  });
  it('treats an empty stroke batch as a no-op without saving empty ink',()=>{
    const sketch=addRing(emptySketch(),{x:100,y:100},60,6,0);
    for(const strokes of [[],[{id:'empty',points:[]}]] ) {
      const result=recognize(sketch,strokes);
      expect(result.sketch).toBe(sketch);
      expect(result.recognized).toBe(false);
      expect(result.label).toBe('');
      expect(result.kind).not.toBe('ink');
    }
  });
  it('represents a one-point stroke as a carbon without duplicating a nearby atom',()=>{
    const point={x:100,y:100};
    const first=recognize(emptySketch(),[{id:'point',points:[point]}]);
    expect(first.kind).toBe('atom');
    expect(first.sketch.atoms.map(a=>a.element)).toEqual(['C']);
    expect(first.sketch.ink).toHaveLength(0);
    first.sketch.atoms[0].element='N';
    const second=recognize(first.sketch,[{id:'point-again',points:[{x:102,y:101}]}]);
    expect(second.sketch.atoms).toEqual(first.sketch.atoms);
    expect(second.sketch.bonds).toHaveLength(0);
    expect(second.sketch.ink).toHaveLength(0);
  });
  it('erases standalone atoms completely instead of leaving an invisible carbon',()=>{
    for(const element of ['C','N','O']){
      const sketch={...emptySketch(),atoms:[{id:'alone',x:100,y:100,element}]};
      expect(erase(sketch,[{x:100,y:100}],8).atoms).toHaveLength(0);
    }
  });
});
