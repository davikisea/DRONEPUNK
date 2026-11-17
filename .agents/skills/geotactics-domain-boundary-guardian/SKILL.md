---
name: geotactics-domain-boundary-guardian
description: Guardiana de fronteras @domains/* y @shared en DRONEPUNK: barriles index.ts, auditoría con scripts/auditBoundaries.cjs, deduplicación entre dominios, modularización de App.tsx y chunking Vite.
---

# Domain Boundary Guardian & Modularity Architect (DRONEPUNK)

Garantiza el aislamiento estricto de `@domains/world`, `@domains/tactics`, `@domains/economy`, `@domains/game-feel` y `@shared`, previniendo fugas de frontera, homónimos duplicados y crecimiento monolítico de `src/App.tsx`.

---

## 1. Mapa de Soberanía (`tsconfig.json`)

| Alias | Ruta | Responsabilidad |
| :--- | :--- | :--- |
| **`@domains/world`** | `src/domains/world/` | Cartografía WebGL (`TacticalWorldMap`), coordenadas $O(1)$, `TacticalBitMap`, red vial $A^*$, `politicalAliceEngine`, asedios 120s, clanes. |
| **`@domains/tactics`** | `src/domains/tactics/` | Motor balístico `1–100 HP`, `CANONICAL_DAMAGE_CHART`, 29 COs, IA Guarnición Nv.1–5, niebla, refuerzos, `CombatTheaterView`. |
| **`@domains/economy`** | `src/domains/economy/` | Hangar 16 chasis, 10 parcelas (`industrialEngine`), forja `T1–T5`, upkeep, ticker, Mercado P2P 2%. |
| **`@domains/game-feel`** | `src/domains/game-feel/` | `audioManager`, `barkEngine` (29 COs + Stella), `CommanderBarkWidget`, `CommanderLivingVignette`, `hapticFeedback`. |
| **`@shared`** | `src/shared/` | Cliente Supabase, contratos SSOT (`metagame.ts`, `database.types.ts`), auth, servicios DB transversales, `TacticalGhostBar`, `qaHarness`. |

---

## 2. Árbol de Decisión / Heurística

1. **Violación `@shared -> @domains/*`** (alias o relativo `../domains/`):
   - *Si* el símbolo es `type`/`interface` → mover a `src/shared/types/` y re-exportar desde `@shared` y `@domains/<x>`.
   - *Si* es efecto UI/audio (`audioManager`) → inyectar callback opcional (`onPlaySfx?: ...`) desde el contenedor padre; si se usa en `>3` sitios sin prop, registrar adaptador mínimo en `src/shared/contracts/`.
   - *Si* es fábrica pura (`createInitialReserveStock`) → si no depende de estado de dominio, mover a `src/shared/types/`; si depende, invertir dependencia por parámetro.
   - *Si* está en `src/shared/qa/QADevOpsRunner.tsx` → inyectar registro de suites desde `App.tsx` o mover fuera de `@shared`.
2. **Deep-Import (`@domains/<x>/subruta`)**:
   - *Si* está en `src/domains/<x>/index.ts` → reescribir a `@domains/<x>`.
   - *Si no* → añadir `export { ... }` en `index.ts` y reescribir. *Fallback si crea ciclo*: extraer sub-contrato a `src/shared/types/`.
3. **Homónimos Duplicados** (ver tabla de dueños en `references/boundary-matrix.md`):
   - *Si* idénticos → eliminar copia no canónica y apuntar imports al barril dueño.
   - *Si* difieren → hacer superset de props en el dueño canónico, migrar consumidores y eliminar copia.
4. **Descompresión de `src/App.tsx`** (`3,092` líneas, `73` `useState`):
   - *Si* bloque tiene `>= 3` `useState` cohesivos + `useEffect` → extraer a `use<Feature>Controller.ts` en su dominio.
   - *Si* modal inline `> 80` líneas JSX → extraer a `@domains/<dueño>` con `React.lazy`.
   - *Fallback si `vite build` emite `[INEFFECTIVE_DYNAMIC_IMPORT]`*: verificar que no haya import estático concurrente en `App.tsx`.

---

## 3. Oráculo y Bucle de Auto-Reparación

```powershell
node .agents/skills/geotactics-domain-boundary-guardian/scripts/auditBoundaries.cjs
node scripts/checkLegacyImports.cjs
npx tsc --noEmit
npm run build
```
- **Oráculo**: `auditBoundaries.cjs` = `exit 0` (`0` deep-imports, `0` regresiones en `@shared` o `App.tsx`), `checkLegacyImports.cjs` = `0` legacy, `tsc` = `exit 0`, `build` = `0` `[INEFFECTIVE_DYNAMIC_IMPORT]`. (Usar `--strict` cuando se busque `0` deuda absoluta).
- **Auto-reparación**: Si falla `tsc` tras mover tipos → añadir re-export en `index.ts`; si falla `build` por chunking → aislar import dinámico.

---

## 4. Handoff Inter-Skill
- **Recibe de**: `game-dev-quality-gate` y skills de dominio ante creación/movimiento de archivos.
- **Entrega a**: `tactical-command-intel`, `webgl-cartography-and-spatial-architect`, `tactical-combat-and-ai-architect`, `metagame-economy-and-siege-simulator`, `supabase-realtime-and-rpc-synchronizer` (contratos limpios) y `game-dev-quality-gate` (frontera verde para habilitar E2E).
