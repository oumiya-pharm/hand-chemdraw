import createIndigo from 'indigo-ketcher/binaryWasm';
import wasmUrl from '../../node_modules/indigo-ketcher/indigo-ketcher-1.46.0.wasm?url';
import { createEngine, type ChemicalFormat } from '../chemistry/engine';
import type { Sketch } from '../core/types';
// Vite emits a hashed same-origin WASM asset; no remote service or CDN.
const engine=createIndigo({locateFile:()=>wasmUrl}).then(createEngine);
// Attach immediately, including initialization failures before the first request.
engine.catch(()=>{});
self.onmessage=async({data}:{data:{id:number;operation:string;payload:{sketch:Sketch;format:ChemicalFormat;input:string|Uint8Array}}})=>{
 try{const api=await engine;const {operation,payload}=data;const result=operation==='clean'?api.clean(payload.sketch):operation==='convert'?api.convert(payload.sketch,payload.format):operation==='parse'?api.parse(payload.input,payload.format):operation==='analyze'?api.analyze(payload.sketch):(()=>{throw new Error('不明な化学処理です。')})();self.postMessage({id:data.id,result})}
 catch(error){self.postMessage({id:data.id,error:error instanceof Error?error.message:String(error)})}
};
