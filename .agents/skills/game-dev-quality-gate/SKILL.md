---
name: game-dev-quality-gate
description: Orquestador de cierre y calidad total en DRONEPUNK: lint, build, suites deterministas (test:all, test:geotactics, test:catalogs, 47/47 *.test.ts), fronteras, E2E Playwright (test:qa) y sincronía de docs/ y CHANGELOG.md.
---

# Game Dev Quality Gate & Audit Sentinel (DRONEPUNK)

Orquesta la validación post-implementación por alcance real (`fast-path` vs `full-gate`), evitando falsos positivos de scripts que retornan `exit 0` y cubriendo las **47** suites `*.test.ts` de `src/`. *(Tabla de enrutamiento completa en `references/domain_gate_matrix.md`)*.

---

## 1. Árbol de Decisión por Diff (`git diff`)

Antes de ejecutar comandos, clasifica qué cambió:
- **Solo `docs/**` o `*.md`** → *Doc-Only Gate*: validar enlaces/fechas y omitir `build` / `test:qa`.
- **1 dominio (`world`, `tactics`, `economy`, `game-feel`)** → *Domain Gate*: `npm run lint` + scripts/suites del dominio (incluyendo sus suites huérfanas de `package.json`, ver `references/domain_gate_matrix.md`). *Si* toca `TacticalWorldMap`, `WarLobbyHub` o `CombatTheaterView` → añadir `npm run test:qa`.
- **`supabase/**` o `database.types.ts`** → *DB Gate*: `audit_supabase_parity.cjs` + `npm run lint` + `realtime.test.ts` + `test:catalogs`.
- **`src/shared/**`, `src/App.tsx`, `vite.config.ts` o `>= 2` dominios** → *Full-Gate*: `run_quality_gate.cjs --mode=full` (`47/47` suites + `lint` + `build` + topología) + `npm run test:qa` + `startup-audit.spec.ts`.
- **Fallback de bloqueo**: *Si* fallan fronteras o `tsc` → **detener** Fase E2E y reparar primero.

---

## 2. Oráculo Binario y Bucle de Auto-Reparación

```powershell
node .agents/skills/game-dev-quality-gate/scripts/run_quality_gate.cjs --mode=audit
# Para cierre completo:
node .agents/skills/game-dev-quality-gate/scripts/run_quality_gate.cjs --mode=full
powershell -ExecutionPolicy Bypass -File scripts/audit-no-mock.ps1
```
- **Oráculo (`PASS` binario)**:
  1. `npx tsc --noEmit` = `exit 0` y `npm run build` = `exit 0` (si aplica).
  2. `run_quality_gate.cjs` = `exit 0` (`0` regresiones en `@shared`, `0` legacy, `0` migraciones faltantes en consolidado, `0` suites fallidas).
  3. `audit-no-mock.ps1` = `exit 0`.
  4. Si aplica E2E: `test-results/qa-run-latest.json` con `fatalErrorsCount === 0` y `networkFailures.length === 0`.
  5. Si cambió arquitectura/DB/contratos: `docs/00_*`, `docs/DIAGNOSTICO_*` y `CHANGELOG.md` sincronizados.
- **Auto-reparación (máx. 2 ciclos)**: aislar suite fallida (`npx tsx <ruta>.test.ts`), delegar a la skill propietaria y re-ejecutar gate.

---

## 3. Handoff Inter-Skill (Delegación ante Fallo)

- Fronteras `@shared` / barriles / `App.tsx` → `geotactics-domain-boundary-guardian`
- SQL / 32 migraciones / `database.types.ts` / Realtime → `supabase-realtime-and-rpc-synchronizer`
- WebGL Zero-Raster / MapLibre / topología → `webgl-cartography-and-spatial-architect`
- Balística `1–100 HP` / 29 COs / IA Nv.1–5 → `tactical-combat-and-ai-architect`
- Hangar 16 chasis / 10 parcelas / P2P `2%` / Handshake `120s` → `metagame-economy-and-siege-simulator`
- UI C4ISR / Bark / `audioManager` → `tactical-command-intel`
- E2E Chromium / Playwright → `game-qa-playtester`

Solo tras `PASS` binario emite el **Quality Gate Release Card** con métricas verificadas.
