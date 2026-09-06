import {useEffect,useRef,useState} from 'react';
import {chemistry} from './chemistry/client';
import type {Sketch} from './core/types';

const graphKey=(sketch:Sketch)=>JSON.stringify([sketch.atoms,sketch.bonds]);
function components(sketch:Sketch):Sketch[]{
  const unseen=new Set(sketch.atoms.map(a=>a.id)),parts:Sketch[]=[];
  while(unseen.size){
    const ids=new Set<string>(),queue=[unseen.values().next().value!];
    for(let i=0;i<queue.length;i++){
      const id=queue[i];if(!unseen.delete(id))continue;ids.add(id);
      for(const b of sketch.bonds){if(b.a===id&&unseen.has(b.b))queue.push(b.b);if(b.b===id&&unseen.has(b.a))queue.push(b.a);}
    }
    parts.push({...sketch,atoms:sketch.atoms.filter(a=>ids.has(a.id)),bonds:sketch.bonds.filter(b=>ids.has(b.a)),ink:[]});
  }
  return parts;
}

/** Beautification is a coordinate update in the same edit, never a new user action. */
export function useChemicalNormalization(sketch:Sketch,isBusy:()=>boolean,apply:(before:Sketch,after:Sketch)=>Sketch|null,onError:(message:string)=>void){
  const [formatting,setFormatting]=useState(false);
  const handled=useRef(new WeakSet<Sketch>()),knownComponents=useRef(new Set<string>());
  useEffect(()=>{
    if(!sketch.atoms.length||handled.current.has(sketch)){setFormatting(false);return;}
    const dirty=components(sketch).filter(part=>part.bonds.length&&!knownComponents.current.has(graphKey(part)));
    if(!dirty.length){handled.current.add(sketch);setFormatting(false);return;}
    let cancelled=false,timer:ReturnType<typeof setTimeout>|undefined;
    setFormatting(true);
    function accept(after:Sketch){
      if(cancelled)return;
      if(isBusy()){timer=setTimeout(()=>accept(after),80);return;}
      // Even identical coordinates finish the input group. Otherwise a later
      // retrace can merge its Undo into the stroke that created the molecule.
      const committed=apply(sketch,after);
      if(committed){handled.current.add(sketch);handled.current.add(committed);for(const part of components(committed))knownComponents.current.add(graphKey(part));}
      setFormatting(false);
    }
    async function run(){
      if(cancelled)return;
      if(isBusy()){timer=setTimeout(run,80);return;}
      try{
        const partial={...sketch,atoms:dirty.flatMap(p=>p.atoms),bonds:dirty.flatMap(p=>p.bonds),ink:[]};
        const laidOut=await chemistry.clean(partial);if(cancelled)return;
        const positions=new Map(laidOut.atoms.map(a=>[a.id,a]));
        accept({...sketch,atoms:sketch.atoms.map(a=>{const p=positions.get(a.id);return p?{...a,x:p.x,y:p.y}:a;})});
      }catch(error){if(!cancelled){handled.current.add(sketch);setFormatting(false);onError(error instanceof Error?error.message:'構造式を整形できませんでした。');}}
    }
    timer=setTimeout(run,100);
    return()=>{cancelled=true;if(timer)clearTimeout(timer);};
  },[sketch,isBusy,apply,onError]);
  return formatting;
}
