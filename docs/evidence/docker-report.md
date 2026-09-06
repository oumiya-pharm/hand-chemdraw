# English README and Docker startup

Verified on 2026-09-06 with Docker Desktop on macOS/arm64, Docker CLI 29.6.1, and Compose 5.3.0.

## Changes

- Added `README.en.md` covering all Japanese README sections, with language links in both files. Japanese UI labels remain in the English instructions for reference.
- Added a multistage Dockerfile: `node:24-alpine` builds with `npm ci` and `npm run build`; `nginx:stable-alpine` serves only the resulting static app, including the chemistry Worker and WASM.
- Added Compose startup at `127.0.0.1:8080`, configurable through `TE_PORT`, and an HTTP health check. No host Node.js installation or database is needed to start the app.
- HTML and the Service Worker revalidate over HTTP; hashed assets use immutable caching. Existing Service Worker activation still requires reloading and reopening the app tabs after an update.
- Documented startup, shutdown, rebuilds, port changes, and note transfer when the URL origin changes. Local `.env` files are ignored by Git and excluded from the image build context.
- Made the existing production offline browser test accept `TE_TEST_URL`, so it can verify a running Docker instance without starting Vite.

## Results

- `docker compose config --quiet`: passed. `TE_PORT=8081` resolves to host port 8081 on loopback.
- `docker compose up --build -d`: passed, including dependency installation and TypeScript/Vite compilation inside Linux/arm64.
- `docker compose ps`: service reported healthy at `127.0.0.1:8080`.
- `docker compose exec -T app nginx -t`: passed.
- HTTP checks: app marker and `no-cache` on the entry point; JavaScript MIME and `no-cache` on `sw.js`; all six precached resources return 200; WASM returns `application/wasm`; hashed assets have immutable caching; a missing WASM file returns 404.
- `TE_TEST_URL=http://127.0.0.1:8080 npx playwright test --config playwright.production.config.ts`: **1 passed**. The browser reloads offline, draws benzene, generates SMILES, and downloads a valid CDX without external requests or failed requests.
- The same production test without `TE_TEST_URL` against the existing Vite preview on port 4173: **1 passed**.
- `npm test`: **214 passed**.
- Both README files' relative Markdown links resolve locally.

The image build was exercised on Linux/arm64. No fixed platform is imposed in the Dockerfile or Compose file; an amd64 build was not run in this verification.
