# Local chemical coordinate cleanup

Implemented 2026-09-06 using the installed Indigo 1.46.0 WASM. No external chemistry service, upload, or cloud runtime is used.

## API

- `chemistry.clean(sketch: Sketch): Promise<Sketch>` is the UI-facing Worker operation.
- `createEngine(indigo).clean(sketch: Sketch): Sketch` is the synchronous implementation.
- No options are required. Each connected component uses its median nonzero input bond length, clamped to **40–160 px**, with **60 px** for completely overlapping coordinates. The upper bound was expanded from the initial 90 px proposal to preserve existing radius-100 handwritten rings.

The returned sketch retains the original title, version, handwriting, atom and bond array order, every atom/bond ID, bond endpoint direction, element, charge, isotope, explicit hydrogen state, bond order, and wedge/hash/either metadata. The input object is not mutated. Only atom coordinates can change. The implementation does not dearomatize, aromatize, change bond orders, repair valence, or add/delete atoms.

## Geometry and identity boundary

Each connected component is laid out separately by `indigo.layout(..., 'ket', ...)`. Temporary V3000 atom-map numbers connect source atom IDs to returned KET atoms; map numbers must be complete, unique, and valid. Output array position is never used as atom identity. These temporary maps do not enter the saved sketch or ordinary exports.

The resulting chemical geometry is scaled to the component's target bond length, centered on the original component centroid, and rotated toward its original orientation with a 30-degree preferred bond direction. Reflected and nonreflected candidates are compared by total atom displacement. Isolated atoms keep their exact original location. Separate molecules therefore keep their relative centroid placement instead of being repacked by Indigo. If all proposed movements are below 1 px, the original coordinates are retained exactly so existing snapping targets do not drift.

Indigo can mirror coordinates or relocate wedges when atom records are reordered. Merely copying the returned coordinates can invert absolute stereochemistry while leaving the source wedge metadata unchanged. Components containing stereo metadata or double bonds therefore compare the original and proposed **InChI** identities. Cleanup chooses the nearest reflected/nonreflected candidate that preserves that identity. If neither candidate preserves it, cleanup throws a Japanese error and returns no replacement sketch; original chemistry remains intact. This also prevents silently introducing or changing coordinate-defined alkene geometry. Complex stereo arrangements that cannot be retained with these two candidates are deliberately rejected rather than rewritten.

## Verification

The initial test-first run failed all 11 cases because `engine.clean` did not exist. Later source-order permutations reproduced four absolute-stereo inversions in real WASM, and the radius-100 regression reproduced shrinking/mirrored vertices. The implementation fixes those failures.

`npm test -- tests/layout.test.ts tests/chemistry.test.ts src/chemistry/client.test.ts`: **55 tests passed** (20 layout, 31 chemistry, 4 client). Layout coverage includes an uneven seven-carbon chain becoming equal-length 120-degree zigzags, a completely overlapping benzene becoming a regular hexagon, radius-100 benzene keeping exact coordinates, disconnected component centers, isolated ions, no input mutation, empty sketch, all original graph metadata, formula preservation, absolute tetrahedral and alkene stereo, multiple-center/cyclic stereo with reordered source records, and a reordered real-WASM output boundary.

`npx tsc --noEmit`: passed.

`npm run build`: passed; Vite emitted the local Worker and same-origin WASM asset.

Full-suite snapshot during parallel integration: **125/129 passed**; four failures were in the separately owned recognition work (`src/core/core.test.ts` and `src/core/handwriting.test.ts`), covering hexagon count, independently drawn edges, a wavy single bond, and a bowed single bond. No recognition files were changed by this subtask. The controller must rerun the full suite after that work finishes.

Browser-level integration and autosave/undo behavior belong to the controller's UI change; they are not claimed by this engine report.
