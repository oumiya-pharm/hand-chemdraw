import { bounds, distance, segmentDistance } from './geometry';
import { type Atom, type Bond, type Point, type Sketch, uid } from './types';

export type BondKind = 'single' | 'double' | 'triple' | 'up' | 'down' | 'either';
export const BOND_KINDS: { kind: BondKind; label: string }[] = [
  { kind: 'single', label: '単結合' },
  { kind: 'double', label: '二重結合' },
  { kind: 'triple', label: '三重結合' },
  { kind: 'up', label: '手前（くさび）' },
  { kind: 'down', label: '奥（破線くさび）' },
  { kind: 'either', label: '不定（波線）' },
];

// Hit radii arrive in paper coordinates. A screen-sized tolerance must not
// swallow adjacent atoms when the paper is zoomed far out (normal bonds: 60).
const hitRadius = (radius: number) => Math.min(60 * .3, Math.max(0, radius));
const validPath = (path: Point[]) => path.length > 0 && path.every(p => Number.isFinite(p.x) && Number.isFinite(p.y));
const isTap = (path: Point[], radius: number) => {
  const box = bounds(path);
  return Math.hypot(box.width, box.height) <= Math.min(6, Math.max(2, radius * .4));
};

/** Target a bond interior or aligned trace. Touching a vertex alone never
 * selects its old bond: the same vertex must remain available for branches. */
export function bondAlongPath(sketch: Sketch, path: Point[], radius: number): Bond | undefined {
  if (!validPath(path)) return;
  const tolerance = hitRadius(radius), tap = isTap(path, tolerance);
  const first = path[0], last = path.at(-1)!, chord = distance(first, last);
  if (!tap && chord < 8) return;
  const middle = tap ? bounds(path).center : { x: (first.x + last.x) / 2, y: (first.y + last.y) / 2 };
  const atoms = new Map(sketch.atoms.map(atom => [atom.id, atom]));
  const candidates = sketch.bonds.flatMap(bond => {
    const a = atoms.get(bond.a), b = atoms.get(bond.b);
    if (!a || !b) return [];
    const length = distance(a, b);
    if (length < 1) return [];
    const projection = (p: Point) => ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / length;
    const middlePosition = projection(middle), near = segmentDistance(middle, a, b);
    if (middlePosition < length * .15 || middlePosition > length * .85 || near > Math.min(tolerance, length * .25)) return [];
    if (!tap) {
      const parallel = Math.abs(((last.x - first.x) * (b.x - a.x) + (last.y - first.y) * (b.y - a.y)) / (chord * length));
      if (parallel < .92 || path.some(p => segmentDistance(p, a, b) > tolerance)) return [];
      // An oblique branch can remain close to an existing line for much of
      // its length. When it starts at a vertex, require a clear retrace or
      // arrival at the opposite endpoint before treating it as an edit.
      const startAtA = distance(first, a) <= tolerance, startAtB = distance(first, b) <= tolerance;
      const clearRetrace = path.every(p => segmentDistance(p, a, b) <= Math.min(5, tolerance * .4));
      if (!clearRetrace && ((startAtA && distance(last, b) > tolerance) || (startAtB && distance(last, a) > tolerance))) return [];
      const low = Math.min(projection(first), projection(last)), high = Math.max(projection(first), projection(last));
      const overlap = Math.min(length, high) - Math.max(0, low);
      if (overlap < Math.min(length * .4, chord * .7)) return [];
    }
    return [{ bond, near }];
  });
  return candidates.sort((a, b) => a.near - b.near)[0]?.bond;
}

function withKind(bond: Bond, kind: BondKind, start?: string): Bond {
  const next = { ...bond, orderEdited: true };
  if (kind === 'single' || kind === 'double' || kind === 'triple') {
    next.order = kind === 'single' ? 1 : kind === 'double' ? 2 : 3;
    delete next.stereo;
  } else {
    next.order = 1;
    next.stereo = kind;
    if (start === bond.b) { next.a = bond.b; next.b = bond.a; }
  }
  return next;
}

/** In explicit mode each gesture supplies one pair of endpoints, bypassing
 * handwriting recognition. Bond.a is the starting/narrow stereobond end. */
export function paintBond(sketch: Sketch, path: Point[], kind: BondKind, radius: number): Sketch {
  if (!validPath(path)) return sketch;
  const tolerance = hitRadius(radius), tap = isTap(path, tolerance);
  const first = path[0], last = path.at(-1)!;
  const replace = (target: Bond, start?: string) => {
    const next = withKind(target, kind, start);
    if (next.order === target.order && next.stereo === target.stereo && next.a === target.a && next.b === target.b && target.orderEdited) return sketch;
    return { ...sketch, bonds: sketch.bonds.map(bond => bond.id === target.id ? next : bond) };
  };
  const target = bondAlongPath(sketch, path, tolerance);
  if (target) {
    const a = sketch.atoms.find(atom => atom.id === target.a)!, b = sketch.atoms.find(atom => atom.id === target.b)!;
    const forward = (last.x - first.x) * (b.x - a.x) + (last.y - first.y) * (b.y - a.y) >= 0;
    return replace(target, tap ? undefined : forward ? target.a : target.b);
  }
  if (tap || distance(first, last) < 8) return sketch;
  const nearest = (p: Point) => sketch.atoms.filter(atom => distance(atom, p) <= tolerance)
    .sort((a, b) => distance(a, p) - distance(b, p))[0];
  const from = nearest(first), to = nearest(last);
  if (from && to) {
    if (from.id === to.id) return sketch;
    const connected = sketch.bonds.find(bond => (bond.a === from.id && bond.b === to.id) || (bond.b === from.id && bond.a === to.id));
    if (connected) return replace(connected, from.id);
  }
  const newAtom = (p: Point): Atom => ({ id: uid('a'), x: p.x, y: p.y, element: 'C' });
  const a = from ?? newAtom(first), b = to ?? newAtom(last);
  const bond = withKind({ id: uid('b'), a: a.id, b: b.id, order: 1 }, kind);
  return { ...sketch, atoms: [...sketch.atoms, ...(!from ? [a] : []), ...(!to ? [b] : [])], bonds: [...sketch.bonds, bond] };
}
