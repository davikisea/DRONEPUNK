# Tactics Calibration Matrix (`@domains/tactics`)

## 1. Known Calibration Debt (1–100 HP & Chart Parity)
- `coSystem.ts:587` (`kindle` COP *Urban Blight*): uses `u.hp - 3` without `scaleHpValue(u, 3)`.
- `coSystem.ts:1238-1249` (`COEngine.getCapturePoints`): returns `soldierHp` instead of `Math.ceil(soldierHp / 10)` on 100-HP scale.
- `coSystem.ts:1084-1168` (`COEngine.getCombatModifiers`): ignores `defenderCo.coId` Day-to-Day (`kanbei +20% def`, `grimm -20% def`, `sturm +20% def`, `von_bolt +10% def`); only 12/29 COs have modifier branches.
- `canonicalCombat.ts:232,237`: counterattack mixes `defenseModifier` / `attackModifier` polarities.
- `combat.ts:163-177`: omits forwarding `weather`, `coId`, `tiers`, `buildingAuraModifiers`, `scale100Hp` and keeps a legacy 12-unit `COMBAT_EFFECTIVENESS_MATRIX`.
- `canonicalDamageChart.ts:225,415`: `fighterWeaponry` omits `t_copter`; `isIndirectFireUnit` checks `'missile'` instead of `'missiles'`.
- `fogOfWar.ts`: `CANONICAL_UNIT_BASE_VISION` lists 12/16 archetypes (missing `neotank`, `apc`, `t_copter`, `missiles`).
- `reinforcementsEngine.ts:28-113`: `CANONICAL_RESERVE_CATALOG` sets `maxHp: 10` instead of `100`.
- **Internal duplicate**: `reinforcementEngine.ts` vs `reinforcementsEngine.ts` both exported in `src/domains/tactics/index.ts`.

## 2. Garrison AI Tiers (`GarrisonAIEngine.GARRISON_TIER_SPECS`)
- **Nv.1 (`common_garrison`)**: 1-ply Greedy, Tier 1, no SCOP.
- **Nv.2 (`uncommon_garrison`)**: 2-ply Heuristic, up to Tier 2.
- **Nv.3 (`rare_garrison`)**: 3-ply Minimax, up to Tier 3.
- **Nv.4 (`epic_garrison`)**: 4-ply Alpha-Beta, up to Tier 4, COP/SCOP enabled.
- **Nv.5 (`legendary_mcts`)**: Hybrid Alpha-Beta + MCTS-UCT + Heatmaps, up to Tier 5, full SCOP.

## 3. Orphaned Suites in `src/domains/tactics/__tests__/` (Not in `package.json`)
`aiBot.test.ts`, `combat.test.ts`, `coSystem.test.ts`, `fogOfWar.test.ts`, `mapImporter.test.ts`, `pathfinding.test.ts`, `rankedLadderEngine.test.ts`, `tacticalRtsEngine.test.ts` (plus `e2eIntegration.test.ts` excluded from `test:all`).
