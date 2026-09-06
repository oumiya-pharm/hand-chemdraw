# Offline production verification

Verified 2026-09-06 using installed Chrome through Playwright, production build served at `http://127.0.0.1:4173`.

## Root cause and fix

The generated service worker precached the application correctly, but its fetch handler respected cached response `Vary: Origin`. Vite preview serves assets with that header. The Origin header of a browser module/worker fetch can differ from the precache request created by `cache.addAll`. Consequently the cache lookup missed an existing static asset, attempted network access, and failed offline; the document loaded but its JS/CSS did not.

The cache lookup now uses `ignoreVary: true` alongside the existing `ignoreSearch: true`. This cache contains same-origin static build assets, whose content does not depend on Origin. No network dependency or chemistry warm-up was added.

## Controlled regression comparison

- Temporarily restored the original `cache.match(event.request, {ignoreSearch:true})`, rebuilt, then ran `npx playwright test --config playwright.production.config.ts --timeout=12000`: failed after 12 seconds waiting for `sketch-canvas` following the offline reload.
- Restored `ignoreVary:true`, rebuilt, and ran `npx playwright test --config playwright.production.config.ts`: **1 passed (3.0s)**.
- Final `npm run build`: successful TypeScript and Vite production build.

## What the browser test verifies

1. A fresh browser context opens the production app and waits for the service worker to finish installation and control the page.
2. The browser context switches offline, then reloads the application document.
3. After that reload, the user draws a six-carbon ring and receives formula `C6H6`.
4. The chemistry worker returns benzene SMILES. Both aromatic `c1ccccc1` and equivalent Kekule `C1C=CC=CC=1` representations are accepted; the observed result is the latter.
5. CDX export produces a byte-count preview and a `.cdx` download. The downloaded file is longer than eight bytes and starts with the CDX binary signature `VjCD0100`.
6. No page requests fail during the offline phase, and no external requests are observed across the browser context.

The test verifies offline document reload in an installed browser context. It does not simulate closing the entire browser process or clearing its persistent storage. The initial installation must complete online (including precaching the bundled WASM); no initial online chemistry conversion is required.
