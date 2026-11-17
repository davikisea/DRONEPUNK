---
name: game-qa-playtester
description: Agente de Playtesting E2E y QA Multimodal para DRONEPUNK. Ejecuta Chromium con Playwright (test:qa y startup-audit.spec.ts), inspecciona window.__TACTICAL_QA_BRIDGE__, audita WebGL Zero-Raster y valida el bucle cerrado Capa 1 -> Capa 2.
---

# Game QA Playtester — Manual Operativo (DRONEPUNK)

Ejecuta playtesting E2E en Chromium con Playwright, clasifica fallos desde `test-results/` y valida el bucle cerrado Capa 1 → Capa 2. *(Contrato completo de `__TACTICAL_QA_BRIDGE__` y checklist Beta en `references/qa-bridge-and-loop-contract.md`)*.

---

## 1. Árbol de Triage ante Fallos Playwright

- **Pantalla Negra / `DEFCON-1` (`TacticalErrorBoundary`)**:
  - *Si* `fatalErrors` contiene `SyntaxError` / `does not provide an export` → fallo de barril `@domains/*/index.ts` (derivar a `geotactics-domain-boundary-guardian`).
  - *Fallback*: si `networkFailures` > 0 en `/rest/v1/*` o `/rpc/*` → añadir ruta en `setupSupabaseMocks(page)`.
- **Timeout o `strict mode violation`**:
  - *Si* `strict mode violation` → usar `getByTestId(...)` o scoping al contenedor (`unified-region-inspector`).
  - *Si* expira espera de `[data-region-id^="REG_VE_"]` → usar `/?no-splash=1` y comprobar `bridge.getSnapshot().activeScreen === 'lobby'`.
- **Pointer Interception (clic bloqueado)**:
  - *Si* `CommanderBarkWidget` o modal intercepta clics → revisar `z-index` y bounding boxes (`1280x720`, `1920x1080`) o cerrar con `Escape`; prohibido enmascarar botones HUD con `dispatchEvent('click')`.
- **Fallo WebGL / Zero-Raster**:
  - *Si* `canvasRendered === false` o `isStyleLoaded() === false` → verificar 7 GeoJSON en `public/map/`, `/maplibre-gl-worker.mjs` y `0` URLs externas.
- **Fallo Transición Capa 1 → Capa 2**:
  - *Si* `activeScreen` no cambia a `'game'` tras `PreBattleDeploymentModal` → inspeccionar `bridge.getConsoleErrors()`, `handleStartMatchFromLobby` en `App.tsx` y confirmar que `canvas.maplibregl-canvas` siga `attached` (*Zero-Unmount*).

---

## 2. Oráculo y Bucle de Auto-Reparación

```powershell
npm run test:qa
npx playwright test tests/e2e/startup-audit.spec.ts
node .agents/skills/game-qa-playtester/scripts/parse_qa_report.cjs
```
- **Oráculo (`PASS_CLEAN`)**: `rootMounted === true`, `ping() === 'PONG_TACTICAL_QA_ACTIVE'`, `fatalErrorsCount === 0` (filtrando únicamente ruido `AudioContext` en headless), `networkFailuresCount === 0`, `externalTileRequests === 0`, `24` regiones + `7` buffers, `0` solapamientos HUD y `parse_qa_report.cjs` = `exit 0`.
- **Auto-reparación**: Si falla mock/red → actualizar `setupSupabaseMocks`; si falla selector/layout → corregir `data-testid`/`z-index`; si falla lógica de dominio → delegar con evidencia JSON/screenshot sin parchear el test.

---

## 3. Handoff Inter-Skill
- **Recibe de**: `game-dev-quality-gate` y skills de dominio (`world`, `tactics`, `economy`, `game-feel`).
- **Entrega a**: `geotactics-domain-boundary-guardian` (imports), `webgl-cartography-and-spatial-architect` (capas/Zero-Raster), `tactical-command-intel` (solapamientos HUD), `supabase-realtime-and-rpc-synchronizer` (mocks/RPC), `tactical-combat-and-ai-architect` (Capa 2) y `game-dev-quality-gate` (`PASS_CLEAN`).
