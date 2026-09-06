import { beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import createIndigo from 'indigo-ketcher/binaryWasm';
import { createEngine, sketchToMol, type Indigo } from '../src/chemistry/engine';
import { paintBond } from '../src/core/bondEditing';
import { emptySketch, type Sketch } from '../src/core/types';
import { repairValence } from '../src/core/valence';

let engine: ReturnType<typeof createEngine>;
beforeAll(async () => {
  engine = createEngine(await createIndigo({ wasmBinary: fs.readFileSync('node_modules/indigo-ketcher/indigo-ketcher-1.46.0.wasm') }) as Indigo);
});

function tetrahedron(): Sketch {
  return {
    ...emptySketch(),
    atoms: [
      { id: 'c', element: 'C', x: 0, y: 0 },
      { id: 'f', element: 'F', x: -60, y: 0 },
      { id: 'cl', element: 'Cl', x: 0, y: -60 },
      { id: 'br', element: 'Br', x: 60, y: 0 },
      { id: 'i', element: 'I', x: 0, y: 60 },
    ],
    bonds: ['f', 'cl', 'br', 'i'].map(b => ({ id: `c-${b}`, a: 'c', b, order: 1 })),
  };
}

describe('explicit bonds checked by the local Indigo WASM engine', () => {
  it.each([['single', 'C2H6'], ['double', 'C2H4'], ['triple', 'C2H2']] as const)('exports selected %s bonds with the correct formula', (kind, formula) => {
    const before = emptySketch(), candidate = paintBond(before, [{ x: 0, y: 0 }, { x: 60, y: 0 }], kind, 14);
    const accepted = repairValence(before, candidate).sketch;
    expect(engine.analyze(accepted).formula.replaceAll(' ', '')).toBe(formula);
    expect(engine.analyze(accepted).issues).toEqual([]);
    const clean = engine.clean(accepted);
    expect(clean.bonds).toEqual(accepted.bonds);
    expect(engine.convert(clean, 'smiles')).toBe(engine.convert(accepted, 'smiles'));
  });

  it.each(['up', 'down', 'either'] as const)('retains manually selected %s bonds through repair, clean and MOL export', kind => {
    const before = tetrahedron(), candidate = paintBond(before, [{ x: -30, y: 0 }], kind, 14);
    const accepted = repairValence(before, candidate).sketch;
    expect(accepted.bonds[0].stereo).toBe(kind);
    const mol = sketchToMol(accepted), clean = engine.clean(accepted);
    expect(mol).toContain(`M  V30 1 1 1 2 CFG=${kind === 'up' ? 1 : kind === 'down' ? 3 : 2}`);
    expect(clean.bonds).toEqual(accepted.bonds);
    expect(engine.analyze(clean).issues).toEqual([]);
    const smiles = engine.convert(clean, 'smiles');
    if (kind === 'either') expect(smiles).not.toContain('@');
    else expect(smiles).toContain('@');
    for (const format of ['mol-v2000', 'mol-v3000'] as const) {
      const restored = engine.parse(engine.convert(clean, format), format);
      expect(engine.convert(restored, 'inchi')).toBe(engine.convert(accepted, 'inchi'));
    }
  });

  it('creates a new stereobond at a real stereocenter and reverses configuration when up becomes down', () => {
    const before = tetrahedron(); before.bonds.shift();
    const path = [before.atoms[0], before.atoms[1]];
    const up = repairValence(before, paintBond(before, path, 'up', 14)).sketch;
    const down = repairValence(up, paintBond(up, path, 'down', 14)).sketch;
    expect(up.atoms).toHaveLength(5);
    expect(up.bonds).toHaveLength(4);
    expect(engine.convert(up, 'smiles')).toContain('@');
    expect(engine.convert(down, 'smiles')).toContain('@');
    expect(engine.convert(down, 'inchi')).not.toBe(engine.convert(up, 'inchi'));
    expect(engine.convert(engine.clean(up), 'inchi')).toBe(engine.convert(up, 'inchi'));
  });

  it.each(['up', 'down', 'either'] as const)('allows a %s drawing on a terminal nonstereogenic bond during editing', kind => {
    for (const smiles of ['CC', 'C1C=CC=C(O)C=1/N=N/CCC']) {
      const before = engine.parse(smiles), bond = before.bonds.at(-1)!;
      const a = before.atoms.find(atom => atom.id === bond.a)!, b = before.atoms.find(atom => atom.id === bond.b)!;
      const candidate = paintBond(before, [a, b], kind, 14), accepted = repairValence(before, candidate).sketch;
      expect(accepted.bonds.at(-1)!.stereo).toBe(kind);
      const clean = engine.clean(accepted);
      expect(clean.bonds).toEqual(accepted.bonds);
      expect(engine.analyze(clean).formula).toBe(engine.analyze(before).formula);
      expect(engine.analyze(clean).issues).toEqual([]);
      expect(engine.convert(clean, 'smiles')).toBe(engine.convert(before, 'smiles'));
      expect(engine.convert(clean, 'inchi')).toBe(engine.convert(before, 'inchi'));
      for (const format of ['mol-v2000', 'mol-v3000', 'cdxml'] as const) {
        const exported = engine.convert(clean, format), restored = engine.parse(exported, format);
        expect(restored.bonds.some(b => b.stereo === kind)).toBe(true);
        expect(engine.convert(restored, 'smiles')).toBe(engine.convert(before, 'smiles'));
      }
    }
  });

  it.each(['up', 'down', 'either'] as const)('preserves a genuine stereocenter alongside a nonstereogenic %s bond', kind => {
    const before = engine.parse('F[C@](Cl)(Br)CC'), terminal = before.bonds.at(-1)!;
    const path = [before.atoms.find(a => a.id === terminal.a)!, before.atoms.find(a => a.id === terminal.b)!];
    const candidate = paintBond(before, path, kind, 14), accepted = repairValence(before, candidate).sketch;
    const clean = engine.clean(accepted);
    expect(clean.bonds).toEqual(accepted.bonds);
    expect(engine.convert(clean, 'smiles')).toContain('@');
    expect(engine.convert(clean, 'inchi')).toBe(engine.convert(before, 'inchi'));
    for (const format of ['mol-v2000', 'mol-v3000', 'cdxml'] as const) {
      const restored = engine.parse(engine.convert(clean, format), format);
      expect(engine.convert(restored, 'inchi')).toBe(engine.convert(before, 'inchi'));
    }
  });

  it('keeps valence checking active while accepting drawing-only stereo marks', () => {
    const sketch = tetrahedron();
    sketch.atoms.push({ id: 'extra', element: 'C', x: 45, y: 45 });
    sketch.bonds.push({ id: 'fifth', a: 'c', b: 'extra', order: 1, stereo: 'up' });
    expect(engine.analyze(sketch).issues.join(' ')).toMatch(/valen/i);
  });

  it('turns an imported explicitly hydrogenated alcohol oxygen into an alkoxide without retaining its old H', () => {
    const before = engine.parse('CO'), oxygen = before.atoms.find(a => a.element === 'O')!;
    oxygen.hydrogens = 1;
    const candidate = structuredClone(before);
    candidate.atoms.find(a => a.id === oxygen.id)!.charge = -1;
    const accepted = repairValence(before, candidate).sketch;
    expect(engine.analyze(accepted).formula.replaceAll(' ', '')).toBe('CH3O');
    expect(engine.analyze(accepted).issues).toEqual([]);
    expect(engine.convert(accepted, 'smiles')).toContain('[O-]');
  });
});
