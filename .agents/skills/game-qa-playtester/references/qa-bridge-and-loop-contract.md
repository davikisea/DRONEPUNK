# QA Bridge & Closed-Loop E2E Contract (`window.__TACTICAL_QA_BRIDGE__`)

## 1. Real Bridge Surface (`src/shared/utils/qaHarness.ts` + `src/App.tsx:760-783`)
- **Snapshot fields (`QAGameSnapshot`)**:
  - Dynamically updated by `App.tsx`: `isReady`, `activeScreen` (`'lobby' | 'game'`), `turnNumber`, `activePlayer`, `unitsCount`, `canvasRendered`, `lastError`.
  - Currently static defaults in `qaHarness.ts`: `fps` (`60`), `phase` (`'INITIALIZING'`).
- **Methods**: `getSnapshot()`, `updateSnapshot(partial)`, `getConsoleErrors()`, `clearErrors()`, `ping()` (`'PONG_TACTICAL_QA_ACTIVE'`), plus injected `launchCombat()`, `setMainNav(nav)`, `openLoadingScreen()`, `dismissLoadingScreen()`.
- **Map globals (`TacticalWorldMap.tsx`)**: `window.__TACTICAL_MAP_INSTANCE__`, `window.__SET_TACTICAL_ZOOM__(z)`.

## 2. Playwright Configuration Note
- `playwright.config.ts`: exports JSON to `test-results/qa-run-report.json` and HTML to `playwright-report/` (note: `package.json` `test:qa:report` points to `test-results/html-report`).
- `setupSupabaseMocks(page)` in `tests/e2e/game-playtester.spec.ts` currently mocks 5 tables (`state_sovereignty`, `tactical_spatial_deployments`, `tactical_fief_constructions`, `system_catalog_manifest`, `territorial_vulnerability_windows`).
- `tests/e2e/startup-audit.spec.ts` captures multi-viewport screenshots + console/network JSON, currently without `expect()` assertions.

## 3. Closed-Loop Beta E2E Checklist (Capa 1 -> Capa 2)
1. Boot -> `WarLobbyHub` (`map-first-shell`, `24 REG_VE_*` + `7 BUF_*`, `0` external tiles).
2. `dock-btn-industry` (`IndustrialComplexView.tsx`, 10 plots) & `dock-btn-armory` (`UnitHangarModal.tsx`, 16 chassis).
3. Siege declaration -> `TerritorySiegeModal.tsx` (Handshake `120s`) -> `PreBattleDeploymentModal.tsx`.
4. `CombatTheaterView.tsx` (`activeScreen === 'game'`, `1–100 HP`, `canvas.maplibregl-canvas` still `attached` via Zero-Unmount).
5. End condition (`0` units / HQ capture) -> `65%` sink / `35% tech_scrap` -> `activeScreen === 'lobby'`.
