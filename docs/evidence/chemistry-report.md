# Chemistry subsystem evidence

Implemented 2026-09-06 with installed `indigo-ketcher` 1.46.0. No server chemistry API, CDN, telemetry, or molecular upload. Worker imports package JS and Vite emits the package WASM as a same-origin hashed asset.

## Integration

`src/chemistry/client.ts` exports `chemistry.convert(sketch, format)`, `parse(input, format?)`, `analyze(sketch)`, and `dispose()`. All operations return promises. Analysis returns `{smiles, formula, mass, issues}`. Mass is Indigo's molecular-weight string (g/mol); formula retains Indigo spacing. Exceptions are surfaced to the caller; the UI must display them. Only conversion/analysis consumes a sketch; it never updates the editor graph. Dispose rejects outstanding operations and a subsequent operation creates a new Worker.

Supported export keys: `smiles`, `mol-v2000`, `mol-v3000`, `sdf-v2000`, `sdf-v3000`, `cdxml`, `cdx`, `inchi`, `inchi-key`, `cml`, `ket`. CDX is returned as actual binary `Uint8Array`, decoded from Indigo's base64 response, starting with `VjCD0100`. Other outputs are strings. MOL/SDF versions are forced with `molfile-saving-mode`. InChIKey is export-only and import explicitly rejects it. Binary CDX input is accepted; binary input is interpreted as CDX/base64, so text file inputs should be supplied as decoded strings.

Cache the emitted Worker JS and WASM for offline operation. Neither package initialization nor molecular conversion needs an external origin. Browser first-load/offline tests remain the controller's integration responsibility.

## Graph boundary

The adapter writes V3000 with explicit single/double/triple orders, atom charge, isotope, explicit hydrogen-derived valence, wedge/hash/either bond CFG, and flipped screen Y coordinates. Analysis/export do not aromatize the saved graph. Import dearomatizes to explicit Kekulé bonds. Erasing one imported benzene double bond therefore changes C6H6 to C6H8; it cannot be restored by an aromatic flag. Existing edit IDs are untouched; a new imported document gets new IDs.

Import preserves coordinate geometry and normalizes its position to a 100px margin. Structures without coordinates are laid out locally. A real Indigo issue was found: dearomatizing coordinate-free stereochemical SMILES directly to KET loses wedges. The adapter detects coordinate-free MOL output and lays out the original input before dearomatizing. The stereo test verifies isotope/charge/wedge and `@` survive the MOL boundary.

The narrow editor model rejects reactions/annotations, S-groups, query atoms, radicals, relative/mixed stereo groups, multiple-record SDFs, and inputs above 10MB. An original-versus-restored formula check rejects unsupported explicit hydrogen states that Indigo's KET projection would silently lose (e.g. isolated `[C]`). This is a small-molecule editor, not a lossless general chemical document converter. Native JSON is needed to preserve handwriting and IDs. General ChemDraw interoperability has not been certified by launching ChemDraw; passing Indigo roundtrips are not evidence of all ChemDraw features.

## Verification

Test-first boundary suite initially failed because the adapter module did not exist; initial import exploration also exposed the package's explicit `/binaryWasm` export. The implemented tests execute actual WASM in Node using installed local bytes, with no mocked chemistry.

`npm test -- tests/chemistry.test.ts src/chemistry/client.test.ts`: **31 tests passed**. Covers benzene/pyridine formulae, dangling references, imported aromatic editing, ten format roundtrips, charge/isotope roundtrips for each format, actual CDX signature, V3000 markers, SDF terminators, InChIKey, tetrahedral stereo, pyrrole hydrogen, alkene geometry, rejected lossy hydrogen state, Worker request-ID matching, initialization failure, 45-second timeout termination, and disposal rejection. Every options map and selection vector is released in `finally`.

`npx tsc --noEmit`: passed following initial implementation; the controller should repeat after integration. Node-only WASM tests live outside `src` because the repository does not install Node types.

Local dev-server launch from this sandbox returned `listen EPERM` on 127.0.0.1:5173. No browser-runtime success is claimed in this report; controller browser verification is still required.

## Review fixes

The reviewer identified an absolute-stereochemistry regression: the adapter always wrote V3000 chiral flag 0, so `F[C@](Cl)(Br)I` changed KET `stereoLabel` from `abs` to `&1`, produced relative InChI `/s3`, and could not reload its own MOL. A real-WASM regression reproduced the failure (`&1` versus `abs`). The adapter now sets chiral flag 1 only when a single bond has an up/down wedge; this implements the editor's supported absolute stereo semantics. Structures with unspecified or either bonds do not assert absolute configuration. Tests check absolute KET, InChI `/s1`, matching InChI after both V2000 and V3000 reload, and unspecified tetrahedral centers remaining unspecified.

The reviewer also found unsupported atom mapping and aliases being silently discarded by the import projection. Real-WASM regressions first reproduced both: `[CH3:1][OH:2]` and `C |$foo$|` were accepted with metadata lost. Import now inspects the original KET atom metadata before layout/MOL conversion and rejects mapping/aliases explicitly, because the editor's shared atom model cannot store them. This rejection does not depend on formula differences.

After both fixes, `npm test -- tests/chemistry.test.ts src/chemistry/client.test.ts` passes **35 tests**, and `npx tsc --noEmit` passes.
