import { describe, expect, it, beforeAll } from 'vitest';
import fs from 'node:fs';
import createIndigo from 'indigo-ketcher/binaryWasm';
import { createEngine, sketchToMol, type Indigo } from '../src/chemistry/engine';
import type { Sketch } from '../src/core/types';
const ring = (nitrogen = false): Sketch => ({version:1,title:'ring',ink:[],atoms:Array.from({length:6},(_,i)=>({id:`a${i}`,x:200+50*Math.cos(i*Math.PI/3),y:200+50*Math.sin(i*Math.PI/3),element:nitrogen&&i===0?'N':'C'})),bonds:Array.from({length:6},(_,i)=>({id:`b${i}`,a:`a${i}`,b:`a${(i+1)%6}`,order:i%2?1:2}))});
let engine: ReturnType<typeof createEngine>;
beforeAll(async()=>{engine=createEngine(await createIndigo({wasmBinary:fs.readFileSync('node_modules/indigo-ketcher/indigo-ketcher-1.46.0.wasm')}) as Indigo)});
describe('real local Indigo',()=>{
 it('calculates benzene and pyridine from explicit bond graphs',()=>{expect(engine.analyze(ring()).formula.replace(/ /g,'')).toBe('C6H6');expect(engine.analyze(ring(true)).formula.replace(/ /g,'')).toBe('C5H5N')});
 it('rejects dangling bond references',()=>{const s=ring();s.bonds[0].a='missing';expect(()=>sketchToMol(s)).toThrow()});
 it('kekulizes imported aromatics and respects later erased double bonds',()=>{const s=engine.parse('c1ccccc1');expect(s.bonds.filter(b=>b.order===2)).toHaveLength(3);s.bonds.find(b=>b.order===2)!.order=1;expect(engine.analyze(s).formula.replace(/ /g,'')).toBe('C6H8')});
 for(const format of ['smiles','mol-v2000','mol-v3000','sdf-v2000','sdf-v3000','cdxml','cdx','inchi','cml','ket'] as const)it(`roundtrips ${format}`,()=>{const data=engine.convert(ring(true),format);const restored=engine.parse(data,format);expect(restored.atoms).toHaveLength(6);expect(engine.analyze(restored).formula.replace(/ /g,'')).toBe('C5H5N');if(format==='cdx')expect(new TextDecoder().decode((data as Uint8Array).slice(0,8))).toBe('VjCD0100');if(format.includes('3000'))expect(data).toContain('V3000');if(format.startsWith('sdf'))expect(data).toContain('$$$$')});
 for(const format of ['smiles','mol-v2000','mol-v3000','sdf-v2000','sdf-v3000','cdxml','cdx','inchi','cml','ket'] as const)it(`roundtrips isotope and charge in ${format}`,()=>{const s=engine.parse('[13CH3][NH3+]');const restored=engine.parse(engine.convert(s,format),format);expect(restored.atoms.some(a=>a.isotope===13)).toBe(true);expect(restored.atoms.some(a=>a.charge===1)).toBe(true)});
 it('retains isotope, charge and stereochemistry through MOL',()=>{const s=engine.parse('[13CH3][C@H](O)[NH3+]');expect(s.atoms.some(a=>a.isotope===13)).toBe(true);expect(s.atoms.some(a=>a.charge===1)).toBe(true);expect(s.bonds.some(b=>b.stereo==='up'||b.stereo==='down')).toBe(true);const out=engine.convert(s,'smiles') as string;expect(out).toContain('13');expect(out).toContain('@');expect(out).toContain('+')});
 it('refuses an import whose explicit hydrogen state cannot be preserved',()=>{expect(()=>engine.parse('[C]')).toThrow('正確に保持')});
 it('retains pyrrole hydrogen and alkene geometry',()=>{expect(engine.analyze(engine.parse('c1cc[nH]c1')).formula.replace(/ /g,'')).toBe('C4H5N');expect(engine.convert(engine.parse('F/C=C/F'),'smiles')).toMatch(/[\\/]/)});
 it('exports InChIKey as an identifier and refuses to import it',()=>{expect(engine.convert(ring(),'inchi-key')).toMatch(/^[A-Z]{14}-[A-Z]{10}-[A-Z]$/);expect(()=>engine.parse('UHOVQNZJYSORNB-UHFFFAOYSA-N','inchi-key')).toThrow()});
});

describe('absolute tetrahedral stereo',()=>{
 it('preserves absolute configuration in KET, InChI and MOL roundtrip',()=>{
  const sketch=engine.parse('F[C@](Cl)(Br)I');
  const ket=JSON.parse(engine.convert(sketch,'ket') as string);
  expect(ket.mol0.atoms.find((a:{stereoLabel?:string})=>a.stereoLabel)?.stereoLabel).toBe('abs');
  expect(engine.convert(sketch,'inchi')).toContain('/s1');
  for(const format of ['mol-v2000','mol-v3000'] as const){
   const restored=engine.parse(engine.convert(sketch,format),format);
   expect(engine.convert(restored,'smiles')).toContain('@');
   expect(engine.convert(restored,'inchi')).toBe(engine.convert(sketch,'inchi'));
  }
 });
 it('leaves an unspecified tetrahedral center unspecified',()=>{
  const sketch=engine.parse('FC(Cl)(Br)I');
  expect(engine.convert(sketch,'smiles')).not.toContain('@');
  expect(engine.convert(sketch,'inchi')).not.toContain('/s1');
 });
});

describe('unsupported atom metadata',()=>{
 it('rejects atom mapping before projecting through MOL',()=>{expect(()=>engine.parse('[CH3:1][OH:2]')).toThrow('原子マッピング')});
 it('rejects atom aliases before projecting through MOL',()=>{expect(()=>engine.parse('C |$foo$|')).toThrow('原子エイリアス')});
});
