# te — A handwritten chemistry notebook

[日本語](README.md) | [English](README.en.md)

A browser app for editing chemical structures with the feel of paper, pencil, and eraser, designed primarily for a PC mouse or trackpad.

Sketch a rough hexagon to create a benzene ring. Select N and trace over a vertex to replace its atom. Buttons also select bond orders, solid and hashed wedges, wavy bonds, and ions such as N⁺ and O⁻. Erase one line of a double bond to make it single; draw the line back to restore it. Recognition, chemistry, storage, and export all run on your device.

Each completed edit triggers automatic bond-length and angle cleanup. Rings use a common bond length. New bonds that exceed supported valences are rejected, and multiple bonds made invalid by an element replacement are corrected. Cleanup belongs to the same Undo step as the edit and does not overwrite later input or Redo.

The app currently has a Japanese interface. This guide includes the Japanese button labels so you can find the corresponding controls. Design documents and detailed verification reports linked below are also in Japanese.

## Start the app

### Docker: no local Node.js installation needed

Start Docker Desktop, or Docker Engine with the Compose plugin. In the repository folder, run:

```sh
docker compose up --build -d
```

Open **[http://127.0.0.1:8080/](http://127.0.0.1:8080/)**. The first build needs an internet connection to download base images and npm dependencies. You do not need Node.js or npm on the host.

```sh
docker compose ps          # Check that the service is healthy
docker compose logs -f app # Follow logs; Ctrl+C stops following
docker compose down        # Stop and remove the container
```

To apply source changes, run `docker compose up --build -d` again. To activate an updated offline cache, reload the page, then close all tabs for this app URL and reopen it.

The default port is 8080, bound to this computer's loopback interface. To change it, create a `.env` file in the repository root containing `TE_PORT=8081`, run the startup command again, and open `http://127.0.0.1:8081/`. On macOS/Linux you can also use `TE_PORT=8081 docker compose up --build -d`.

The container serves built HTML, JavaScript, and WASM through Nginx. Chemistry and note storage still run in the browser; structures are not uploaded to the container, and no database setup is needed. Removing the container does not delete the browser's note. Storage is separate for each URL hostname and port, however. When moving from the Node.js version on port 4173 or changing ports, export a `.te.json` note from the old URL and import it at the new one.

See [Dockerfile](Dockerfile), [compose.yaml](compose.yaml), and the [Nginx configuration](docker/nginx.conf). The Dockerfile builds with the [official Node image](https://hub.docker.com/_/node) and copies the build output into the [official Nginx image](https://hub.docker.com/_/nginx).

### Node.js

Use a current Node.js LTS release or Node 25, with npm. Local development has been verified with Node 25.9.0.

On macOS, **double-click `start.command`** in the repository folder. It installs dependencies when needed, builds the production app, and opens the browser. Alternatively:

```sh
npm ci
npm start
```

Open **[http://127.0.0.1:4173/](http://127.0.0.1:4173/)**. The local server keeps running after you close the terminal. Opening `index.html` directly as a file displays startup instructions instead of running the app. Server logs are written to `.te-preview.log`.

For development, use `npm run dev`. To serve the production build as a foreground process:

```sh
npm run build
npm run preview
```

On its first production visit, the browser caches the app and its approximately 12 MB chemistry engine from the same origin. After the Service Worker finishes installing, you can disconnect. There are no external APIs, CDNs, or telemetry at runtime. The development server does not provide offline caching.

## Draw your first structure

1. Select **Auto (自動)** in the upper row and draw a rough hexagon. It becomes a benzene ring and uses the same scale as other rings.
2. Select **N** in the lower row and trace briefly over a vertex. You do not have to write the letter N. Clicking the vertex also works.
3. To give it a positive charge, select **N⁺** and trace over the same vertex.
4. Select **Double bond (二重結合)** and trace an existing bond to change its order.
5. Choose **Export (書き出す)** to save SMILES, SDF, or another format. Use `Ctrl/Cmd+Z` to undo an edit.

## Draw and change bonds

Choose a bond type in the upper row. The active button turns green.

| Button | Drawing a new bond | Changing an existing bond |
|---|---|---|
| Auto (自動) | Recognizes hexagons as benzene and zigzags as carbon chains | Interprets strokes, such as a parallel line to increase bond order |
| Single (単結合) | Draws one single bond | Replaces a multiple bond or special style with an ordinary single bond |
| Double (二重結合) | Draws a double bond in one drag | Changes the target bond to double |
| Triple (三重結合) | Draws a triple bond in one drag | Changes the target bond to triple |
| Toward you (手前) | Draws a solid wedge | Changes the target bond to a solid wedge |
| Away from you (奥) | Draws a hashed wedge | Changes the target bond to a hashed wedge |
| Unspecified (不定) | Draws a wavy bond | Marks the target bond's stereochemistry as unspecified |

**Outside Auto mode, one drag produces one bond.** Return to Auto or press `P` to recognize hand-drawn rings and chains.

Trace along an existing bond or click its midpoint to change it. Its identity and endpoint atoms are preserved; the action does not add a duplicate bond. Choosing Single, Double, or Triple removes any wedge or wavy specification on that bond.

Drag outward from an atom to add a branch using the selected bond type. Draw to another atom to connect them. The selected type remains active for subsequent strokes. Choose the corresponding button to return to automatic recognition or atom painting.

### Wedge direction

**The start of a drag is the narrow end; the end of the drag is the wide end.** Draw from the stereocenter toward the substituent. Retrace a bond in the opposite direction to reverse its ends. Clicking the midpoint preserves the current direction.

Stereochemical specifications are part of the structure data and are passed to chemical exports such as SMILES and MOL/SDF. Adding a wedge to a bond without a stereocenter does not create a chemical stereocenter. Such drawing annotations can be retained on the canvas and in notes, MOL, and CDXML; SMILES and InChI represent the underlying molecule.

## Choose atoms and ions

Select C/N/O/S/P/F/Cl/Br/I/H/B/Si in the lower row, then trace or click a vertex to replace its atom. Drawing in blank space adds one atom of the selected element.

| Action | Result |
|---|---|
| Select N⁺ and trace a vertex | Replaces it with nitrogen carrying formal charge +1 |
| Select O⁻ and trace a vertex | Replaces it with oxygen carrying formal charge −1 |
| Select an element, adjust Charge (電荷) with +/−, then draw | Adds or replaces an atom with that element and charge |
| Select Neutral (中性), then trace the atom | Applies formal charge 0 to the selected element |
| Select an ordinary element button, such as N or O | Selects that element in its neutral state |

The charge controls specify **the next atom you paint**. Changing the controls alone does not modify an atom on the canvas; trace over a vertex to apply the selection. The cursor shows labels such as N⁺. To change only an atom's charge, select the same element before painting over it.

When the charge changes, inherited hydrogen-count specifications are cleared where needed so chemistry can be recalculated. Charge-only changes preserve an atom's isotope. Charges and wedges are included in the saved structure data.

The painting controls accept charges from −15 to +15, but automatic valence correction does not cover every element/charge combination. The app does not predict ionization from pH or solvent; you specify a formal charge.

## Erase, move, resize, and undo

- **Eraser (消しゴム):** trace over bonds or atom labels to erase them. Holding `E` temporarily activates the eraser. Erasing the label of a bonded atom changes it back to carbon.
- **Erase one line of a double bond:** use a small eraser on its extra line to reduce it to a single bond. Rectangle erase can remove an entire bond or larger region.
- **Rectangle erase (範囲消去):** drag a rectangle to delete atoms inside it and their connected bonds. A red preview shows the affected elements. Dragging in either direction works; `Escape` cancels the gesture.
- **Select (選択と移動):** drag atoms to adjust positions. Automatic layout applies to the changed component. Auxiliary controls also let you change the selected atom's charge directly.
- **Size:** rings, chains, and imported structures are normalized to a common bond length of 60 canvas units. Rings of the same type therefore have the same size. Zoom changes the view scale.
- **Undo/Redo:** atom replacement, bond changes, rectangle erase, and their automatic cleanup are grouped into one edit.

Completed strokes are converted into atoms, bonds, or rings instead of remaining as unrecognized ink. Ambiguous strokes are assigned a structure element, so use Undo or the explicit buttons if the interpretation differs from your intent. Residual ink in older notes is also converted on loading.

### Keyboard shortcuts

| Key | Action |
|---|---|
| P | Return to the Auto pencil |
| Hold E | Temporarily use the eraser |
| V | Select and move |
| Space + drag | Pan the canvas |
| Ctrl/Cmd + Z | Undo |
| Ctrl/Cmd + Shift + Z | Redo |
| Ctrl/Cmd + S | Save a `.te.json` note with structure and layout |
| Escape | Cancel the current stroke or rectangle erase |

## Save and import

The canvas is saved automatically in this browser's localStorage. **Open (開く)** imports chemical files, SMILES, and `.te.json` notes. Click the SMILES at the bottom of the screen to copy it. **Export (書き出す) → Save note (ノートを保存)** creates a file for continuing work in this app.

Browser storage holds one document per origin. Editing the same note in multiple tabs pauses autosave and displays a conflict notification. Save important notes to files as well.

## Export formats

SMILES, MOL/SDF (V2000/V3000), CDX, CDXML, InChI, InChIKey, CML, KET, SVG, PNG, JPEG, and te JSON.

Chemical conversions use Indigo WASM 1.46.0 in a Web Worker. SVG and image exports preserve the canvas layout. Full compatibility with every ChemDraw format has not been achieved; see the [compatibility table and remaining work](docs/planning/format-compatibility.md).

## Current limitations

- Recognition is an initial geometry-based implementation with a small set of symbol templates. Accuracy has not been measured across a large population of writers.
- Automatic correction addresses valence and drawing layout, not chemical stability or synthetic feasibility. Excess branches that cannot be resolved without deleting existing single bonds, and unsupported elements or charges, produce explanatory notifications.
- Reactions, sequences, S-groups, atom mapping, queries, radicals, relative/mixed stereochemistry, and multiple SDF records are not editable. Imports are rejected when unsupported information would be lost.
- CDX/CDXML molecule round trips have been tested. Whole-document interoperability has not been tested in ChemDraw itself.
- Autosave stores one document in localStorage. Clearing browser data deletes it; save `.te.json` files for backup. Storage exhaustion and cross-tab conflicts pause autosave and display a notification.

## Troubleshooting

| Symptom | What to check |
|---|---|
| A hexagon does not become a ring | Select Auto (自動). Explicit bond modes create one bond per drag |
| Painting adds a new atom instead of replacing one | Trace closer to the existing vertex; the cursor highlights a nearby target |
| A wedge points the wrong way | Retrace from the desired narrow end to the wide end |
| Charge controls are disabled | Select an atom such as N or O first |
| “Check the structure” (構造を確認してください) appears | Read the valence or stereochemistry notification and adjust the element, charge, or bond |
| The app does not start | Open the HTTP URL from `npm start`, not `index.html` directly |
| The Docker URL is unreachable | Start Docker and check `docker compose ps` and `docker compose logs app`. Use `TE_PORT` to resolve a port conflict |
| The Docker version does not show an earlier note | Hostname or port changes use separate browser storage. Export `.te.json` at the old URL and import it at the new one |
| Updated controls do not appear | After rebuilding, reload once, close all tabs for the same app URL, and reopen it to activate the updated offline cache |

## Development and verification

```sh
npm test
npm run build
npm run test:browser
npx playwright test --config playwright.production.config.ts
```

Browser tests use an installed Google Chrome. If it is unavailable, remove the `channel` setting from the Playwright configurations and run `npx playwright install chromium`.

To verify offline drawing, chemistry conversion, and CDX saving against a running Docker instance, install the test dependencies on the host and run the following on macOS/Linux. Host Node.js is needed for these tests only, not for starting the Docker app.

```sh
npm ci
TE_TEST_URL=http://127.0.0.1:8080 npx playwright test --config playwright.production.config.ts
```

### Where to add or change features

| Area | Main files | Check alongside the change |
|---|---|---|
| Buttons, selection state, history | `src/App.tsx` | Element/charge/bond mode transitions and Undo/Redo |
| Mouse input and previews | `src/components/SketchCanvas.tsx` | Drag state, zoom, cancellation, and cleanup races |
| Bond types and retracing | `src/core/bondEditing.ts` | `BondKind`, `BOND_KINDS`, endpoint direction, snapping, and valence correction |
| Bond button icons and live previews | `src/components/BondGlyph.tsx` | Agreement with the structure renderer's shape and direction |
| Atom/charge painting and rectangle erase | `src/core/directEditing.ts` | Charge-only edits and preserving atoms outside the rectangle |
| Automatic handwriting recognition | `src/core/editor.ts`, `geometry.ts`, `recognition.ts` | Multiple strokes, rings, retracing, and required conversion |
| Valence and inherited stereochemistry correction | `src/core/valence.ts` | Explicit charge, hydrogen, isotope, and existing-bond preservation |
| Canvas and SVG output | `src/core/render.ts` | Solid/hashed wedges, wavy bonds, and charge labels |
| Chemistry conversion and automatic layout | `src/chemistry/engine.ts`, `src/useChemicalNormalization.ts` | Real Indigo WASM round trips, IDs, stereochemistry, and common bond length |
| Saved data and validation | `src/core/types.ts`, `src/storage.ts`, `src/components/ExportDialog.tsx` | Reading/writing new data and compatibility with existing files |
| Docker build and serving | `Dockerfile`, `compose.yaml`, `docker/nginx.conf`, `.dockerignore` | WASM MIME type, Service Worker updates, health checks, and offline restart |

A new bond type requires more than a button: data types, storage validation, rendering, and chemical format conversion must all support it. Current bond orders are 1–3; stereo values are up/down/either. Coordinate bonds, reaction arrows, and similar additions need an expanded editing model and explicit handling of unsupported exports.

To allow wedges on nonstereogenic atoms while editing, only internal Sketch analysis, cleanup, and conversion enable Indigo's `ignore-stereochemistry-errors` option. External file imports retain their existing strict settings. See the [official Indigo option documentation](https://lifescience.opensource.epam.com/indigo/options/index.html).

`src/core/bondEditing.test.ts` checks retracing, branching, and direction. `tests/bond-chemistry.test.ts` verifies formal charges and stereochemistry with real WASM. `tests/bond-tools.spec.ts` covers browser controls, Undo, and export. Verify both the appearance and the chemical data.

- [Design specification](docs/superpowers/specs/2026-09-05-hand-chemistry-design.md)
- [Implementation plan](docs/superpowers/plans/2026-09-05-hand-chemistry.md)
- [Recognition and interaction evaluation](docs/planning/recognition-evaluation.md)
- [Implementation status and verification](docs/evidence/implementation-status.md)
- [Automatic layout and valence corrections](docs/evidence/chemical-editing-correction.md)
- [Atom buttons, required conversion, rectangle erase, and consistent size](docs/evidence/direct-chemical-editing.md)
- [Bond types, stereochemical notation, and ion controls](docs/evidence/bond-ion-tools.md)
- [Chemistry verification](docs/evidence/chemistry-report.md)
- [Offline verification](docs/evidence/offline-report.md)
- [Docker and English README verification](docs/evidence/docker-report.md)

## License

This repository is licensed under Apache-2.0. See each dependency for its own license.
