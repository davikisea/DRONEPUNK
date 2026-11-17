---
name: tactical-combat-and-ai-architect
description: Arquitecto del motor táctico por turnos @domains/tactics de DRONEPUNK: combate determinista 1-100 HP, CANONICAL_DAMAGE_CHART, 29 COs, IA de Guarnición Nv.1-5, niebla, capturas y reconexión Capa 1 -> Capa 2 (CombatTheaterView y useMatchSync).
---

# Tactical Combat, 29 COs & Garrison AI Architect (`@domains/tactics`)

Gobierna el dominio táctico de **DRONEPUNK**, asegurando determinismo balístico `1–100 HP`, paridad de los 16 arquetipos y 29 COs, y la reconexión viva Capa 1 → Capa 2. *(Deuda de calibración y matriz IA Nv.1–5 en `references/tactics_calibration_matrix.md`)*.

---

## 1. Invariantes Balísticas & Frontera Hexagonal

- **Aislamiento**: `core/` **no importa** MapLibre GL; solo `tacticalCombatSeamlessIntegration.ts` consume `ZOOM_*` y `TacticalBitMap` de `@domains/world`.
- **Escala `1–100 HP`** (`CANONICAL_MAX_HP = 100`), **0 tropas = derrota inmediata** (`hqCaptureVictory.ts`), **Tiers `T1–T5` (`+2%`/tier, paridad `T1` en torneo)**, **Doble Llave** (`$G` + chasis salvo `infantry`/`recon` T1) y **35% `tech_scrap`**.

---

## 2. Árbol de Decisión / Heurística

1. **Bug Balístico / Escala `1–100 HP`**:
   - *Si* un poder de CO muta `hp` directamente → exigir `scaleHpValue(u, base10)` y normalizar captura con `Math.ceil(hp / 10)`.
   - *Si* `CombatEngine.calculateDamage` ignora clima/CO/tiers → reenviar `CanonicalCombatOptions` completo a `CanonicalCombatEngine.calculateEngagement`.
   - *Si* el contraataque invierte polaridades con COs asimétricos → separar `attackerAttackMod/DefenseMod` y `defenderAttackMod/DefenseMod`.
   - *Si* falla daño vs `neotank`/`apc`/`t_copter`/`missiles` → auditar `CANONICAL_DAMAGE_CHART` y `isIndirectFireUnit('missiles')`.
2. **Fog of War en Fuego Indirecto**:
   - *Si* `isIndirectFireUnit(code)` ataca → exigir destino en `visibleTileKeys` (y `revealedEnemyUnitIds` si es `forest`/`reef`) + cobertura 16/16 en `CANONICAL_UNIT_BASE_VISION`.
3. **IA de Guarnición Nv.1–5 (`garrisonAIEngine.ts`)**:
   - *Si* el bot excede tier o profundidad → contrastar contra `GarrisonAIEngine.getSpec(level)`; si `remainingChassisCount < 25%`, validar `checkAttritionDowngrade`.
4. **Transición Capa 1 → Capa 2**:
   - Verificar secuencia: `validateDoubleKeyDeployment` → `PreBattleDeploymentModal` → `resolveSemanticLOD(zoom)` → `CombatTheaterView` + `useMatchSync`. *Fallback*: si `evaluateDefensiveHandshake` expira (`120s`), conmutar a `pve_garrison`.

---

## 3. Oráculo y Bucle de Auto-Reparación

```powershell
npx tsx .agents/skills/tactical-combat-and-ai-architect/scripts/audit_tactics_invariants.ts --run-tests
npm run test:combat
npm run test:seamless
```
- **Oráculo**: `18/18` suites de `tactics/__tests__` en `PASS`, `16/16` arquetipos cubiertos y `0` regresiones en escala `1–100 HP` (usar `--strict` para exigir `0` deuda).
- **Auto-reparación**: Si falla escala `1–100 HP` → aplicar `scaleHpValue`/`Math.ceil(hp/10)` y re-correr `coSystem.test.ts` + `combat.test.ts`.

---

## 4. Handoff Inter-Skill
- **Recibe de**: `webgl-cartography-and-spatial-architect` (`zoom`, `TacticalBitMap`) y `metagame-economy-and-siege-simulator` (stock hangar, Handshake `120s`).
- **Entrega a**: `supabase-realtime-and-rpc-synchronizer` (`useMatchSync`, `BattleSettlementEvent`), `tactical-command-intel` (eventos `¡TRAP!`, COP/SCOP, `1–100 HP`) y `game-dev-quality-gate`.
