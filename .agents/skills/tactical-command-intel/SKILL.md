---
name: tactical-command-intel
description: Directriz canónica de UI/UX, Game Feel y Bark Engine de DRONEPUNK (@domains/game-feel, TacticalGhostBar, C4ISR Atompunk, física de resortes, Web Audio API, 0 cartas y 1-100 HP).
---

# Tactical Command Intel: Kinetic Comic War-Room & Game Feel (DRONEPUNK)

Estándar único de UI/UX, diegesis, física *Juice* y narrativa gráfica sin voces de **DRONEPUNK**. *(Tokens CSS, catálogos válidos y deuda UI/Audio en `references/c4isr-tokens-and-catalogs.md`)*.

---

## 1. Reglas Inmutables en UI (Anti-SaaS & 7 Pilares)

- **CERO Cartas / Gacha**: Bahías de Chasis Físico (`16` tropas: `4` activas + `12` reserva), escala `1–100 HP` enteros, Tiers `T1–T5 (+2%/tier)`, `35% tech_scrap`, Handshake `120s`, P2P `2%` (`1%` Sink + `1%` Clan, `VWAP ±25%`).
- **Anti-SaaS**: Prohibido `rounded-lg` simétrico o tarjetas blancas con sombras difusas. Usar `rounded-[14px_4px_14px_4px]`, chaflanes 45°, `4px 4px 0px #0A0B08`, `--ease-spring` y `.tactical-btn-heavy`.

---

## 2. Árbol de Decisión / Heurística

1. **Desbloqueo de 29 COs (`barkEngine.ts`)**:
   - *Si* `singleSubjectLock === true` o `barkEngine.ts:782` fuerza `'stella'` → cambiar a `false` y usar `effectiveCommanderId`. *Si* falta plantilla estática → fallback determinista `sampleLocalTemplate()` con `CANONICAL_CO_REGISTRY`.
2. **Validación de Audio y Háptica (`audioManager.ts`)**:
   - *Si* `playCue(k)` no está en `AUDIO_SYNTHESIS_CATALOG` (`defeat_sting`, `victory_fanfare`, `tactical_confirm_click`, `action_confirmed`) → migrar a clave válida (`ui_tile_confirm`, `ui_cancel_rollback`, `trap_alert`) o registrar el cue en `AUDIO_SYNTHESIS_CATALOG`.
   - *Si* existe `new AudioContext` fuera de `audioManager.ts` (ej. `GeotacticsLoadingScreen.tsx`) → reemplazar por `audioManager`.
3. **Barras y Duplicados UI**:
   - *Si* componente usa `./TacticalGhostBar` local o barra simple para HP/TCP/forja → importar `TacticalGhostBar` desde `@shared` (`550ms` ghost drain) y eliminar copia duplicada.
4. **Pila LIFO de Modales y `Escape` (`src/App.tsx`)**:
   - *Si* hay modales compitiendo en `z-50` o flags sueltos → empujar `ModalId` a un `useModalStack` único (`backdrop z-40`, modales `z-50 + index`); con `Escape`, hacer `pop()` del superior + `audioManager.playCue('ui_cancel_rollback')`.

---

## 3. Oráculo y Bucle de Auto-Reparación

```powershell
node .agents/skills/tactical-command-intel/scripts/audit_command_intel.cjs
npx tsx src/domains/game-feel/__tests__/barkEngine.test.ts
npx tsx src/domains/game-feel/__tests__/phase2InterfaceAndBark.test.ts
```
- **Oráculo**: `audit_command_intel.cjs` = `exit 0` (`0` regresiones; `--strict` para `0` claves rotas, `0` `AudioContext` sueltos, `singleSubjectLock = false`, `0` `rounded-lg`), tests `game-feel` = `exit 0`.
- **Auto-reparación**: Si falla clave `playCue` → mapear a `AUDIO_SYNTHESIS_CATALOG`; si falla `TacticalGhostBar` duplicado → unificar import en `@shared`.

---

## 4. Handoff Inter-Skill
- **Recibe de**: `tactical-combat-and-ai-architect` (eventos `1–100 HP`, `¡TRAP!`, COP/SCOP), `metagame-economy-and-siege-simulator` (métricas P2P/Hangar), `webgl-cartography-and-spatial-architect` (transiciones de estrato).
- **Entrega a**: `geotactics-domain-boundary-guardian` (`@shared` limpio), `game-qa-playtester` y `game-dev-quality-gate`.
