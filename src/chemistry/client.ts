import type { Sketch } from '../core/types';
import type { ChemicalFormat } from './engine';
export type { ChemicalFormat } from './engine';
type Analysis={smiles:string;formula:string;mass:string;issues:string[]};
type Pending={resolve:(value:unknown)=>void;reject:(reason:Error)=>void;timer:ReturnType<typeof setTimeout>};
let worker:Worker|undefined;let serial=0;const pending=new Map<number,Pending>();
function reset(reason:Error){worker?.terminate();worker=undefined;for(const p of pending.values()){clearTimeout(p.timer);p.reject(reason)}pending.clear()}
function request<T>(operation:string,payload:unknown):Promise<T>{return new Promise((resolve,reject)=>{
 try{if(!worker){worker=new Worker(new URL('../workers/chemistry.worker.ts',import.meta.url),{type:'module'});worker.onmessage=({data})=>{const p=pending.get(data.id);if(!p)return;clearTimeout(p.timer);pending.delete(data.id);if(data.error)p.reject(new Error(data.error));else p.resolve(data.result)};worker.onerror=(event)=>{event.preventDefault();reset(new Error(event.message||'化学エンジンを起動できませんでした。'))};worker.onmessageerror=()=>reset(new Error('化学エンジンの応答を読み込めませんでした。'))}
 const id=++serial;const timer=setTimeout(()=>reset(new Error('化学処理がタイムアウトしました。もう一度お試しください。')),45_000);pending.set(id,{resolve:resolve as (value:unknown)=>void,reject,timer});worker.postMessage({id,operation,payload});
 }catch(error){reset(error instanceof Error?error:new Error(String(error)));reject(error)}
})}
export const chemistry={
 clean:(sketch:Sketch)=>request<Sketch>('clean',{sketch}),
 convert:(sketch:Sketch,format:ChemicalFormat)=>request<string|Uint8Array>('convert',{sketch,format}),
 parse:(input:string|Uint8Array,format?:string)=>request<Sketch>('parse',{input,format}),
 analyze:(sketch:Sketch)=>request<Analysis>('analyze',{sketch}),
 dispose:()=>reset(new Error('化学エンジンを終了しました。')),
};
