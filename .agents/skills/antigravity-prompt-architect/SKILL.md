---
name: antigravity-prompt-architect
description: Transforma ideas y tareas de DRONEPUNK en prompts estructurados para Antigravity (/plan, /goal, /teamwork, /boost), anclados a @docs/00_ARBOL_CANONICO_DE_SISTEMAS_Y_DESARROLLO.md y los 7 Pilares.
---

# Antigravity Prompt Architect (DRONEPUNK)

Enrutador de entrada (*front-door*) que transforma requerimientos en prompts de alta señal, anclados a las 8 skills operativas y verificables en disco. *(Tabla de enrutamiento y plantilla de 5 bloques en `references/prompt_routing_table.md`)*.

---

## 1. Árbol de Decisión (Modo, Topología y Fallback)

- **Elección de Modo**:
  - *Si* hay requisitos ambiguos o decisiones abiertas → `/plan /grill-me`.
  - *Si* acopla 2 capas (`Capa 1 -> Capa 2`, `SQL -> tipos -> UI`) → `/plan` secuencial.
  - *Si* el cambio es acotado con test claro en `package.json` → `/goal`.
  - *Si* es bug WebGL/FPS o race condition Realtime → `/boost`.
  - *Si* abarca `>= 2` dominios desacoplados con contratos estables → `/teamwork /goal`.
  - *Fallback*: si faltan rutas verificadas → lanzar subagente explorador *read-only* antes de redactar el prompt; si `/goal` falla 2 veces → escalar a `/boost` o `/plan`.
- **Topología de Subagentes**:
  - **Paralelo**: dominios disjuntos (`@domains/economy` + `@domains/game-feel`).
  - **Secuencial**: `supabase/migrations/` → `database.types.ts` → servicios → UI, o creación de contrato en `@shared` antes de consumidores.

---

## 2. Oráculo de Calidad del Prompt

Todo prompt generado debe cumplir:
1. `node .agents/skills/antigravity-prompt-architect/scripts/validatePromptMentions.cjs <prompt.md>` = `exit 0` (`0` rutas `@` fantasma y `0` scripts `npm run` inexistentes).
2. `>= 1` skill operativa anclada según `references/prompt_routing_table.md`.
3. Solo las invariantes pertinentes al foco (sin volcar inventarios).
4. Bloque 5 delegando cierre a `game-dev-quality-gate`.

---

## 3. Handoff Inter-Skill
Enruta hacia `geotactics-domain-boundary-guardian`, `supabase-realtime-and-rpc-synchronizer`, `webgl-cartography-and-spatial-architect`, `tactical-combat-and-ai-architect`, `metagame-economy-and-siege-simulator`, `tactical-command-intel` y `game-qa-playtester`, cerrando siempre con `game-dev-quality-gate`.
