import { beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import createIndigo from 'indigo-ketcher/binaryWasm';
import { createEngine, type Indigo } from '../src/chemistry/engine';
import { repairValence } from '../src/core/valence';

let engine: ReturnType<typeof createEngine>;
beforeAll(async () => {
  engine = createEngine(await createIndigo({ wasmBinary: fs.readFileSync('node_modules/indigo-ketcher/indigo-ketcher-1.46.0.wasm') }) as Indigo);
});

describe('valence repairs checked by the local Indigo WASM engine', () => {
  it('restores acetone after an edit makes carbon bond-order sum five', () => {
    const before = engine.parse('CC(=O)C'), candidate = structuredClone(before);
    const center = candidate.atoms.find(a => candidate.bonds.filter(b => b.a === a.id || b.b === a.id).length === 3)!;
    candidate.bonds.find(b => b.order === 1 && (b.a === center.id || b.b === center.id))!.order = 2;
    const result = repairValence(before, candidate), analysis = engine.analyze(result.sketch);
    expect(result.sketch).toEqual(before);
    expect(analysis.formula.replaceAll(' ', '')).toBe('C3H6O');
    expect(analysis.issues).toEqual([]);
  });

  it('turns imported benzene C(H) into ring oxygen with two single bonds', () => {
    const before = engine.parse('c1ccccc1');
    before.atoms[0].hydrogens = 1;
    const candidate = structuredClone(before);
    candidate.atoms[0].element = 'O';
    const result = repairValence(before, candidate), analysis = engine.analyze(result.sketch);
    expect(result.sketch.bonds).toHaveLength(6);
    expect(result.sketch.bonds.filter(b => b.order === 2)).toHaveLength(2);
    expect(analysis.formula.replaceAll(' ', '')).toBe('C5H6O');
    expect(analysis.issues).toEqual([]);
  });

  it('turns imported benzene C(H) into pyridine N without inventing a positive charge', () => {
    const before = engine.parse('c1ccccc1');
    before.atoms[0].hydrogens = 1;
    const candidate = structuredClone(before);
    candidate.atoms[0].element = 'N';
    const result = repairValence(before, candidate), analysis = engine.analyze(result.sketch);
    expect(result.sketch.bonds).toEqual(before.bonds);
    expect(result.sketch.atoms[0].charge).toBeUndefined();
    expect(analysis.formula.replaceAll(' ', '')).toBe('C5H5N');
    expect(analysis.issues).toEqual([]);
  });

  it.each([
    'C[N+](C)(C)C', 'CC(=O)[O-]', 'C[O+](C)C', '[B-](F)(F)(F)F',
    'OP(=O)(O)O', 'CS(=O)(=O)C', 'C[S+](C)C', 'C[S+](=O)(C)C',
  ])('preserves engine-valid charged or hypervalent structure %s', smiles => {
    const before = engine.parse(smiles), result = repairValence(before, before);
    expect(result.sketch).toEqual(before);
    expect(result.messages).toEqual([]);
    expect(result.repaired).toBe(false);
    expect(engine.analyze(result.sketch).issues).toEqual([]);
  });

  it('preserves absolute stereo, isotopes, charges and hydrogen counts on unchanged input', () => {
    const before = engine.parse('[13CH3][C@H](O)[NH3+]');
    const result = repairValence(before, before);
    expect(result.sketch).toEqual(before);
    expect(engine.convert(result.sketch, 'inchi')).toEqual(engine.convert(before, 'inchi'));
    expect(engine.convert(result.sketch, 'smiles')).toContain('@');
    expect(engine.analyze(result.sketch).issues).toEqual([]);
  });

  it('keeps an erased benzene double bond erased through analysis', () => {
    const before = engine.parse('c1ccccc1'), candidate = structuredClone(before);
    candidate.bonds.find(b => b.order === 2)!.order = 1;
    const result = repairValence(before, candidate);
    expect(result.sketch).toEqual(candidate);
    expect(engine.analyze(result.sketch).formula.replaceAll(' ', '')).toBe('C6H8');
    expect(engine.analyze(result.sketch).issues).toEqual([]);
  });
});
