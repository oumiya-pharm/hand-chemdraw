import { afterEach, describe, expect, it, vi } from 'vitest';
import { chemistry } from './client';
import { emptySketch } from '../core/types';
class FakeWorker {
 static current:FakeWorker; onmessage:((event:{data:unknown})=>void)|undefined; onerror:((event:{preventDefault:()=>void;message:string})=>void)|undefined;
 posted:{id:number}[]=[];terminate=vi.fn();
 constructor(){FakeWorker.current=this}
 postMessage(data:{id:number}){this.posted.push(data)}
}
vi.stubGlobal('Worker',FakeWorker);
afterEach(()=>{chemistry.dispose();vi.useRealTimers()});
describe('worker lifecycle',()=>{
 it('matches out of order responses by request ID',async()=>{const a=chemistry.convert(emptySketch(),'smiles');const b=chemistry.convert(emptySketch(),'mol-v2000');const w=FakeWorker.current;w.onmessage!({data:{id:w.posted[1].id,result:'second'}});w.onmessage!({data:{id:w.posted[0].id,result:'first'}});expect(await a).toBe('first');expect(await b).toBe('second')});
 it('propagates initialization errors to all pending calls and allows restart',async()=>{const a=chemistry.analyze(emptySketch());const failed=expect(a).rejects.toThrow('startup failed');FakeWorker.current.onerror!({preventDefault(){},message:'startup failed'});await failed;expect(FakeWorker.current.terminate).toHaveBeenCalled()});
 it('terminates a stalled worker on timeout',async()=>{vi.useFakeTimers();const a=chemistry.analyze(emptySketch());const failed=expect(a).rejects.toThrow('タイムアウト');await vi.advanceTimersByTimeAsync(45_000);await failed;expect(FakeWorker.current.terminate).toHaveBeenCalled()});
 it('rejects outstanding work on disposal',async()=>{const a=chemistry.analyze(emptySketch());const failed=expect(a).rejects.toThrow('終了');chemistry.dispose();await failed});
});
