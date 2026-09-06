import { describe,it,expect } from 'vitest';
import { parseSketch } from './storage';
describe('native documents',()=>{
  it('rejects broken bond references instead of loading a corrupt structure',()=>{
    expect(()=>parseSketch(JSON.stringify({version:1,title:'x',atoms:[],bonds:[{id:'b',a:'absent',b:'missing',order:1}],ink:[]}))).toThrow();
  });
  it('rejects unknown document versions',()=>{
    expect(()=>parseSketch(JSON.stringify({version:9,title:'x',atoms:[],bonds:[],ink:[]}))).toThrow();
  });
  it('preserves atom identity, charge, coordinates and raw handwriting',()=>{
    const doc={version:1,title:'実験',atoms:[{id:'n1',x:10,y:25,element:'N',charge:1}],bonds:[],ink:[{id:'p1',points:[{x:1,y:2},{x:3,y:4}]}]};
    expect(parseSketch(JSON.stringify(doc))).toEqual(doc);
  });
});
