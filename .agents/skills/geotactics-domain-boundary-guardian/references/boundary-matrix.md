# Boundary Matrix & Known Debt Baseline (DRONEPUNK)

## 1. Canonical Owners for Duplicate Basenames (7 Pairs)

| Basename | Canonical Owner | Duplicate / Shadow Copy | Resolution |
| :--- | :--- | :--- | :--- |
| `UnitHangarModal.tsx` | `@domains/economy` | `src/domains/world/components/UnitHangarModal.tsx` | Diff props -> migrate `WarLobbyHub.tsx` to `@domains/economy` -> delete copy in `world`. |
| `CommanderLivingVignette.tsx` | `@domains/game-feel` | `src/domains/world/components/CommanderLivingVignette.tsx` | Re-export / import from `@domains/game-feel` -> delete copy in `world`. |
| `TacticalGhostBar.tsx` | `@shared` (`src/shared/ui/`) | `src/domains/world/components/TacticalGhostBar.tsx` | Migrate imports to `@shared` -> delete copy in `world`. |
| `MapLoadingScreen.tsx` | `@domains/world` (or `@shared/ui`) | `src/domains/tactics/components/MapLoadingScreen.tsx` | Unify single loader component -> delete unused copy. |
| `reinforcementsEngine.ts` | `@domains/tactics` | `src/domains/tactics/core/reinforcementEngine.ts` | Merge `TacticalReinforcementEngine` and `CANONICAL_RESERVE_CATALOG` cleanly. |
| `stateSovereigntyTypes.ts` | `@shared` (`src/shared/types/`) | `src/domains/world/types/stateSovereigntyTypes.ts` | Keep SSOT in `@shared/types/` and re-export from `@domains/world`. |
| `tacticalRoadTypes.ts` | `@shared` (`src/shared/types/`) | `src/domains/world/types/tacticalRoadTypes.ts` | Keep SSOT in `@shared/types/` and re-export from `@domains/world`. |

## 2. Current `@shared -> @domains/*` Violations (Baseline: 6 alias + 11 relative)

- **Alias `@domains/` (6)**:
  1. `src/shared/auth/CommanderProfileModal.tsx:35` (`audioManager` from `@domains/game-feel`) -> inject callback prop.
  2. `src/shared/services/matchDatabaseService.ts:22` (`MatchFormat` from `@domains/tactics`) -> move type to `src/shared/types/`.
  3. `src/shared/services/playerDatabaseService.ts:12` (`IndustrialInventory, ActiveRefiningJob` from `@domains/economy`) -> move types to `src/shared/types/`.
  4. `src/shared/services/playerDatabaseService.ts:13` (`Clan, ClanMember, UserProfileIdentity` from `@domains/world`) -> move types to `src/shared/types/`.
  5. `src/shared/services/playerDatabaseService.ts:14` (`PlayerReserveStock, createInitialReserveStock` from `@domains/tactics`) -> move pure contract/factory to `src/shared/types/` or invert dependency.
  6. `src/shared/ui/MatchSummaryModal.tsx:3` (`audioManager` from `@domains/game-feel`) -> inject callback prop.
- **Relative `../../domains/` (11)**:
  - `src/shared/qa/QADevOpsRunner.tsx:21-31` -> inject test runner registry from `App.tsx` or move runner out of `src/shared/`.
