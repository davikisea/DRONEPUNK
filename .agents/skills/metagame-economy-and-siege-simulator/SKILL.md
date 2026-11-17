---
name: metagame-economy-and-siege-simulator
description: Arquitecto y simulador determinista de los 7 Pilares Canónicos, 10 parcelas por feudo, Hangar Físico de 16 tropas (CERO cartas), Mercado Libre P2P (2% = 1% Sink + 1% Clan, VWAP ±25%) y Asedio con Handshake de 120s en DRONEPUNK.
---

# Metagame Economy, Industrial Forge & Siege Balance Architect (DRONEPUNK)

Protege el equilibrio matemático de los **7 Pilares Canónicos + Regla P2P 2%** entre `@domains/economy`, `@domains/world`, `@domains/tactics` y `src/shared/types/metagame.ts`. *(Tabla SSOT y derivas conocidas en `references/invariants-matrix.md`)*.

---

## 1. Árbol de Decisión / Heurística

1. **Exploit Inflacionario (Forja vs 35% `tech_scrap`)**:
   - *Si* `scrapReturn >= forgeCost` en cualquier `(unitCode, tier 1..5)` o F2P `T1` retorna `scrap > 0` → bloquear y alinear con `calculateUnitProductionCost` + `RECYCLE_SCRAP_RATE = 0.35`. *Fallback en hangar*: derivar coste desde `strategicAndProductionEngine.ts` y escalar por `quantity`.
2. **Violación P2P (`2%` / `VWAP ±25%`)**:
   - *Si* `MARKET_TAX_RATE !== 0.02` o collar `!== ±0.25` (ej. `industrialEngine.ts` con `0.12` / `±0.35`) → reemplazar por `MASTER_METAGAME_CONSTANTS` y `calculateP2PTransactionSplit`. *Si* UI anuncia NPC Market Maker → alinear con estado `stranded`.
3. **Desborde de Hangar (`16` Chasis & Battlegroup)**:
   - *Si* `sum(quantity) + craftQuantity > MAX_PHYSICAL_HANGAR_CAPACITY (16)` → rechazar forja antes de mutar DB. Unificar límite de vanguardia (`4` activas + `12` reserva).
4. **Asedio / Handshake `120s` / TCP**:
   - *Si* `handshakeExpiresAt - createdAt !== 120_000` o se acepta tras expirar → forzar `resolveHandshakeTimeout` a `pve_garrison`. Unificar `tcpDelta` en `calculateSiegeTcpDelta` como SSOT.

---

## 2. Oráculo y Bucle de Auto-Reparación

```powershell
npx tsx .agents/skills/metagame-economy-and-siege-simulator/scripts/auditEconomyInvariants.ts
npm run test:catalogs
npm run test:geotactics
npx tsx src/domains/economy/__tests__/industrialEngine.test.ts
npx tsx src/domains/economy/__tests__/turnEconomy.test.ts
npx tsx src/domains/economy/__tests__/fiefBuildingService.test.ts
npx tsx src/domains/world/__tests__/vulnerabilityWindows.test.ts
```
- **Oráculo**: `auditEconomyInvariants.ts` = `exit 0` (`0` exploits inflacionarios, `0` derivas con `MASTER_METAGAME_CONSTANTS`; `--strict` para `0` deuda), `100% PASS` en suites económicas/asedio/catálogos.
- **Auto-reparación**: Si falla paridad SSOT → importar `MASTER_METAGAME_CONSTANTS` y actualizar tests afectados; si falla hangar → añadir guard de `16` chasis en `useUserHangar.ts`.

---

## 3. Handoff Inter-Skill
- **Recibe de**: `supabase-realtime-and-rpc-synchronizer` (esquemas/RPCs `execute_p2p_market_transaction`, `user_unit_hangar`).
- **Entrega a**: `tactical-combat-and-ai-architect` (Doble Llave, soft cap `14`, Handshake `120s`), `tactical-command-intel` (métricas P2P/Hangar), `geotactics-domain-boundary-guardian` y `game-dev-quality-gate`.
