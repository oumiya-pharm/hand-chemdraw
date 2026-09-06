import { describe, expect, it } from 'vitest';
import { repairValence } from './valence';
import { emptySketch, type Atom, type Sketch } from './types';

function star(element: string, orders: (1 | 2 | 3)[], metadata: Partial<Atom> = {}): Sketch {
  return {
    ...emptySketch(),
    atoms: [{ id: 'center', x: 0, y: 0, element, ...metadata }, ...orders.map((_, i) => ({ id: `a${i}`, x: 40 * (i + 1), y: 40, element: 'C' }))],
    bonds: orders.map((order, i) => ({ id: `b${i}`, a: 'center', b: `a${i}`, order })),
  };
}
function ring(): Sketch {
  return {
    ...emptySketch(),
    atoms: Array.from({ length: 6 }, (_, i) => ({ id: `a${i}`, x: 40 * Math.cos(i * Math.PI / 3), y: 40 * Math.sin(i * Math.PI / 3), element: 'C' })),
    bonds: Array.from({ length: 6 }, (_, i) => ({ id: `b${i}`, a: `a${i}`, b: `a${(i + 1) % 6}`, order: i % 2 ? 1 : 2 })),
  };
}
const sumAt = (sketch: Sketch, id = 'center') => sketch.bonds.reduce((n, bond) => n + (bond.a === id || bond.b === id ? bond.order : 0), 0);

describe('editing-time valence repair', () => {
  it('reverts the newly increased bond before an established carbon double bond', () => {
    const before = star('C', [2, 1, 1]);
    const candidate = structuredClone(before);
    candidate.bonds[2].order = 2;
    const result = repairValence(before, candidate);
    expect(result.sketch.bonds.map(b => b.order)).toEqual([2, 1, 1]);
    expect(result.repaired).toBe(true);
    expect(result.messages.join('')).toContain('価数');
  });

  it('repairs legacy carbon bond-order sum five deterministically without deleting connectivity', () => {
    const candidate = star('C', [2, 2, 1]);
    const result = repairValence(candidate, candidate);
    expect(sumAt(result.sketch)).toBe(4);
    expect(result.sketch.bonds.map(b => b.id)).toEqual(candidate.bonds.map(b => b.id));
    expect(repairValence(result.sketch, result.sketch)).toEqual({ sketch: result.sketch, messages: [], repaired: false });
    const shuffled = { ...candidate, bonds: [...candidate.bonds].reverse() };
    expect(Object.fromEntries(repairValence(shuffled, shuffled).sketch.bonds.map(b => [b.id, b.order]))).toEqual(Object.fromEntries(result.sketch.bonds.map(b => [b.id, b.order])));
  });

  it.each([['N', 3], ['O', 2]] as const)('lowers surrounding multiple bonds when replacing carbon with %s', (element, maximum) => {
    const before = star('C', [2, 2]);
    const candidate = structuredClone(before);
    candidate.atoms[0].element = element;
    const result = repairValence(before, candidate);
    expect(sumAt(result.sketch)).toBe(maximum);
    expect(result.sketch.bonds).toHaveLength(2);
    expect(result.sketch.atoms[0].charge).toBeUndefined();
  });

  it('keeps the benzene ring connected after replacing C with neutral O', () => {
    const before = ring(), candidate = structuredClone(before);
    candidate.atoms[0].element = 'O';
    const result = repairValence(before, candidate);
    expect(sumAt(result.sketch, 'a0')).toBe(2);
    expect(result.sketch.bonds).toHaveLength(6);
    expect(result.sketch.bonds.filter(b => b.order === 2)).toHaveLength(2);
  });

  it('drops inherited H/isotope only on a replaced imported atom', () => {
    const before = ring();
    before.atoms[0] = { ...before.atoms[0], hydrogens: 1, isotope: 13 };
    before.atoms[2] = { ...before.atoms[2], hydrogens: 1, isotope: 13 };
    const candidate = structuredClone(before);
    candidate.atoms[0].element = 'O';
    const result = repairValence(before, candidate);
    expect(result.sketch.atoms[0]).toEqual({ id: 'a0', x: 40, y: 0, element: 'O' });
    expect(result.sketch.atoms[2]).toEqual(before.atoms[2]);
    expect(sumAt(result.sketch, 'a0')).toBe(2);
    expect(result.sketch.bonds).toHaveLength(6);
  });

  it('retains intentionally changed hydrogen and isotope metadata on replacement', () => {
    const before = star('C', [1], { hydrogens: 3, isotope: 13 });
    const candidate = structuredClone(before);
    candidate.atoms[0] = { ...candidate.atoms[0], element: 'O', hydrogens: 1, isotope: 18 };
    const result = repairValence(before, candidate);
    expect(result.sketch).toEqual(candidate);
    expect(result.repaired).toBe(false);
  });

  it('clears inherited explicit hydrogen after a charge change while retaining the isotope', () => {
    const before = star('O', [1], { hydrogens: 1, isotope: 18 }), candidate = structuredClone(before);
    candidate.atoms[0].charge = -1;
    const result = repairValence(before, candidate);
    expect(result.sketch.atoms[0]).toMatchObject({ element: 'O', charge: -1, isotope: 18 });
    expect(result.sketch.atoms[0].hydrogens).toBeUndefined();
    expect(result.sketch.bonds).toEqual(before.bonds);
    expect(result.messages.join('')).not.toContain('自動補正できません');
  });

  it('keeps explicitly changed hydrogen after a charge change', () => {
    const before = star('N', [1], { hydrogens: 2, isotope: 15 }), candidate = structuredClone(before);
    candidate.atoms[0] = { ...candidate.atoms[0], charge: 1, hydrogens: 3 };
    expect(repairValence(before, candidate).sketch).toEqual(candidate);
  });

  it.each([
    ['N', 1, [1, 1, 1, 1]], ['O', -1, [1]], ['O', 1, [1, 1, 1]],
    ['B', -1, [1, 1, 1, 1]], ['P', 0, [2, 1, 1, 1]], ['S', 0, [2, 2, 1, 1]],
  ] as [string, number, (1 | 2 | 3)[]][])('preserves valid %s charge %s with explicit bonds %s', (element, charge, orders) => {
    const candidate = star(element, orders, { charge });
    expect(repairValence(candidate, candidate)).toEqual({ sketch: candidate, repaired: false, messages: [] });
  });

  it('uses the negative oxygen charge when lowering a double bond', () => {
    const candidate = star('O', [2], { charge: -1 });
    const result = repairValence(candidate, candidate);
    expect(sumAt(result.sketch)).toBe(1);
    expect(result.sketch.atoms[0].charge).toBe(-1);
  });

  it.each(['F', 'Cl', 'Br', 'I', 'B'])('limits neutral %s valence', element => {
    const candidate = star(element, element === 'B' ? [2, 2] : [2]);
    const result = repairValence(candidate, candidate);
    expect(sumAt(result.sketch)).toBe(element === 'B' ? 3 : 1);
  });

  it('rejects a fifth carbon single bond and removes only its newly created dangling endpoint', () => {
    const before = star('C', [1, 1, 1, 1]);
    before.atoms.push({ id: 'unrelated', x: 90, y: 90, element: 'O' });
    const candidate = structuredClone(before);
    candidate.atoms.push({ id: 'new', x: 80, y: 80, element: 'C' });
    candidate.bonds.push({ id: 'extra', a: 'center', b: 'new', order: 1 });
    const result = repairValence(before, candidate);
    expect(result.sketch).toEqual(before);
    expect(result.messages.join('')).toContain('取り消');
  });

  it('keeps an established atom when rejecting its new connection to an overfilled center', () => {
    const before = star('C', [1, 1, 1, 1]);
    before.atoms.push({ id: 'existing', x: 90, y: 90, element: 'C' });
    const candidate = structuredClone(before);
    candidate.bonds.push({ id: 'extra', a: 'center', b: 'existing', order: 1 });
    expect(repairValence(before, candidate).sketch).toEqual(before);
  });

  it('keeps a newly drawn fragment when rejection does not leave a dangling endpoint', () => {
    const before = star('C', [1, 1, 1, 1]);
    const candidate = structuredClone(before);
    candidate.atoms.push({ id: 'new1', x: 80, y: 80, element: 'C' }, { id: 'new2', x: 90, y: 80, element: 'O' });
    candidate.bonds.push({ id: 'extra', a: 'center', b: 'new1', order: 1 }, { id: 'fragment', a: 'new1', b: 'new2', order: 1 });
    const result = repairValence(before, candidate);
    expect(result.sketch.bonds.some(b => b.id === 'extra')).toBe(false);
    expect(result.sketch.bonds.some(b => b.id === 'fragment')).toBe(true);
    expect(result.sketch.atoms.filter(a => a.id.startsWith('new'))).toHaveLength(2);
  });

  it('reports an impossible established all-single degree without deleting existing bonds', () => {
    const candidate = star('C', [1, 1, 1, 1, 1]);
    const result = repairValence(candidate, candidate);
    expect(result.sketch).toEqual(candidate);
    expect(result.repaired).toBe(false);
    expect(result.messages.join('')).toContain('自動補正できません');
  });

  it('counts explicitly represented H and does not erase H to hide an impossible atom', () => {
    const candidate = star('O', [1, 1], { hydrogens: 1 });
    const result = repairValence(candidate, candidate);
    expect(result.sketch.atoms[0].hydrogens).toBe(1);
    expect(result.sketch.bonds).toHaveLength(2);
    expect(result.messages.join('')).toContain('自動補正できません');
  });

  it('does not mutate either input, including metadata and ink', () => {
    const before = star('C', [2, 1, 1]);
    before.ink.push({ id: 'ink', points: [{ x: 1, y: 1 }] });
    const candidate = structuredClone(before);
    candidate.bonds[2].order = 2;
    const beforeSnapshot = structuredClone(before), candidateSnapshot = structuredClone(candidate);
    repairValence(before, candidate);
    expect(before).toEqual(beforeSnapshot);
    expect(candidate).toEqual(candidateSnapshot);
  });

  it('preserves unchanged valid tetrahedral stereo and isotope metadata', () => {
    const candidate = star('C', [1, 1, 1, 1], { isotope: 13 });
    candidate.atoms.slice(1).forEach((a, i) => { a.element = ['F', 'Cl', 'Br', 'I'][i]; });
    candidate.bonds[0].stereo = 'up';
    expect(repairValence(candidate, candidate)).toEqual({ sketch: candidate, messages: [], repaired: false });
  });

  it('clears stale wedge stereo at a center whose final bond order changes', () => {
    const before = star('C', [1, 1, 1]);
    before.bonds[0].stereo = 'up';
    const candidate = structuredClone(before);
    candidate.bonds[1].order = 2;
    expect(repairValence(before, candidate).sketch.bonds[0].stereo).toBeUndefined();
  });

  it.each(['up', 'down', 'either'] as const)('preserves deliberately selected %s stereo when a double bond becomes single', stereo => {
    const before = star('C', [2, 1, 1]), candidate = structuredClone(before);
    candidate.bonds[0] = { ...candidate.bonds[0], order: 1, stereo, orderEdited: true };
    expect(repairValence(before, candidate)).toEqual({ sketch: candidate, messages: [], repaired: false });
  });

  it('removes a new stereo specification if valence repair changes its requested order', () => {
    const before = star('O', [1, 1]), candidate = structuredClone(before);
    candidate.bonds[0] = { ...candidate.bonds[0], order: 2, stereo: 'either', orderEdited: true };
    expect(repairValence(before, candidate).sketch.bonds[0].stereo).toBeUndefined();
  });

  it('preserves stereo if an impossible extra bond is entirely rejected', () => {
    const before = star('C', [1, 1, 1, 1]);
    before.atoms.slice(1).forEach((a, i) => { a.element = ['F', 'Cl', 'Br', 'I'][i]; });
    before.bonds[0].stereo = 'up';
    const candidate = structuredClone(before);
    candidate.atoms.push({ id: 'new', x: 80, y: 80, element: 'C' });
    candidate.bonds.push({ id: 'extra', a: 'center', b: 'new', order: 1 });
    expect(repairValence(before, candidate).sketch).toEqual(before);
  });

  it('preserves stereo when an impossible order increase is entirely reverted', () => {
    const before = star('C', [1, 1, 1, 1]);
    before.atoms.slice(1).forEach((a, i) => { a.element = ['F', 'Cl', 'Br', 'I'][i]; });
    before.bonds[0].stereo = 'up';
    const candidate = structuredClone(before);
    candidate.bonds[0].order = 2;
    expect(repairValence(before, candidate).sketch).toEqual(before);
  });

  it('removes an either stereo marker from a triple bond', () => {
    const candidate = star('C', [3]);
    candidate.bonds[0].stereo = 'either';
    expect(repairValence(candidate, candidate).sketch.bonds[0].stereo).toBeUndefined();
  });

  it('preserves a deliberately de-aromatized ring', () => {
    const before = ring(), candidate = structuredClone(before);
    candidate.bonds[0].order = 1;
    expect(repairValence(before, candidate).sketch).toEqual(candidate);
    expect(repairValence(candidate, candidate).sketch).toEqual(candidate);
  });
});
