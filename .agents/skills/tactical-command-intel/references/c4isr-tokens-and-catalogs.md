# C4ISR Tokens, Audio/Haptic Catalogs & UI Debt (`@domains/game-feel`)

## 1. Visual Tokens & Physics (`src/index.css`)
- **Blindado**: `--color-bunker-void: #161712` (`#0E100C` WebGL), `--color-armor-base: #2B2C24`, `--color-military-olive: #46521F`, `--color-metal-edge: #7B8A4A`, `--color-rust-alert: #C46A3A`, `--color-data-cream: #F2E8D5`.
- **Facciones**: Orange Star `#E65100`, Blue Moon `#1D4ED8`, Green Earth `#15803D`, Yellow Comet `#D97706`, Black Hole `#4C1D95`/`#991B1B`.
- **Geometría**: `rounded-[14px_4px_14px_4px]`, chaflanes 45°, `box-shadow: 4px 4px 0px #0A0B08`, trama Ben-Day.
- **Resortes & Ghost Bar**: `--ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1)`, `--ease-out-expo: cubic-bezier(0.22, 1, 0.36, 1)`; `TacticalGhostBar.tsx:22` / `.bar-ghost-trail` (`220ms` delay, `550ms` drain).

## 2. Valid Audio & Haptic Keys
- `AUDIO_SYNTHESIS_CATALOG` (`audioManager.ts:38-55`): `ui_cursor_move`, `ui_tile_confirm`, `ui_cancel_rollback`, `cannon_fire_heavy`, `machinegun_burst`, `rocket_launch`, `explosion_critical`, `trap_alert`, `airdrop_impact`, `co_power_charge`, `hq_collapse`.
- `HapticPattern` (`hapticFeedback.ts`): `selection`, `movement`, `attack`, `trap`, `co_power`, `unit_order`, `success`, `error`.

## 3. Known UI/Audio Debt (Baseline)
- Broken `playCue()` calls (missing in `AUDIO_SYNTHESIS_CATALOG`): `defeat_sting`, `victory_fanfare`, `tactical_confirm_click`, `action_confirmed`.
- Raw `AudioContext`: `src/domains/tactics/components/GeotacticsLoadingScreen.tsx:33,57`.
- `barkEngine.ts:678,782`: `singleSubjectLock = true` and hardcoded `commanderId: 'stella'`.
- `src/App.tsx`: 10 dispersed modal boolean flags without centralized LIFO `Escape` stack.
