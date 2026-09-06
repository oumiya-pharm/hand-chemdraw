import { beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import createIndigo from 'indigo-ketcher/binaryWasm';
import { createEngine, type Indigo } from '../src/chemistry/engine';
import { emptySketch, type Sketch } from '../src/core/types';

let indigo: Indigo;
let engine: ReturnType<typeof createEngine>;
beforeAll(async () => {
  indigo = await createIndigo({ wasmBinary: fs.readFileSync('node_modules/indigo-ketcher/indigo-ketcher-1.46.0.wasm') }) as Indigo;
  engine = createEngine(indigo);
});

const chain = (): Sketch => ({
  version: 1, title: 'rough chain', ink: [{ id: 'note', points: [{ x: 90, y: 70 }] }],
  atoms: [[100, 110], [140, 100], [190, 95], [250, 125], [280, 110], [360, 130], [425, 145]].map(([x, y], i) => ({ id: `a${i}`, element: 'C', x, y })),
  bonds: Array.from({ length: 6 }, (_, i) => ({ id: `b${i}`, a: `a${i}`, b: `a${i + 1}`, order: 1 })),
});
function lengths(sketch: Sketch) {
  const atoms = new Map(sketch.atoms.map(a => [a.id, a]));
  return sketch.bonds.map(b => Math.hypot(atoms.get(b.a)!.x - atoms.get(b.b)!.x, atoms.get(b.a)!.y - atoms.get(b.b)!.y));
}
function center(sketch: Sketch) {
  return { x: sketch.atoms.reduce((n, a) => n + a.x, 0) / sketch.atoms.length, y: sketch.atoms.reduce((n, a) => n + a.y, 0) / sketch.atoms.length };
}
function metadata(sketch: Sketch) {
  return { ...sketch, atoms: sketch.atoms.map(({ x: _x, y: _y, ...atom }) => atom) };
}
function ring(size: number, radius: number, x: number, y: number, prefix: string): Sketch {
  return {
    ...emptySketch(),
    atoms: Array.from({ length: size }, (_, i) => ({ id: `${prefix}a${i}`, element: 'C', x: x + radius * Math.cos(i * 2 * Math.PI / size), y: y + radius * Math.sin(i * 2 * Math.PI / size) })),
    bonds: Array.from({ length: size }, (_, i) => ({ id: `${prefix}b${i}`, a: `${prefix}a${i}`, b: `${prefix}a${(i + 1) % size}`, order: size === 6 && i % 2 === 0 ? 2 : 1 })),
  };
}

describe('real local coordinate cleanup', () => {
  it('turns an uneven chain into equal-length 120-degree zigzags without changing its graph', () => {
    const input = chain();
    const snapshot = structuredClone(input);
    const cleaned = engine.clean(input);
    expect(input).toEqual(snapshot);
    expect(metadata(cleaned)).toEqual(metadata(input));
    const bonds = lengths(cleaned);
    expect(Math.max(...bonds) - Math.min(...bonds)).toBeLessThan(0.01);
    for (const length of bonds) expect(length).toBeCloseTo(60, 3);
    for (let i = 1; i < cleaned.atoms.length - 1; i++) {
      const [a, b, c] = cleaned.atoms.slice(i - 1, i + 2);
      const cosine = ((a.x - b.x) * (c.x - b.x) + (a.y - b.y) * (c.y - b.y)) / (bonds[i - 1] * bonds[i]);
      expect(cosine).toBeCloseTo(-0.5, 4);
    }
    expect(center(cleaned).x).toBeCloseTo(center(input).x, 6);
    expect(center(cleaned).y).toBeCloseTo(center(input).y, 6);
    expect(cleaned.atoms.at(-1)!.x).toBeGreaterThan(cleaned.atoms[0].x);
    expect(engine.analyze(cleaned).formula.replaceAll(' ', '')).toBe('C7H16');
  });

  it('lays out a fully overlapping ring as a regular hexagon', () => {
    const input: Sketch = { ...emptySketch(), atoms: Array.from({ length: 6 }, (_, i) => ({ id: `r${i}`, element: 'C', x: 220, y: 180 })), bonds: Array.from({ length: 6 }, (_, i) => ({ id: `rb${i}`, a: `r${i}`, b: `r${(i + 1) % 6}`, order: i % 2 ? 1 : 2 })) };
    const cleaned = engine.clean(input);
    expect(metadata(cleaned)).toEqual(metadata(input));
    for (const length of lengths(cleaned)) expect(length).toBeCloseTo(60, 3);
    for (const a of cleaned.atoms) expect(Math.hypot(a.x - 220, a.y - 180)).toBeCloseTo(60, 3);
    expect(engine.analyze(cleaned).formula.replaceAll(' ', '')).toBe('C6H6');
  });

  it('gives differently sized regular benzenes the same diameter without moving their centers', () => {
    const small = ring(6, 28, 220, 180, 'small');
    const large = ring(6, 100, 560, 380, 'large');
    const input = { ...small, atoms: [...small.atoms, ...large.atoms], bonds: [...small.bonds, ...large.bonds] };
    const cleaned = engine.clean(input);
    expect(metadata(cleaned)).toEqual(metadata(input));
    for (const original of [small, large]) {
      const ids = new Set(original.atoms.map(a => a.id));
      const result = { ...cleaned, atoms: cleaned.atoms.filter(a => ids.has(a.id)), bonds: cleaned.bonds.filter(b => ids.has(b.a)) };
      const originalCenter = center(original);
      expect(center(result).x).toBeCloseTo(originalCenter.x, 6);
      expect(center(result).y).toBeCloseTo(originalCenter.y, 6);
      for (const a of result.atoms) expect(Math.hypot(a.x - originalCenter.x, a.y - originalCenter.y)).toBeCloseTo(60, 3);
      for (const length of lengths(result)) expect(length).toBeCloseTo(60, 3);
    }
    expect(engine.clean(cleaned)).toEqual(cleaned);
  });

  for (const size of [3, 4, 5, 7, 8]) it(`uses the same bond length for a ${size}-membered ring as for benzene and chains`, () => {
    const input = ring(size, 100, 220, 180, `ring${size}`);
    const cleaned = engine.clean(input);
    for (const length of lengths(cleaned)) expect(length).toBeCloseTo(60, 3);
    expect(center(cleaned).x).toBeCloseTo(220, 6);
    expect(center(cleaned).y).toBeCloseTo(180, 6);
    expect(metadata(cleaned)).toEqual(metadata(input));
    expect(engine.clean(cleaned)).toEqual(cleaned);
  });

  it('normalizes a nearly standard ring instead of retaining a different size within the snapping tolerance', () => {
    const cleaned = engine.clean(ring(6, 60.3, 220, 180, 'near'));
    for (const length of lengths(cleaned)) expect(length).toBeCloseTo(60, 3);
    expect(engine.clean(cleaned)).toEqual(cleaned);
  });

  it('preserves exact vertices once a ring has the standard size', () => {
    const input = ring(6, 60, 220, 180, 'standard');
    expect(engine.clean(input)).toEqual(input);
  });

  it('scales an open half-hexagon while retaining its center and conformation', () => {
    const input: Sketch = { ...emptySketch(), atoms: [[500, 280], [450, 367], [350, 367], [300, 280]].map(([x, y], i) => ({ id: `h${i}`, element: 'C', x, y })), bonds: Array.from({ length: 3 }, (_, i) => ({ id: `hb${i}`, a: `h${i}`, b: `h${i + 1}`, order: 1 })) };
    const cleaned = engine.clean(input);
    for (const length of lengths(cleaned)) expect(length).toBeCloseTo(60, 3);
    expect(center(cleaned).x).toBeCloseTo(center(input).x, 6);
    expect(center(cleaned).y).toBeCloseTo(center(input).y, 6);
    expect(cleaned.atoms[0].x).toBeGreaterThan(cleaned.atoms[3].x);
    expect(cleaned.atoms[1].y).toBeGreaterThan(cleaned.atoms[0].y);
    expect(cleaned.atoms[2].y).toBeGreaterThan(cleaned.atoms[3].y);
    expect(metadata(cleaned)).toEqual(metadata(input));
    expect(engine.clean(cleaned)).toEqual(cleaned);
  });

  it('regularizes a rough half-hexagon at the shared scale while preserving its signed turns', () => {
    const input: Sketch = { ...emptySketch(), atoms: [[500, 280], [447, 365], [349, 374], [300, 283]].map(([x, y], i) => ({ id: `h${i}`, element: 'C', x, y })), bonds: Array.from({ length: 3 }, (_, i) => ({ id: `hb${i}`, a: `h${i}`, b: `h${i + 1}`, order: 1 })) };
    const cleaned = engine.clean(input);
    const bonds = lengths(cleaned);
    expect(Math.max(...bonds) - Math.min(...bonds)).toBeLessThan(0.01);
    for (let i = 1; i < cleaned.atoms.length - 1; i++) {
      const [a, b, c] = cleaned.atoms.slice(i - 1, i + 2);
      const turn = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
      expect(turn).toBeGreaterThan(0);
      const cosine = ((a.x - b.x) * (c.x - b.x) + (a.y - b.y) * (c.y - b.y)) / (bonds[i - 1] * bonds[i]);
      expect(cosine).toBeCloseTo(-0.5, 4);
    }
    for (const length of bonds) expect(length).toBeCloseTo(60, 3);
    expect(center(cleaned).x).toBeCloseTo(center(input).x, 6);
    expect(center(cleaned).y).toBeCloseTo(center(input).y, 6);
    expect(metadata(cleaned)).toEqual(metadata(input));
    expect(engine.clean(cleaned)).toEqual(cleaned);
  });

  for (const format of ['mol-v2000', 'mol-v3000', 'ket'] as const) it(`normalizes existing coordinates imported from ${format}`, () => {
    const original = ring(6, 100, 220, 180, 'import');
    const imported = engine.parse(engine.convert(original, format), format);
    const cleaned = engine.clean(imported);
    for (const length of lengths(cleaned)) expect(length).toBeCloseTo(60, 3);
    expect(center(cleaned).x).toBeCloseTo(center(imported).x, 6);
    expect(center(cleaned).y).toBeCloseTo(center(imported).y, 6);
    expect(metadata(cleaned)).toEqual(metadata(imported));
    expect(engine.convert(cleaned, 'inchi')).toBe(engine.convert(original, 'inchi'));
    expect(engine.clean(cleaned)).toEqual(cleaned);
  });

  it('preserves disconnected component centers and isolated atom locations', () => {
    const first = chain();
    const second = chain();
    second.atoms = second.atoms.map(a => ({ ...a, id: `other-${a.id}`, x: a.x + 400, y: a.y + 350 }));
    second.bonds = second.bonds.map(b => ({ ...b, id: `other-${b.id}`, a: `other-${b.a}`, b: `other-${b.b}` }));
    const ion = { id: 'ion', element: 'Na', charge: 1, x: 70, y: 730 };
    const input = { ...first, atoms: [...first.atoms, ...second.atoms, ion], bonds: [...first.bonds, ...second.bonds] };
    const cleaned = engine.clean(input);
    for (const component of [first, second]) {
      const ids = new Set(component.atoms.map(a => a.id));
      const positioned = { ...cleaned, atoms: cleaned.atoms.filter(a => ids.has(a.id)) };
      expect(center(positioned).x).toBeCloseTo(center(component).x, 6);
      expect(center(positioned).y).toBeCloseTo(center(component).y, 6);
    }
    expect(cleaned.atoms.find(a => a.id === 'ion')).toEqual(ion);
  });

  for (const smiles of ['[13CH3][C@H](O)[NH3+]', 'F[C@](Cl)(Br)I', 'N[C@@H](C)C(=O)O', 'C[C@H](O)[C@@H](N)C(=O)O', 'F/C=C/F', 'F/C=C\\F']) {
    it(`preserves atom/bond metadata, formula and absolute stereochemistry of ${smiles}`, () => {
      const input = engine.parse(smiles);
      // Positive affine distortion keeps the asserted stereochemistry but makes
      // bond lengths visibly uneven so that a coordinate no-op cannot pass.
      input.atoms = input.atoms.map(a => ({ ...a, x: a.x * 1.7 + a.y * 0.3, y: a.y * 0.8 }));
      const cleaned = engine.clean(input);
      expect(metadata(cleaned)).toEqual(metadata(input));
      expect(engine.convert(cleaned, 'inchi')).toBe(engine.convert(input, 'inchi'));
      expect(engine.analyze(cleaned).formula).toBe(engine.analyze(input).formula);
      expect(Math.max(...lengths(cleaned)) - Math.min(...lengths(cleaned))).toBeLessThan(0.01);
      for (const length of lengths(cleaned)) expect(length).toBeCloseTo(60, 2);
    });
  }

  it('does not depend on the atom order of the layout response', () => {
    // Reorder the real WASM response at the serialization boundary. The graph
    // and actual computed geometry are unchanged; only its array order differs.
    const reorderingEngine = createEngine({
      MapStringString: indigo.MapStringString, VectorInt: indigo.VectorInt,
      convert: indigo.convert.bind(indigo), dearomatize: indigo.dearomatize.bind(indigo),
      calculate: indigo.calculate.bind(indigo), check: indigo.check.bind(indigo),
      layout(input, format, options) {
        const ket = JSON.parse(indigo.layout(input, format, options));
        for (const ref of ket.root.nodes) {
          const node = ket[ref.$ref];
          node.atoms.reverse();
          for (const bond of node.bonds) bond.atoms = bond.atoms.map((i: number) => node.atoms.length - 1 - i);
        }
        return JSON.stringify(ket);
      },
    });
    const input = chain();
    const normal = engine.clean(input);
    const reordered = reorderingEngine.clean(input);
    expect(reordered).toEqual(normal);
  });

  for (const smiles of ['F[C@](Cl)(Br)I', 'C[C@H](O)[C@@H](N)C(=O)O', 'O[C@H]1[C@@H](O)[C@H](O)[C@@H](O)[C@H](CO)O1', 'C[C@H]1CCCC[C@@H]1O']) {
    for (const reversed of [false, true]) it(`preserves stereo with reordered source records: ${smiles}, reversed=${reversed}`, () => {
      const input = engine.parse(smiles);
      input.atoms = [...input.atoms.slice(2), ...input.atoms.slice(0, 2)].map(a => ({ ...a, x: a.x + 0.3 * a.y, y: a.y * 0.65 }));
      input.bonds = [...input.bonds.slice(2), ...input.bonds.slice(0, 2)];
      if (reversed) input.atoms.reverse();
      const before = engine.convert(input, 'inchi');
      const cleaned = engine.clean(input);
      expect(metadata(cleaned)).toEqual(metadata(input));
      expect(engine.convert(cleaned, 'inchi')).toBe(before);
      expect(Math.max(...lengths(cleaned)) - Math.min(...lengths(cleaned))).toBeLessThan(0.01);
    });
  }

  it('leaves an empty sketch intact', () => {
    expect(engine.clean(emptySketch())).toEqual(emptySketch());
  });
});
