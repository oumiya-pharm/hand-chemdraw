import type { Atom, Bond, Sketch } from './types';

// Upper represented valences, including explicitly stored H. Implicit H may
// fill lower valences; these bounds do not assert chemical stability or cover
// coordination chemistry. Unlisted elements/charges are left to the engine.
const maxima: Record<string, Record<number, number>> = {
  H: { 0: 1, 1: 0, '-1': 0 },
  B: { 0: 3, 1: 2, '-1': 4 },
  C: { 0: 4, 1: 3, '-1': 3 },
  N: { 0: 3, 1: 4, '-1': 2 },
  O: { 0: 2, 1: 3, '-1': 1, '-2': 0 },
  F: { 0: 1, '-1': 0 }, Cl: { 0: 1, '-1': 0 },
  Br: { 0: 1, '-1': 0 }, I: { 0: 1, '-1': 0 },
  Si: { 0: 4 }, P: { 0: 5, 1: 4 }, S: { 0: 6, 1: 5, '-1': 5, '-2': 0 },
};
const connected = (left: Bond, right: Bond) =>
  (left.a === right.a && left.b === right.b) || (left.a === right.b && left.b === right.a);
const byId = (left: Bond, right: Bond) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0;

function environment(sketch: Sketch): Map<string, string> {
  const neighbors = new Map(sketch.atoms.map(atom => [atom.id, [] as string[]]));
  for (const bond of sketch.bonds) {
    neighbors.get(bond.a)?.push(`${bond.b}:${bond.order}`);
    neighbors.get(bond.b)?.push(`${bond.a}:${bond.order}`);
  }
  return new Map(sketch.atoms.map(atom => [atom.id, JSON.stringify([
    atom.element, atom.charge ?? 0, atom.hydrogens ?? null, neighbors.get(atom.id)!.sort(),
  ])]));
}

/** Repairs editing-time excess valence without inventing charges or removing
 * established single-bond topology. Call with the immediate pre-edit sketch;
 * passing the same graph twice repairs legacy multiple bonds conservatively.
 * `repaired` means the candidate changed, not that all chemistry is valid. */
export function repairValence(before: Sketch, candidate: Sketch): { sketch: Sketch; messages: string[]; repaired: boolean } {
  const sketch = structuredClone(candidate), messages = new Set<string>();
  const oldAtoms = new Map(before.atoms.map(atom => [atom.id, atom]));
  const oldBonds = new Map(before.bonds.map(bond => [bond.id, bond]));
  const inputBonds = new Map(candidate.bonds.map(bond => [bond.id, bond]));
  const priorBond = (bond: Bond) => {
    const prior = oldBonds.get(bond.id);
    return prior && connected(prior, bond) ? prior : undefined;
  };
  let repaired = false;

  for (const atom of sketch.atoms) {
    const previous = oldAtoms.get(atom.id);
    if (!previous) continue;
    const elementChanged = previous.element !== atom.element;
    const chargeChanged = (previous.charge ?? 0) !== (atom.charge ?? 0);
    if (!elementChanged && !chargeChanged) continue;
    const cleared: string[] = [];
    // Imported H belongs to the old element/charge state. Isotope belongs to
    // the element alone. Explicitly changed metadata must survive the edit.
    if (atom.hydrogens !== undefined && atom.hydrogens === previous.hydrogens) {
      delete atom.hydrogens; cleared.push('水素数');
    }
    if (elementChanged && atom.isotope !== undefined && atom.isotope === previous.isotope) {
      delete atom.isotope; cleared.push('同位体');
    }
    if (cleared.length) {
      repaired = true;
      messages.add(`${elementChanged ? `${atom.element} への置換` : '電荷の変更'}に合わせ、以前の${cleared.join('・')}指定を解除しました。`);
    }
  }

  const atoms = new Map(sketch.atoms.map(atom => [atom.id, atom]));
  const valences = new Map(sketch.atoms.map(atom => [atom.id, atom.hydrogens ?? 0]));
  const degrees = new Map(sketch.atoms.map(atom => [atom.id, 0]));
  for (const bond of sketch.bonds) for (const id of [bond.a, bond.b]) {
    valences.set(id, (valences.get(id) ?? 0) + bond.order);
    degrees.set(id, (degrees.get(id) ?? 0) + 1);
  }
  const maximum = (atom: Atom) => maxima[atom.element]?.[atom.charge ?? 0];
  const excess = (id: string) => {
    const atom = atoms.get(id), limit = atom && maximum(atom);
    return limit !== undefined && (valences.get(id) ?? 0) > limit;
  };
  const excessLabels = (bond: Bond) => [...new Set([bond.a, bond.b].filter(excess).map(id => atoms.get(id)!.element))].join('・');
  const reduce = (bond: Bond, floor: number) => {
    while (bond.order > floor && (excess(bond.a) || excess(bond.b))) {
      messages.add(`${excessLabels(bond)} の価数を超えないよう、結合次数を下げました。`);
      bond.order = (bond.order - 1) as Bond['order'];
      for (const id of [bond.a, bond.b]) valences.set(id, valences.get(id)! - 1);
      repaired = true;
    }
  };

  const ordered = [...sketch.bonds].sort(byId);
  // First undo only the newly requested increment, preserving an established
  // carbonyl/triple bond whenever that alone can resolve the edit.
  for (const bond of ordered) reduce(bond, priorBond(bond)?.order ?? 1);
  // A replaced atom or legacy graph can require lowering established multiple
  // bonds. Never increase a bond order or restore aromaticity here.
  for (const bond of ordered) reduce(bond, 1);

  const rejected = new Set<string>(), orphanCandidates = new Set<string>();
  // Reject the latest additions first when single bonds still exceed capacity.
  for (const bond of [...sketch.bonds].reverse()) {
    if (priorBond(bond) || (!excess(bond.a) && !excess(bond.b))) continue;
    messages.add(`${excessLabels(bond)} の価数を超える新しい結合を取り消しました。`);
    rejected.add(bond.id); repaired = true;
    for (const id of [bond.a, bond.b]) {
      valences.set(id, valences.get(id)! - bond.order);
      if (!oldAtoms.has(id) && degrees.get(id) === 1) orphanCandidates.add(id);
    }
  }
  sketch.bonds = sketch.bonds.filter(bond => !rejected.has(bond.id));
  const remainingEndpoints = new Set(sketch.bonds.flatMap(bond => [bond.a, bond.b]));
  sketch.atoms = sketch.atoms.filter(atom => !orphanCandidates.has(atom.id) || remainingEndpoints.has(atom.id));

  // Compare with the final accepted edit, so a completely rejected extra branch
  // does not destroy an otherwise unchanged imported stereocenter.
  const oldEnvironment = environment(before), finalEnvironment = environment(sketch);
  const changedCenter = (id: string) => oldEnvironment.has(id) && oldEnvironment.get(id) !== finalEnvironment.get(id);
  for (const bond of sketch.bonds) {
    if (!bond.stereo) continue;
    const previous = priorBond(bond), input = inputBonds.get(bond.id)!;
    // A newly selected wedge refers to the requested single bond, including
    // replacing an old double bond. Inherited stereo instead refers to the
    // previous accepted graph, so a fully reverted invalid edit preserves it.
    const newlySpecified = !previous || previous.stereo !== input.stereo || previous.a !== input.a ||
      (input.orderEdited && input.order === 1 && previous.order !== input.order);
    const orderChanged = (newlySpecified ? input : previous).order !== bond.order;
    const staleCenter = !newlySpecified && previous?.stereo === bond.stereo &&
      (changedCenter(bond.a) || (bond.order === 2 && changedCenter(bond.b)));
    if (orderChanged || staleCenter || bond.order === 3 || (bond.order === 2 && bond.stereo !== 'either')) {
      delete bond.stereo; repaired = true;
      messages.add('編集で成立しなくなった立体指定を解除しました。');
    }
  }

  for (const atom of sketch.atoms) {
    const limit = maximum(atom);
    if (limit === undefined) {
      messages.add(`${atom.element}（電荷 ${atom.charge ?? 0}）の価数は自動補正の対象外です。`);
    } else if (excess(atom.id)) {
      messages.add(`${atom.element} の価数 ${valences.get(atom.id)} が上限 ${limit} を超えています。既存の結合や明示した水素を残すため、自動補正できません。`);
    }
  }
  return { sketch, messages: [...messages], repaired };
}
