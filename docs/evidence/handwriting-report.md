# Handwriting graph recognition verification

Date: 2026-09-06

## Scope and result

This change addresses the reported behavior where irregular polygonal loops became chains or the wrong ring size, rounded closed loops remained ink, and ordinary curved pen movement created extra carbon atoms. It changes `src/core/geometry.ts` and `src/core/editor.ts`, and adds `src/core/handwriting.test.ts`.

These functions infer a molecular graph from pen strokes. They do not perform a global coordinate cleanup of existing molecules. Indigo layout, valence post-processing, and the UI idle/recognition flow are integrated separately by the parent task.

## Reproductions before implementation

The initial 14-test handwriting suite was run against the previous implementation before production code changed. Seven tests failed for the intended behavioral reasons:

| Trace | Previous result | Required result |
| --- | --- | --- |
| Large irregular six-sided loop with edge wobble | Seven atoms | Six atoms with alternating double bonds |
| Sheared hexagon, varied start and direction | No graph | Six-atom ring |
| Rounded hexagon with a closing gap | Nine atoms | Six-atom ring |
| Large, mildly wobbly circular loop | No graph | Default six-atom ring |
| Six independent edges with imperfect endpoint placement | Eleven atoms | One closed six-atom ring |
| Wavy long line | Eight atoms | One bond, two atoms |
| Smooth bowed line | Four atoms | One bond, two atoms |

The fixture tests exercise the real recognizer and resulting atom identities, connectivity, bond orders, and retained ink. They use no recognizer or chemistry mocks.

## Recognition changes

### Single-stroke rings

- Resample the closed contour uniformly and smooth short pen wobble before looking for corners.
- Permit a modest closing gap, up to 28% of the stroke bounding-box diagonal.
- Analyze an affine-normalized copy of the contour. This removes sensitivity to shear and unequal horizontal/vertical scale when counting corners; it does not move existing sketch atoms.
- Start polygon analysis at a stable extremum, and remove artificial or shallow corners introduced by starting on an edge.
- Compare polygon candidates at several simplification tolerances. Prefer the smallest supported polygon whose edges explain the contour with a low residual.
- Preserve clear three-, four-, five-, and seven-member rings as single-bond rings. Six-member ring gestures use alternating double bonds, as in the original product behavior.
- Default a valid, ring-sized smooth contour with no clear supported polygon evidence to six atoms. The existing small-symbol recognition priority keeps a small circular glyph as O.
- Reject crossed contours, extremely narrow shapes, insufficiently enclosed shapes, and clearly sharp unsupported polygons. The octagon and figure-eight fixtures remain ink rather than silently receiving six atoms.

### Bonds and multiple pen strokes

- Analyze each stroke independently for line corners and closed rings. Pen-up jumps are never supplied to the ring fitter as if they were drawn edges.
- A low-amplitude wavy line is straightened directly. For other open strokes, localized turning peaks identify intentional corners; broad distributed curvature alone does not create carbon atoms.
- Preserve deliberate zigzag chains and meaningful segment lengths. Keep highly ambiguous, crossed, or unsupported traces as ink.
- Snap endpoints against nearby atoms using the current local bond scale: 23% of the median of nearby bond lengths, bounded to 10–30 canvas units. This reads current displayed coordinates after a chemical layout and retains existing atom IDs.
- Treat a centerline retrace within a small tolerance as the same bond. Rank all matching bonds by exact-retrace priority and distance, so an earlier stored nearby parallel bond cannot capture a later bond's retrace. A clearly offset parallel second line still increments the bond order.
- Detect a newly formed cycle before inserting its final edge. Only a simple six-carbon cycle made from single, non-stereo bonds is promoted to alternating orders. Shorter alternate paths, internal chords, crossed or degenerate geometry, heteroatoms, and overbonded vertices prevent this inference.
- Never scan old cycles for aromatization after an unrelated edit. Explicit bond-order changes, including erased double strokes and added parallel strokes, set the `orderEdited` provenance field supplied by the parent task. New-cycle inference refuses cycles containing that field. Erasing double strokes and then erasing/redrawing an entire ring edge therefore preserves the intended single-bond orders.
- Leave the existing near-vertex symbol path ahead of graph recognition, preserving incomplete multi-stroke N as ink and replacing the original atom with N after completion.

## Final verification

Command:

```sh
npm test -- src/core/handwriting.test.ts src/core/core.test.ts src/core/render.test.ts
npx tsc -b
```

Final result: **37 tests passed across all three suites; TypeScript completed with exit code 0.** No existing test was edited or weakened.

The 21 new handwriting tests cover:

1. A large non-regular hexagon with sinusoidal edge wobble.
2. Sheared hexagons with multiple starting positions and both drawing directions.
3. Quadratically rounded hexagon corners, edge wobble, and a closing gap.
4. A large rippled circle and a small O glyph.
5. Clear triangles, squares, pentagons, and heptagons.
6. Six independent edges with endpoint offsets and retained initial atom IDs.
7. A three-sided square-shaped batch whose missing fourth side is a pen-up jump.
8. A closed ring and an unrelated bond in the same batch.
9. Six independent edges drawn out of order and in mixed directions.
10. Three-stroke N on an existing ring vertex, retaining the atom ID and all bonds.
11. A newly closed nitrogen-containing ring retaining its explicit single bonds.
12. A long wavy line.
13. A single smooth bowed line.
14. A deliberate four-bond zigzag with wobble.
15. A reversed, slightly shifted centerline retrace.
16. A deliberately offset second line becoming a double bond.
17. An unrelated bond added after all ring double strokes were erased.
18. A crossed figure-eight preserved as ink.
19. A clearly eight-sided polygon preserved as ink.
20. An exact retrace of the second of two nearby parallel single bonds, preserving both orders regardless of storage order.
21. Erasing all three benzene double strokes, erasing one entire ring edge, then redrawing that edge while retaining six single bonds.

The last two cases came from independent review. Both failed before their fixes: the first changed the wrong bond to order two, and the second restored all three double bonds. Both now pass.

The existing suites additionally verify near-vertex single-stroke N, incomplete multi-stroke N, ring start/direction invariance, erasing individual double-bond strokes, labels, and stereochemical rendering.

## Limits and interpretation

- This is a geometric heuristic with deterministic regression fixtures, not a trained handwriting model or an accuracy measurement on a human handwriting corpus. The fixtures reproduce the reported classes of failure; no recognition percentage for unseen handwriting is claimed.
- A featureless large loop does not uniquely specify a chemical ring size or aromaticity. Choosing a six-member alternating ring is an explicit product default. Clear supported polygon corners take precedence.
- Very open loops, extreme distortion, narrow loops, elaborate fused-ring drawings, and heavily overwritten or self-crossing handwriting can remain ambiguous. The recognizer retains unsupported ink rather than claiming a complete molecular interpretation.
- Detection of a separate parallel line uses geometric tolerances. Very slight offsets can be indistinguishable from a retrace; very large offsets can be independent bonds.
- The scale-adaptive snapping tests cover stored/displayed graph coordinates. Actual timing between independent strokes and asynchronous Indigo layout is part of the parent task's browser verification.
- This report verifies the recognition and graph-editing functions. It makes no independent claim that global chemical layout, chemistry export, valence warnings, or the overall browser workflow passed.
