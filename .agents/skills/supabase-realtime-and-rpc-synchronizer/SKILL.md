---
name: supabase-realtime-and-rpc-synchronizer
description: Sincronizador de las 32 migraciones SQL (supabase/migrations/), CONSOLIDATED_FULL_DATABASE_DEPLOY.sql, database.types.ts, políticas RLS multi-tenant y canales Supabase Realtime / CDC (useMatchSync, useSiegeRealtime, stateSovereigntyService, spatialDeploymentService) en DRONEPUNK.
---

# Supabase Realtime, 32 Migrations & RPC Synchronizer (DRONEPUNK)

Mantiene sincronizadas las **32 migraciones SQL** (`supabase/migrations/`), `supabase/CONSOLIDATED_FULL_DATABASE_DEPLOY.sql`, `src/shared/types/database.types.ts` y los canales Realtime/servicios offline-resilient. *(Inventario de deuda y casts en `references/schema_and_type_debt.md`)*.

---

## 1. Árbol de Decisión / Heurística

1. **Desincronización Realtime (`useMatchSync` / `useSiegeRealtime` / CDC)**:
   - *Si* Broadcast (`match:${matchId}`) no llega o fuga canales → usar `supabase.removeChannel(channel)` (corregir `channel.unsubscribe()` en `useMatchSync.ts:51,174`); ante `CHANNEL_ERROR` / `TIMED_OUT` → disparar `requestStateResync()` (`rpc_reconnect_match_state`) y degradar a estado local.
   - *Si* Postgres Changes CDC (`territorial_battle_sessions`, `state_sovereignty`, `tactical_spatial_deployments`) no dispara → comprobar `ALTER PUBLICATION supabase_realtime ADD TABLE` (cuidado: `scripts/deploy_database.cjs` lo recorta) + `REPLICA IDENTITY FULL` + política RLS `FOR SELECT`; si el cliente lee `undefined` → mapear `snake_case` → `camelCase` (`useSiegeRealtime.ts:118`).
   - *Fallback*: si `!isSupabaseConfigured()` o falla red → mantener fallback en memoria/`localStorage`.
2. **Divergencia Migraciones vs Consolidado vs Tipos**:
   - *Si* `supabase/migrations/*.sql` no coincide con `CONSOLIDATED_FULL_DATABASE_DEPLOY.sql` → ejecutar `node scripts/rebuildConsolidatedDeploy.cjs`.
   - *Si* cambia catálogo → ejecutar `npm run sync:catalogs` (`catalogs.generated.ts`).
3. **Eliminación Segura de `(supabase as any)`** (`12` actuales):
   - *Si* tabla/RPC ya existe en `database.types.ts` (ej. `territorial_battle_sessions`) → reemplazar `supabase as any` por `supabase.from(...)` tipado y validar con `npm run lint`.
   - *Si* falta en `database.types.ts` (`state_sovereignty`, `tactical_spatial_deployments`, `tactical_fief_constructions`, `region_sovereignty`, `regions`, `system_catalog_manifest`, `settle_territorial_combat_losses`) → **declarar `Row/Insert/Update/Functions` antes** de retirar el cast.

---

## 2. Protocolo SQL & Invariantes Críticas

- Migraciones siempre idempotentes (`CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, `ENABLE ROW LEVEL SECURITY`, `DROP POLICY IF EXISTS` + `CREATE POLICY`).
- RBAC siempre contra `public.profiles` y `public.clan_members` (nunca `player_profiles`).
- Preservar restricciones: `user_unit_hangar` (`<= 16` chasis, `hp BETWEEN 1 AND 100`, `tier BETWEEN 1 AND 5`), P2P `2%` (`1%` burn + `1%` clan) + `VWAP ±25%`, liquidación `35% tech_scrap`, Handshake `120s`.

---

## 3. Oráculo y Bucle de Auto-Reparación

```powershell
node .agents/skills/supabase-realtime-and-rpc-synchronizer/scripts/audit_supabase_parity.cjs
npm run lint
npx tsx src/shared/lib/supabase/realtime.test.ts
npm run test:persistence
npm run test:spatial
npm run test:sovereignty
npm run test:catalogs
```
- **Oráculo**: `audit_supabase_parity.cjs` = `exit 0` (`0` migraciones faltantes en consolidado, `0` regresiones en casts/tablas/canales), `npm run lint` = `0` errores, `100% PASS` en tests Realtime/catálogos.
- **Auto-reparación**: Si falla paridad de consolidado → `node scripts/rebuildConsolidatedDeploy.cjs`; si falla `tsc` al quitar `as any` → completar `database.types.ts`.

---

## 4. Handoff Inter-Skill
- **Recibe de**: `metagame-economy-and-siege-simulator` (reglas P2P/Hangar/Asedio), `tactical-combat-and-ai-architect` (reconciliación/deltas), `webgl-cartography-and-spatial-architect` (esquema espacial).
- **Entrega a**: `geotactics-domain-boundary-guardian` (`database.types.ts` limpio en `@shared`), skills de dominio (hooks/servicios tipados) y `game-dev-quality-gate` / `game-qa-playtester`.
