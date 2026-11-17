# Schema & Type Debt Reference (`supabase/` & `database.types.ts`)

## 1. Missing Tables & RPCs in `src/shared/types/database.types.ts` (Baseline)
- **Missing Tables (6)**: `state_sovereignty`, `tactical_spatial_deployments`, `tactical_fief_constructions`, `region_sovereignty`, `regions`, `system_catalog_manifest`.
- **Missing RPCs**: `settle_territorial_combat_losses`.

## 2. Exact `(supabase as any)` Casts (12 Locations)
1. `src/domains/world/hooks/useSiegeRealtime.ts:154,209,242` (`territorial_battle_sessions`, `region_sovereignty`)
2. `src/domains/world/hooks/useTerritoryMap.ts:81` (`regions`, `region_sovereignty`)
3. `src/domains/world/services/spatialDeploymentService.ts:169,200,469,557` (`tactical_spatial_deployments`, `tactical_fief_constructions`)
4. `src/domains/world/services/stateSovereigntyService.ts:167,418` (`state_sovereignty`)
5. `src/shared/services/catalogRegistryService.ts:118,134` (`system_catalog_manifest`)

## 3. Known Realtime & Deploy Caveats
- `src/domains/tactics/hooks/useMatchSync.ts:51,174`: calls `channel.unsubscribe()` instead of `supabase.removeChannel(channel)`.
- `src/domains/world/hooks/useSiegeRealtime.ts:118`: assigns `payload.new as TerritorialBattleSession` without snake_case (`region_id`, `handshake_expires_at`) -> camelCase mapping.
- `scripts/deploy_database.cjs:36-37`: strips `ALTER PUBLICATION supabase_realtime ADD TABLE ...` during scripted deploy.
