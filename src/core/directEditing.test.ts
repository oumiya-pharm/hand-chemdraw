import {describe,it,expect} from 'vitest';
import {paintAtom,eraseRectangle} from './directEditing';
import {addRing} from './editor';
import {emptySketch} from './types';
import {repairValence} from './valence';

describe('selected element ink',()=>{
  it('replaces one touched vertex with the selected element, regardless of stroke shape',()=>{
    const before=addRing(emptySketch(),{x:200,y:200},60,6,0),a=before.atoms[0];
    const after=paintAtom(before,[{x:a.x-12,y:a.y-6},{x:a.x+14,y:a.y+5}], 'N',18);
    expect(after.atoms.map(a=>a.element)).toEqual(['N','C','C','C','C','C']);
    expect(after.bonds).toEqual(before.bonds);expect(after.ink).toEqual([]);
    expect(before.atoms[0].element).toBe('C');
  });
  it('uses the whole path even when a sparse event segment crosses the vertex',()=>{
    const before=addRing(emptySketch(),{x:200,y:200},60,6,0);
    const after=paintAtom(before,[{x:300,y:200},{x:220,y:200}], 'O',10);
    expect(after.atoms[0].element).toBe('O');expect(after.atoms).toHaveLength(6);
    const repaired=repairValence(before,after).sketch;
    expect(repaired.bonds.filter(b=>b.a===before.atoms[0].id||b.b===before.atoms[0].id).reduce((s,b)=>s+b.order,0)).toBe(2);
  });
  it('changes only the first nearby vertex when a trace crosses several',()=>{
    const before=addRing(emptySketch(),{x:200,y:200},60,6,0);
    const after=paintAtom(before,[before.atoms[0],before.atoms[3]],'N',18);
    expect(after.atoms.filter(a=>a.element==='N').map(a=>a.id)).toEqual([before.atoms[0].id]);
  });
  it('can place an atom on blank paper and paint it back to carbon with a click',()=>{
    const placed=paintAtom(emptySketch(),[{x:100,y:100}], 'Cl',18);
    expect(placed.atoms).toMatchObject([{x:100,y:100,element:'Cl'}]);
    const carbon=paintAtom(placed,[{x:100,y:100}],'C',18);
    expect(carbon.atoms).toMatchObject([{id:placed.atoms[0].id,element:'C'}]);
  });
  it('paints a charge onto the same element and the neutral choice removes it',()=>{
    const initial=paintAtom(emptySketch(),[{x:100,y:100}],'N',18);
    const ion=paintAtom(initial,[{x:100,y:100}],'N',18,1);
    expect(ion.atoms).toMatchObject([{id:initial.atoms[0].id,element:'N',charge:1}]);
    const neutral=paintAtom(ion,[{x:100,y:100}],'N',18,0);
    expect(neutral.atoms[0].charge).toBeUndefined();
    expect(initial.atoms[0].charge).toBeUndefined();
  });
  it('places a selected ion on blank paper and a neutral element replaces old charge',()=>{
    const ion=paintAtom(emptySketch(),[{x:100,y:100}],'O',18,-1);
    expect(ion.atoms[0]).toMatchObject({element:'O',charge:-1});
    expect(paintAtom(ion,[{x:100,y:100}],'N',18).atoms[0].charge).toBeUndefined();
  });
  it('ionizing imported OH re-evaluates its inherited hydrogen while keeping the oxygen isotope',()=>{
    const before={...emptySketch(),atoms:[{id:'o',x:100,y:100,element:'O',hydrogens:1,isotope:18},{id:'c',x:160,y:100,element:'C'}],bonds:[{id:'b',a:'o',b:'c',order:1 as const}]};
    const changed=paintAtom(before,[{x:100,y:100}],'O',18,-1);
    const after=repairValence(before,changed).sketch;
    expect(after.atoms[0]).toMatchObject({element:'O',charge:-1,isotope:18});
    expect(after.atoms[0].hydrogens).toBeUndefined();
    expect(after.bonds).toEqual(before.bonds);
  });
});

describe('rectangle eraser',()=>{
  it('erases an enclosed ring in either drag direction and preserves another molecule',()=>{
    const first=addRing(emptySketch(),{x:200,y:200},60,6,0);
    const before=addRing(first,{x:500,y:200},60,6,0);
    for(const [a,b] of [[{x:130,y:130},{x:270,y:270}],[{x:270,y:270},{x:130,y:130}]]){
      const after=eraseRectangle(before,a,b);
      expect(after.atoms).toEqual(before.atoms.slice(6));
      expect(after.bonds).toEqual(before.bonds.slice(6));
    }
    expect(before.atoms).toHaveLength(12);
  });
  it('removes all bonds incident to a selected vertex without deleting outside atoms',()=>{
    const before=addRing(emptySketch(),{x:200,y:200},60,6,0);
    const after=eraseRectangle(before,{x:255,y:190},{x:265,y:210});
    expect(after.atoms).toHaveLength(5);expect(after.bonds).toHaveLength(4);
    expect(after.bonds.every(b=>after.atoms.some(a=>a.id===b.a)&&after.atoms.some(a=>a.id===b.b))).toBe(true);
  });
  it('does nothing for empty rectangles, including a click',()=>{
    const before=addRing(emptySketch(),{x:200,y:200},60,6,0);
    expect(eraseRectangle(before,{x:300,y:300},{x:400,y:400})).toBe(before);
    expect(eraseRectangle(before,before.atoms[0],before.atoms[0])).toBe(before);
  });
});
