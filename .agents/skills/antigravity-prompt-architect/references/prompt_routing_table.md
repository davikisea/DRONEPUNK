# Prompt Routing Table & 5-Block Template (DRONEPUNK)

## 1. Skill Routing & Verification Scripts

| Scope / Path Pattern | Skill(s) to Anchor | Exact Verification Scripts |
| :--- | :--- | :--- |
| `src/domains/*/index.ts`, `src/App.tsx`, `vite.config.ts`, `src/shared/` | `geotactics-domain-boundary-guardian` | `auditBoundaries.cjs`, `npm run lint`, `npm run build` |
| `supabase/**`, `database.types.ts`, `useMatchSync.ts`, `useSiegeRealtime.ts` | `supabase-realtime-and-rpc-synchronizer` | `audit_supabase_parity.cjs`, `npm run test:persistence`, `npm run test:catalogs` |
| `TacticalWorldMap.tsx`, `coordinates.ts`, `tacticalBitmap.ts`, `public/map/*` | `webgl-cartography-and-spatial-architect` | `verify-map-topology.mjs --json`, `audit_webgl_antipatterns.mjs`, `npm run test:cartography` |
| `src/domains/tactics/**`, `CombatTheaterView.tsx` | `tactical-combat-and-ai-architect` | `audit_tactics_invariants.ts --run-tests`, `npm run test:combat`, `npm run test:seamless` |
| `src/domains/economy/**`, `metagame.ts`, `territorialSiegeOrchestrator.ts` | `metagame-economy-and-siege-simulator` | `auditEconomyInvariants.ts`, `npm run test:geotactics`, `npm run test:catalogs` |
| `src/domains/game-feel/**`, HUD/Modals C4ISR | `tactical-command-intel` | `audit_command_intel.cjs`, `npx tsx src/domains/game-feel/__tests__/barkEngine.test.ts` |
| Chromium / Playwright / `__TACTICAL_QA_BRIDGE__` | `game-qa-playtester` | `npm run test:qa`, `parse_qa_report.cjs` |
| Final closure / Release / `docs/` + `CHANGELOG.md` | `game-dev-quality-gate` | `run_quality_gate.cjs --mode=full` |

## 2. Extended 5-Block Prompt Template

```markdown
[COMANDO SLASH]
- **Skill(s) Ancladas**: `<skill-1>`, `game-dev-quality-gate`
- **Topología**: `Secuencial` | `Paralelo (dominios disjuntos)`

## 1. Objetivo y Resultado Esperado
## 2. Anclaje de Contexto (@Mentions verificadas en disco)
## 3. Protocolo de Ejecución (1. Read-Only -> 2. Modular -> 3. Docs)
## 4. Restricciones e Invariantes (solo las aplicables al foco)
## 5. Bucle de Verificación Determinista (scripts reales de package.json / skills)
```
