# Domain Gate Routing Matrix (DRONEPUNK)

| Modified Path Pattern | Required Commands & Suites | Delegated Skill |
| :--- | :--- | :--- |
| `docs/**`, `*.md` | Verify links, dates vs `CHANGELOG.md` and `supabase/migrations/` count (skip `build` / `test:qa`). | `game-dev-quality-gate` |
| `src/domains/world/**`, `public/map/**` | `npm run lint`, `node scripts/verify-map-topology.mjs --json`, `npm run test:cartography`, `test:spatial`, `test:sovereignty`, `test:urban`, `test:persistence`, plus world orphans (`clanSystem`, `roadNetworkEngine`, `roadGarrisonEngine`, `spatialRoadIndex`, `strataAndSecession`, `vulnerabilityWindows`). If `TacticalWorldMap` or `WarLobbyHub` changed -> `npm run test:qa`. | `webgl-cartography-and-spatial-architect` |
| `src/domains/tactics/**` | `npm run lint`, `npm run test:all`, `npm run test:e2e`, plus tactics orphans (`combat`, `coSystem`, `aiBot`, `fogOfWar`, `pathfinding`, `rankedLadderEngine`, `tacticalRtsEngine`, `mapImporter`, `mapBuilder`). | `tactical-combat-and-ai-architect` |
| `src/domains/economy/**` | `npm run lint`, `npm run test:catalogs`, `test:hangar`, `test:strategic`, `test:sprint3`, plus economy orphans (`industrialEngine`, `turnEconomy`, `fiefBuildingService`). | `metagame-economy-and-siege-simulator` |
| `src/domains/game-feel/**` | `npm run lint`, `npm run test:interface`, `npx tsx src/domains/game-feel/__tests__/barkEngine.test.ts`, `audit-no-mock.ps1`. | `tactical-command-intel` |
| `supabase/**`, `src/shared/types/database.types.ts` | `audit_supabase_parity.cjs`, `npm run lint`, `npx tsx src/shared/lib/supabase/realtime.test.ts`, `test:persistence`, `test:catalogs`. | `supabase-realtime-and-rpc-synchronizer` |
| `src/shared/**`, `src/App.tsx`, `vite.config.ts`, or `>= 2` domains | **Full-Gate**: `auditBoundaries.cjs`, `run_quality_gate.cjs --mode=full`, `npm run test:qa`, `tests/e2e/startup-audit.spec.ts`. | `geotactics-domain-boundary-guardian` + `game-qa-playtester` |
