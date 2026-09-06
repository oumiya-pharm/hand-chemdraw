import { describe, expect, it } from 'vitest';
import { addRing, erase, recognize } from './editor';
import { bondLines } from './render';
import { emptySketch, type Point, type Sketch, type Stroke } from './types';

const sample = (vertices: Point[], wobble = 0): Point[] => vertices.flatMap((a, edge) => {
  const b = vertices[edge + 1];
  if (!b) return [a];
  const dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy);
  return Array.from({ length: 24 }, (_, i) => {
    const t = i / 24, offset = wobble * Math.sin(Math.PI * t) * Math.sin(5 * Math.PI * t + edge);
    return { x: a.x + dx * t - dy / length * offset, y: a.y + dy * t + dx / length * offset };
  });
});
const ink = (points: Point[], id = 'pen'): Stroke => ({ id, points });
const polygon = (size: number, radius = 100): Point[] => Array.from({ length: size + 1 }, (_, i) => ({
  x: 300 + radius * Math.cos(i * Math.PI * 2 / size), y: 300 + radius * Math.sin(i * Math.PI * 2 / size),
}));
const expectBenzene = (sketch: Sketch) => {
  expect(sketch.atoms).toHaveLength(6);
  expect(sketch.bonds).toHaveLength(6);
  expect(sketch.ink).toHaveLength(0);
  for (const atom of sketch.atoms) {
    const bonds = sketch.bonds.filter(b => b.a === atom.id || b.b === atom.id);
    expect(bonds.map(b => b.order).sort()).toEqual([1, 2]);
  }
};

describe('handwritten chemical shapes', () => {
  it('recognizes a large irregular six-sided loop with edge wobble', () => {
    const vertices = [{ x: 460, y: 240 }, { x: 390, y: 390 }, { x: 210, y: 370 }, { x: 130, y: 260 }, { x: 170, y: 110 }, { x: 340, y: 70 }, { x: 460, y: 240 }];
    const result = recognize(emptySketch(), [ink(sample(vertices, 11))]);
    expect(result.kind).toBe('ring');
    expectBenzene(result.sketch);
  });

  it('retains six corners under shear, an edge start, and reversed drawing direction', () => {
    const trace = sample(polygon(6), 3).slice(0, -1).map(p => ({ x: p.x * 1.5 + p.y * .4, y: p.y * .8 }));
    for (const start of [0, 11, 53]) for (const reverse of [false, true]) {
      const points = [...trace.slice(start), ...trace.slice(0, start)];
      if (reverse) points.reverse();
      points.push(points[0]);
      expectBenzene(recognize(emptySketch(), [ink(points)]).sketch);
    }
  });

  it('accepts a rounded, wobbly hexagonal loop with a modest closing gap', () => {
    const vertices = polygon(6).slice(0, -1);
    const rounded: Point[] = [];
    for (let i = 0; i < vertices.length; i++) {
      const a = vertices[(i + 5) % 6], b = vertices[i], c = vertices[(i + 1) % 6];
      const from = { x: a.x * .28 + b.x * .72, y: a.y * .28 + b.y * .72 };
      const to = { x: b.x * .72 + c.x * .28, y: b.y * .72 + c.y * .28 };
      for (let j = 0; j < 14; j++) {
        const t = j / 14;
        rounded.push({ x: (1 - t) ** 2 * from.x + 2 * t * (1 - t) * b.x + t ** 2 * to.x, y: (1 - t) ** 2 * from.y + 2 * t * (1 - t) * b.y + t ** 2 * to.y });
      }
      const nextFrom = { x: b.x * .28 + c.x * .72, y: b.y * .28 + c.y * .72 };
      rounded.push(...sample([to, nextFrom], 5).slice(0, -1));
    }
    const points = rounded.slice(9, -2);
    expectBenzene(recognize(emptySketch(), [ink(points)]).sketch);
  });

  it('uses a six-member ring for a large smooth loop while retaining small O labels', () => {
    const circle = (radius: number) => Array.from({ length: 100 }, (_, i) => {
      const angle = 2 * Math.PI * i / 99, r = radius * (1 + .035 * Math.sin(angle * 9));
      return { x: 200 + r * Math.cos(angle), y: 200 + r * Math.sin(angle) };
    });
    expectBenzene(recognize(emptySketch(), [ink(circle(90))]).sketch);
    const oxygen = recognize(emptySketch(), [ink(circle(12))]);
    expect(oxygen.kind).toBe('atom');
    expect(oxygen.sketch.atoms.map(a => a.element)).toEqual(['O']);
  });

  it('preserves clear triangles, squares, pentagons, and heptagons', () => {
    for (const size of [3, 4, 5, 7]) {
      const result = recognize(emptySketch(), [ink(sample(polygon(size), 2))]);
      expect(result.kind).toBe('ring');
      expect(result.sketch.atoms).toHaveLength(size);
      expect(result.sketch.bonds.map(b => b.order)).toEqual(Array(size).fill(1));
    }
  });

  it('closes six independently drawn edges and alternates only that new carbon cycle', () => {
    const vertices = polygon(6, 130);
    let sketch = emptySketch();
    const firstIds: string[] = [];
    for (let i = 0; i < 6; i++) {
      const a = vertices[i], b = vertices[i + 1];
      const points = sample([{ x: a.x + (i ? 19 : 0), y: a.y - (i ? 5 : 0) }, { x: b.x - 2, y: b.y + 2 }], 4);
      sketch = recognize(sketch, [ink(points, `edge-${i}`)]).sketch;
      if (!i) firstIds.push(...sketch.atoms.map(a => a.id));
      if (i < 5) expect(sketch.bonds.every(b => b.order === 1)).toBe(true);
    }
    expectBenzene(sketch);
    expect(firstIds.every(id => sketch.atoms.some(a => a.id === id))).toBe(true);
  });

  it('does not invent pen-down connections between unrelated strokes in one batch', () => {
    const result = recognize(emptySketch(), [
      ink(sample([{ x: 100, y: 100 }, { x: 200, y: 100 }]), 'top'),
      ink(sample([{ x: 200, y: 200 }, { x: 100, y: 200 }]), 'bottom'),
      ink(sample([{ x: 100, y: 200 }, { x: 100, y: 102 }]), 'left'),
    ]);
    expect(result.kind).toBe('bond');
    expect(result.sketch.atoms).toHaveLength(4);
    expect(result.sketch.bonds).toHaveLength(3);
  });

  it('recognizes an independently closed ring and a separate bond in the same batch', () => {
    const result = recognize(emptySketch(), [
      ink(sample(polygon(6)), 'ring'),
      ink(sample([{ x: 550, y: 250 }, { x: 620, y: 300 }]), 'chain'),
    ]);
    expect(result.recognized).toBe(true);
    expect(result.sketch.atoms).toHaveLength(8);
    expect(result.sketch.bonds).toHaveLength(7);
    expect(result.sketch.bonds.filter(b => b.order === 2)).toHaveLength(3);
    expect(result.sketch.ink).toHaveLength(0);
  });

  it('recognizes six separate edges drawn out of order in one batch', () => {
    const vertices = polygon(6);
    const strokes = [2, 0, 4, 1, 5, 3].map((edge, i) => {
      const endpoints = [vertices[edge], vertices[edge + 1]];
      if (i % 2) endpoints.reverse();
      return ink(sample(endpoints, 3), `edge-${edge}`);
    });
    expectBenzene(recognize(emptySketch(), strokes).sketch);
  });

  it('preserves nearby three-stroke N as a label on the original atom', () => {
    const sketch = addRing(emptySketch(), { x: 200, y: 200 }, 90, 6, 0), atom = sketch.atoms[0];
    const strokes = [
      ink(sample([{ x: atom.x - 13, y: atom.y - 13 }, { x: atom.x - 13, y: atom.y + 13 }]), 'left'),
      ink(sample([{ x: atom.x - 13, y: atom.y - 13 }, { x: atom.x + 13, y: atom.y + 13 }]), 'middle'),
      ink(sample([{ x: atom.x + 13, y: atom.y - 13 }, { x: atom.x + 13, y: atom.y + 13 }]), 'right'),
    ];
    const result = recognize(sketch, strokes);
    expect(result.kind).toBe('atom');
    expect(result.sketch.atoms).toHaveLength(6);
    expect(result.sketch.atoms.find(a => a.id === atom.id)?.element).toBe('N');
    expect(result.sketch.bonds).toEqual(sketch.bonds);
  });

  it('leaves a newly closed ring containing nitrogen at its explicit single bond orders', () => {
    const vertices = polygon(6);
    let sketch = recognize(emptySketch(), [ink(sample(vertices.slice(0, 6)))]).sketch;
    expect(sketch.atoms).toHaveLength(6);
    sketch.atoms[2].element = 'N';
    sketch = recognize(sketch, [ink(sample([vertices[5], vertices[6]]))]).sketch;
    expect(sketch.atoms).toHaveLength(6);
    expect(sketch.bonds).toHaveLength(6);
    expect(sketch.bonds.map(b => b.order)).toEqual([1, 1, 1, 1, 1, 1]);
  });

  it('interprets a long wavy line as one bond instead of many tiny carbons', () => {
    const points = Array.from({ length: 121 }, (_, i) => ({ x: 100 + i * 2, y: 200 + 14 * Math.sin(i * Math.PI / 20) }));
    const result = recognize(emptySketch(), [ink(points)]);
    expect(result.kind).toBe('bond');
    expect(result.sketch.atoms).toHaveLength(2);
    expect(result.sketch.bonds).toHaveLength(1);
  });

  it('straightens one smoothly bowed bond without adding a carbon at its midpoint', () => {
    const points = Array.from({ length: 80 }, (_, i) => ({ x: 100 + i * 2, y: 200 + 33 * Math.sin(i * Math.PI / 79) }));
    const result = recognize(emptySketch(), [ink(points)]);
    expect(result.sketch.atoms).toHaveLength(2);
    expect(result.sketch.bonds).toHaveLength(1);
  });

  it('retains deliberate chain zigzags despite rounded pen movement and wobble', () => {
    const points = sample([{ x: 90, y: 200 }, { x: 150, y: 150 }, { x: 210, y: 200 }, { x: 270, y: 150 }, { x: 330, y: 200 }], 3);
    const result = recognize(emptySketch(), [ink(points)]);
    expect(result.sketch.atoms).toHaveLength(5);
    expect(result.sketch.bonds).toHaveLength(4);
  });

  it('does not add atoms, edges, or bond orders when the same line is retraced', () => {
    const stroke = ink(sample([{ x: 100, y: 100 }, { x: 220, y: 100 }], 3));
    const first = recognize(emptySketch(), [stroke]).sketch;
    const second = recognize(first, [ink(stroke.points.map(p => ({ x: p.x + 1, y: p.y + 2 })).reverse())]).sketch;
    expect(second.atoms.map(a => a.id)).toEqual(first.atoms.map(a => a.id));
    expect(second.bonds).toEqual(first.bonds);
  });

  it('retains a deliberately parallel second line as a double bond', () => {
    const first = recognize(emptySketch(), [ink(sample([{ x: 100, y: 100 }, { x: 220, y: 100 }]))]).sketch;
    const result = recognize(first, [ink(sample([{ x: 111, y: 110 }, { x: 209, y: 110 }]))]);
    expect(result.sketch.atoms).toHaveLength(2);
    expect(result.sketch.bonds.map(b => b.order)).toEqual([2]);
  });

  it('retraces the exact matching bond before a nearby parallel bond stored earlier', () => {
    const sketch: Sketch = {
      ...emptySketch(),
      atoms: [
        { id: 'top-a', x: 100, y: 100, element: 'C' }, { id: 'top-b', x: 220, y: 100, element: 'C' },
        { id: 'bottom-a', x: 100, y: 112, element: 'C' }, { id: 'bottom-b', x: 220, y: 112, element: 'C' },
      ],
      bonds: [{ id: 'top', a: 'top-a', b: 'top-b', order: 1 }, { id: 'bottom', a: 'bottom-a', b: 'bottom-b', order: 1 }],
    };
    const result = recognize(sketch, [ink(sample([{ x: 100, y: 112 }, { x: 220, y: 112 }]))]);
    expect(result.sketch.bonds).toEqual(sketch.bonds);
    expect(result.sketch.atoms).toEqual(sketch.atoms);
  });

  it('retains deliberately erased ring orders when an erased ring edge is redrawn', () => {
    let sketch = addRing(emptySketch(), { x: 200, y: 200 }, 90, 6, 0);
    for (let i = 0; i < 3; i++) {
      const line = bondLines(sketch).find(l => l.index === 1)!;
      sketch = erase(sketch, sample([line.from, line.to]), 3);
    }
    const edge = bondLines(sketch)[0];
    sketch = erase(sketch, sample([edge.from, edge.to]), 3);
    expect(sketch.bonds).toHaveLength(5);
    sketch = recognize(sketch, [ink(sample([edge.from, edge.to]))]).sketch;
    expect(sketch.atoms).toHaveLength(6);
    expect(sketch.bonds).toHaveLength(6);
    expect(sketch.bonds.map(b => b.order)).toEqual([1, 1, 1, 1, 1, 1]);
  });

  it('does not restore erased double bonds when an unrelated bond is added', () => {
    let sketch = addRing(emptySketch(), { x: 150, y: 150 }, 80, 6, 0);
    for (let i = 0; i < 3; i++) {
      const line = bondLines(sketch).find(l => l.index === 1)!;
      sketch = erase(sketch, sample([line.from, line.to]), 3);
    }
    const oldBondIds = sketch.bonds.map(b => b.id);
    const result = recognize(sketch, [ink(sample([{ x: 500, y: 200 }, { x: 560, y: 220 }]))]);
    expect(result.sketch.bonds.filter(b => oldBondIds.includes(b.id)).map(b => b.order)).toEqual([1, 1, 1, 1, 1, 1]);
  });

  it('converts ambiguous crossed loops to a bounded chemical graph', () => {
    const figureEight = Array.from({ length: 121 }, (_, i) => ({ x: 250 + 90 * Math.sin(i * Math.PI / 60), y: 250 + 55 * Math.sin(i * Math.PI / 30) }));
    const result = recognize(emptySketch(), [ink(figureEight)]);
    expect(result.kind).toBe('bond');
    expect(result.recognized).toBe(true);
    expect(result.sketch.atoms.length).toBeGreaterThan(1);
    expect(result.sketch.atoms.length).toBeLessThanOrEqual(12);
    expect(result.sketch.bonds.length).toBeGreaterThan(0);
    expect(result.sketch.ink).toHaveLength(0);
    for (const bond of result.sketch.bonds) {
      expect(bond.a).not.toBe(bond.b);
      expect(result.sketch.atoms.some(a => a.id === bond.a)).toBe(true);
      expect(result.sketch.atoms.some(a => a.id === bond.b)).toBe(true);
    }
  });

  it('converts an unsupported clear eight-sided polygon to eight bonded carbons', () => {
    const result = recognize(emptySketch(), [ink(sample(polygon(8)))]);
    expect(result.kind).toBe('bond');
    expect(result.sketch.atoms).toHaveLength(8);
    expect(result.sketch.bonds).toHaveLength(8);
    expect(result.sketch.bonds.map(b => b.order)).toEqual(Array(8).fill(1));
    expect(result.sketch.ink).toHaveLength(0);
  });

  it('converts every nonempty stroke when clear bonds, ambiguous loops, and dots are mixed', () => {
    const figureEight = Array.from({ length: 121 }, (_, i) => ({ x: 450 + 90 * Math.sin(i * Math.PI / 60), y: 250 + 55 * Math.sin(i * Math.PI / 30) }));
    const result = recognize(emptySketch(), [
      ink(sample([{ x: 100, y: 100 }, { x: 200, y: 100 }]), 'bond'),
      ink([], 'empty'), ink(figureEight, 'ambiguous'), ink([{ x: 800, y: 100 }], 'dot'),
    ]);
    expect(result.recognized).toBe(true);
    expect(result.kind).not.toBe('ink');
    expect(result.sketch.ink).toHaveLength(0);
    expect(result.sketch.atoms.filter(a => a.x <= 200)).toHaveLength(2);
    expect(result.sketch.atoms.filter(a => a.x >= 360 && a.x <= 540).length).toBeGreaterThan(1);
    expect(result.sketch.atoms.filter(a => a.x === 800 && a.y === 100)).toHaveLength(1);
  });

  it('recognizes an oxygen glyph independently of another stroke in the same batch', () => {
    const oxygen = Array.from({ length: 81 }, (_, i) => ({ x: 500 + 12 * Math.cos(i * Math.PI / 40), y: 200 + 12 * Math.sin(i * Math.PI / 40) }));
    const result = recognize(emptySketch(), [ink(sample(polygon(6)), 'ring'), ink(oxygen, 'oxygen')]);
    expect(result.sketch.atoms).toHaveLength(7);
    expect(result.sketch.atoms.filter(a => a.element === 'O')).toHaveLength(1);
    expect(result.sketch.bonds).toHaveLength(6);
    expect(result.sketch.ink).toHaveLength(0);
  });

  it('does not create hundreds of atoms from a densely sampled scribble', () => {
    const scribble = Array.from({ length: 4001 }, (_, i) => ({ x: 300 + 90 * Math.sin(i * .077), y: 300 + 80 * Math.sin(i * .113) }));
    const result = recognize(emptySketch(), [ink(scribble)]);
    expect(result.recognized).toBe(true);
    expect(result.sketch.ink).toHaveLength(0);
    expect(result.sketch.atoms.length).toBeGreaterThan(0);
    expect(result.sketch.atoms.length).toBeLessThanOrEqual(12);
    for (const bond of result.sketch.bonds) {
      expect(bond.a).not.toBe(bond.b);
      expect(result.sketch.atoms.some(a => a.id === bond.a)).toBe(true);
      expect(result.sketch.atoms.some(a => a.id === bond.b)).toBe(true);
    }
  });
});
