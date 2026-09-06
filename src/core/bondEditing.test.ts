import { describe, expect, it } from 'vitest';
import { BOND_KINDS, bondAlongPath, paintBond, type BondKind } from './bondEditing';
import { emptySketch, type Bond, type Point, type Sketch } from './types';
import { repairValence } from './valence';

const line: Point[] = [{ x: 0, y: 0 }, { x: 60, y: 0 }];
const style = (kind: BondKind): Pick<Bond, 'order' | 'stereo'> =>
  kind === 'single' ? { order: 1 } : kind === 'double' ? { order: 2 } : kind === 'triple' ? { order: 3 } : { order: 1, stereo: kind };
function bonded(): Sketch {
  return { ...emptySketch(), atoms: line.map((p, i) => ({ ...p, id: `a${i}`, element: 'C' })), bonds: [{ id: 'b0', a: 'a0', b: 'a1', order: 2 }] };
}

describe('explicit bond drawing and targeting', () => {
  it.each(BOND_KINDS)('creates one $label bond from a gesture', ({ kind }) => {
    const source = emptySketch(), result = paintBond(source, line, kind, 14);
    expect(result.atoms).toHaveLength(2);
    expect(result.atoms.map(a => a.element)).toEqual(['C', 'C']);
    expect(result.bonds).toHaveLength(1);
    expect(result.bonds[0]).toMatchObject({ a: result.atoms[0].id, b: result.atoms[1].id, ...style(kind), orderEdited: true });
    if (['single', 'double', 'triple'].includes(kind)) expect(result.bonds[0].stereo).toBeUndefined();
    expect(source).toEqual(emptySketch());
  });

  it.each(BOND_KINDS)('sets an existing bond to exactly $label without changing identity', ({ kind }) => {
    const source = bonded(); source.bonds[0].stereo = 'either';
    const snapshot = structuredClone(source), result = paintBond(source, [{ x: 30, y: 3 }], kind, 14);
    expect(result.atoms).toEqual(source.atoms);
    expect(result.bonds).toHaveLength(1);
    expect(result.bonds[0]).toEqual({ id: 'b0', a: 'a0', b: 'a1', ...style(kind), orderEdited: true });
    expect(source).toEqual(snapshot);
  });

  it('uses endpoints once even when a selected-tool gesture has several corners', () => {
    const result = paintBond(emptySketch(), [line[0], { x: 20, y: 35 }, { x: 40, y: -20 }, line[1]], 'double', 14);
    expect(result.atoms).toHaveLength(2);
    expect(result.bonds).toHaveLength(1);
    expect(result.ink).toEqual([]);
  });

  it.each(['up', 'down', 'either'] as const)('makes the start the narrow end for %s and reverses an existing bond on a reverse drag', kind => {
    const source = bonded(), result = paintBond(source, [...line].reverse(), kind, 14);
    expect(result.bonds[0]).toEqual({ id: 'b0', a: 'a1', b: 'a0', order: 1, stereo: kind, orderEdited: true });
    const tapped = paintBond(result, [{ x: 30, y: 0 }], kind, 14);
    expect(tapped.bonds[0]).toEqual(result.bonds[0]);
  });

  it('retains endpoint ordering on a reverse drag with a normal bond type', () => {
    expect(paintBond(bonded(), [...line].reverse(), 'triple', 14).bonds[0]).toMatchObject({ a: 'a0', b: 'a1', order: 3 });
  });

  it('targets a slightly offset aligned trace and a short interior trace', () => {
    const source = bonded();
    expect(bondAlongPath(source, [{ x: 4, y: 7 }, { x: 55, y: 7 }], 14)?.id).toBe('b0');
    expect(bondAlongPath(source, [{ x: 22, y: 0 }, { x: 39, y: 0 }], 14)?.id).toBe('b0');
    expect(paintBond(source, [{ x: 4, y: 7 }, { x: 55, y: 7 }], 'single', 14).bonds).toHaveLength(1);
  });

  it('creates a branch departing a vertex without changing the neighboring bond', () => {
    const source = bonded(), path = [{ x: 1, y: 1 }, { x: -25, y: 48 }];
    expect(bondAlongPath(source, path, 14)).toBeUndefined();
    const result = paintBond(source, path, 'up', 14);
    expect(result.bonds[0]).toEqual(source.bonds[0]);
    expect(result.atoms).toHaveLength(3);
    expect(result.bonds[1]).toMatchObject({ a: 'a0', stereo: 'up' });
  });

  it('keeps a shallow new branch when it departs a vertex and ends away from the old endpoint', () => {
    const source = bonded(), path = [{ x: 0, y: 0 }, { x: 48, y: 16 }];
    expect(bondAlongPath(source, path, 18)).toBeUndefined();
    const result = paintBond(source, path, 'single', 18);
    expect(result.bonds).toHaveLength(2);
    expect(result.bonds[0]).toEqual(source.bonds[0]);
    expect(result.atoms).toHaveLength(3);
  });

  it('does not hijack a perpendicular crossing or an outward collinear extension', () => {
    const source = bonded();
    for (const path of [[{ x: 30, y: -30 }, { x: 30, y: 30 }], [{ x: 0, y: 0 }, { x: -60, y: 0 }]]) {
      expect(bondAlongPath(source, path, 14)).toBeUndefined();
      expect(paintBond(source, path, 'single', 14).bonds).toHaveLength(2);
    }
  });

  it('joins nearby atoms without creating duplicates or an orphan endpoint', () => {
    const source = bonded(); source.bonds = [];
    const result = paintBond(source, [{ x: 5, y: 4 }, { x: 57, y: -4 }], 'double', 14);
    expect(result.atoms).toEqual(source.atoms);
    expect(result.bonds[0]).toMatchObject({ a: 'a0', b: 'a1', order: 2 });
    expect(paintBond(result, line, 'triple', 14).bonds).toHaveLength(1);
  });

  it('sets an existing snapped connection even if a curved trace misses the bond hit test', () => {
    const result = paintBond(bonded(), [line[0], { x: 30, y: 35 }, line[1]], 'up', 14);
    expect(result.atoms).toHaveLength(2);
    expect(result.bonds).toEqual([{ id: 'b0', a: 'a0', b: 'a1', order: 1, stereo: 'up', orderEdited: true }]);
  });

  it('honors a small hit radius and caps a zoomed-out radius at the paper bond scale', () => {
    const source = bonded();
    expect(bondAlongPath(source, [{ x: 30, y: 10 }], 4)).toBeUndefined();
    expect(bondAlongPath(source, [{ x: 30, y: 30 }], 140)).toBeUndefined();
    const result = paintBond(source, [{ x: 0, y: 30 }, { x: 60, y: 30 }], 'single', 140);
    expect(result.atoms).toHaveLength(4);
    expect(result.bonds).toHaveLength(2);
    expect(result.bonds[0]).toEqual(source.bonds[0]);
  });

  it('does nothing on an empty path, a tiny blank tap, a vertex tap or a self connection', () => {
    const source = bonded();
    for (const path of [[], [{ x: 100, y: 100 }], [{ x: 100, y: 100 }, { x: 102, y: 103 }], [{ x: 0, y: 0 }], [{ x: -8, y: 0 }, { x: 8, y: 0 }]]) {
      expect(paintBond(source, path, 'double', 14)).toBe(source);
    }
    expect(paintBond(source, [{ x: 0, y: 0 }, { x: 40, y: 35 }, { x: 0, y: 0 }], 'single', 14)).toBe(source);
  });

  it('preserves unrelated atom metadata and ink', () => {
    const source = bonded(); source.atoms[0] = { ...source.atoms[0], element: 'N', isotope: 15, charge: 1, hydrogens: 1 };
    source.ink.push({ id: 'annotation', points: [{ x: 10, y: 60 }] });
    const result = paintBond(source, line, 'single', 14);
    expect(result.atoms).toEqual(source.atoms);
    expect(result.ink).toEqual(source.ink);
  });

  it('allows the central valence repair to lower an impossible selected order', () => {
    const source = bonded(); source.atoms[0].element = 'O'; source.bonds[0].order = 1;
    const result = repairValence(source, paintBond(source, line, 'triple', 14));
    expect(result.sketch.bonds[0].order).toBe(2);
    expect(result.repaired).toBe(true);
    expect(result.sketch.atoms).toHaveLength(2);
  });
});
