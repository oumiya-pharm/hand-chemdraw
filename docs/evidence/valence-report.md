# Editing-time valence correction

Implemented 2026-09-06 in `src/core/valence.ts`. This is a synchronous, browser-compatible pure graph operation; it does not load WASM or call a service. The caller remains responsible for committing the returned sketch, showing its Japanese feedback, preserving undo history, and running the existing local chemistry analysis.

## API

```ts
repairValence(before: Sketch, candidate: Sketch): {
  sketch: Sketch;
  messages: string[];
  repaired: boolean;
}
```

Pass the immediate pre-edit graph as `before` and the proposed edit as `candidate`. Both inputs remain untouched, including nested arrays, ink, coordinates and metadata. The output is a deep clone. `repaired` means this function changed the candidate; it is **not** a claim that every chemical issue is resolved. An established impossible all-single topology produces an unresolved message even when `repaired` is false. Passing the same graph as both arguments runs conservative legacy correction without treating any existing bond as a new addition.

## Correction policy

1. An element replacement clears only inherited, unchanged `hydrogens` and `isotope` values on the replaced atom. Other atoms retain their metadata. An explicitly changed value survives. The narrow model cannot distinguish an intentionally re-entered value equal to the old value from inherited data.
2. Valence sums include every incident bond order plus stored explicit hydrogen count.
3. Newly increased bond orders are lowered toward their prior order first. A newly created multiple bond can be lowered to single. Existing unaffected multiple bonds therefore survive when undoing the increment alone resolves the excess.
4. Remaining excess is reduced by lowering incident multiple bonds, ordered deterministically by bond ID. Orders are never raised and aromaticity is never restored. Atom replacement in an aromatic ring can therefore lower an adjacent double bond while retaining the complete ring.
5. If an atom still exceeds its bound using single bonds, new additions are rejected from the end of the candidate bond array. Only a rejected bond's newly created endpoint that had degree one and is now isolated is removed. Existing isolated atoms and new connected fragments survive.
6. Established single-bond topology is retained. Any remaining excess gets a Japanese message naming the element, represented valence and bound, explicitly stating that it could not be automatically corrected.
7. Stale inherited stereo is cleared on an edited bond or originating stereocenter when the final accepted local chemical environment changes. Multiple-bond stereo is also checked at both endpoints. Unsupported wedges on double bonds and any stereo marker on a triple bond are removed. Completely reverted bond-order increases and rejected extra branches preserve an otherwise unchanged stereocenter. Isotope changes alone do not clear stereo.

No charge is inserted, changed or removed by this operation. Charge-dependent limits are applied only when the explicit charge has a supported rule.

## Supported upper valence bounds

| Element | Neutral | Explicit charge → bound |
| --- | ---: | --- |
| H | 1 | +1 → 0, −1 → 0 |
| B | 3 | +1 → 2, −1 → 4 |
| C | 4 | +1 → 3, −1 → 3 |
| N | 3 | +1 → 4, −1 → 2 |
| O | 2 | +1 → 3, −1 → 1, −2 → 0 |
| F, Cl, Br, I | 1 | −1 → 0 |
| Si | 4 | — |
| P | 5 | +1 → 4 |
| S | 6 | +1 → 5, −1 → 5, −2 → 0 |

These are upper bounds for the represented drawing. Lower bond-order sums can be completed by implicit hydrogens. The operation does not prove molecular stability, synthesize the user's intended compound, validate all oxidation states, or model transition-metal coordination, uncommon halogen hypervalence, radicals, or every charged state. Unlisted element/charge combinations remain unchanged with explicit unsupported feedback. Input graph IDs, references and primitive values are assumed to have passed the existing graph boundary validation. Full chemistry diagnostics remain the local engine's responsibility.

Stored explicit H is preserved on ordinary bond edits. In particular, this function does not erase explicit H from an unchanged atom to make an otherwise impossible edit pass. It only repairs upper-bound excess; an explicit low-valence/radical-like state is outside this algorithm's scope and must be reported by the chemistry engine.

## Verification

`npm test -- src/core/valence.test.ts tests/valence-chemistry.test.ts`: **44 tests passed** (31 pure graph tests, 13 real Indigo WASM tests). Initial tests against a no-op implementation reproduced 19 missing correction failures. Two subsequent regression tests reproduced and then verified fixes for preserving wedges after a rejected order increase and clearing an invalid triple-bond stereo marker.

`npx tsc --noEmit`: passed.

The real-engine tests use the installed local `indigo-ketcher` 1.46.0 WASM bytes, with no mocks and no network. They verify:

- An acetone carbon with an added bond order is restored to the original graph, formula C3H6O, and no chemistry issues.
- Imported benzene C(H) → O retains all six ring bonds, leaves two double bonds, gives C5H6O, and has no chemistry issues.
- Imported benzene C(H) → N keeps bond orders, adds no charge, gives pyridine C5H5N, and has no chemistry issues.
- Quaternary N+, carboxylate O−, oxonium O+, tetrafluoroborate B−, phosphoric acid, sulfone, sulfonium and sulfoxonium remain unchanged and pass engine analysis.
- A molecule containing isotope 13C, a stereocenter and NH3+ remains graph-identical, retains `@` in SMILES and the same InChI, and has no chemistry issues.
- An erased benzene double bond stays erased after correction and analysis, giving C6H8.

Pure graph tests additionally cover legacy carbon sum five, neutral N/O replacement, all four halogens and boron, rejected fifth branches, retention of existing atoms and newly drawn connected fragments, explicit-H conflicts, unresolved established impossible degree, input immutability, unchanged isotope/stereo metadata, and correction idempotence. This report does not claim browser UI wiring or browser interaction tests; those belong to the integrating task.
