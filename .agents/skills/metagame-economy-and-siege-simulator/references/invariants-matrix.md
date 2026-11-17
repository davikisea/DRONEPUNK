# Metagame Economy & Siege Invariants Matrix (DRONEPUNK)

## 1. SSOT Constants (`src/shared/types/metagame.ts`)
- **Pilar 1 (Hangar Físico, 0 Cartas)**: `MAX_PHYSICAL_HANGAR_CAPACITY = 16` (`4` vanguardia + `12` reserva). Kit F2P (`infantry` T1, `recon` T1): `0s` forja, `0 EC`, sin baja permanente (`1000G`/`4000G` in-match).
- **Pilar 2 & 3**: `CANONICAL_MAX_HP = 100`, curación `+20 HP` en propiedad aliada (`turnEconomy.ts`), derrota inmediata a `0` tropas.
- **Pilar 4**: Tiers `T1–T5` (`+2%`/tier).
- **Pilar 5**: Capital `15,000 TCP` / Estándar `10,000 TCP`; Buff Capital: `+5%` regional, `+15% EC` y `+10%` velocidad de forja nacional.
- **Pilar 6**: `RECYCLE_SCRAP_RATE = 0.35` (`35% tech_scrap`, `65%` sumidero); transmutación `40 tech_scrap + 20 raw_rare_earth -> 1 refined_microchip` (`industrialEngine.ts`).
- **Pilar 7**: `HANDSHAKE_TIMEOUT_SECONDS = 120` (`120,000 ms`), IA Guarnición `Nv.1–5`, escudo `4h`, gracia `24h` De Facto → De Jure.
- **Finanzas P2P**: `TOTAL_P2P_TAX_RATE = 0.02` (`1%` Burn + `1%` Regalía Clan), `VWAP_COLLAR_PERCENT = 0.25` (`±25%`).
- **10 Parcelas & Soft Cap**: Parcelas `1–2` iniciales, `3–10` desbloqueables; ciclo `12h` + `4h` gracia + merma `1.5%/h` (piso `60%`, `70%` varado). Soft cap `14` unidades (`-$200G`/t desde unidad `15`).

## 2. Known Engine/UI Drifts to Sanitize
- `industrialEngine.ts:335,1071-1078`: `MARKET_TAX_RATE = 0.12` (12%) and `calculatePriceCollars` (`±35%`) diverge from `metagame.ts` (`0.02` / `±25%`).
- `useUserHangar.ts` & `UnitHangarModal.tsx`: don't enforce `MAX_PHYSICAL_HANGAR_CAPACITY = 16`, use local `UNIT_CATALOG`, and battlegroup limits diverge (`4` spec vs `/6` modal vs `3` hook).
- `tcpDelta` diverges between `metagame.ts` (`3500`), `territorialSiegeOrchestrator.ts` (`800..2500`) and `tacticalCombatSeamlessIntegration.ts` (`1500`).
