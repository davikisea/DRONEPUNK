---
name: webgl-cartography-and-spatial-architect
description: Arquitecto WebGL 2.0 Zero-Raster (MapLibre GL v6), Semantic Zoom de 3 estratos, proyección analítica WGS84 O(1) (coordinates.ts), niebla de 50 bytes (tacticalBitmap.ts) y red vial A* en @domains/world de DRONEPUNK.
---

# WebGL Cartography, Zero-Raster Shaders & Spatial Road Architect (`@domains/world`)

Gobierna el mapa estratégico **100% Zero-Raster** en `src/domains/world/` (7 GeoJSON en `public/map/` + `/maplibre-gl-worker.mjs`), picking analítico $O(1)$ y red vial $A^*$. *(Detalle de estratos y deuda WebGL en `references/webgl-lod-and-shaders.md`)*.

---

## 1. Árbol de Decisión / Heurística

1. **Caída de FPS en pan/hover (`zoom >= 14`)**:
   - *Si* `mousemove` dispara `setState` (`hoveredCellGlobal`) + `setData()` → migrar a `map.setFeatureState` o `requestAnimationFrame` fuera de React state. *Fallback*: reducir `MAX_GRID_SECTORS_PER_AXIS` (actual `5`) o restringir grilla a `zoom >= ZOOM_TACTICO - 0.5`.
2. **Lag cada 1000ms (ticker económico)**:
   - *Si* `provincesGeoJSON` reconstruye geometrías y llama `provSource.setData()` → cargar geometría estática 1 vez con `promoteId: 'id'` y mutar solo `map.setFeatureState({ source: 'tactical-provinces', id }, { isSelected, isUnderSiege })`.
3. **Pantalla negra o pérdida de contexto al volver de Combate (`App.tsx`)**:
   - *Si* `WarLobbyHub` usa `hidden` y pierde contexto → añadir `webglcontextlost` (`e.preventDefault()`) + `webglcontextrestored` (`triggerRepaint()`) y pausar `setInterval` RTS bajo `hidden`. *Fallback*: botón de reinicialización limpia (`map.remove()` + `initMapEngine()`).
4. **Jank en transición de estrato**:
   - *Si* `mapContainerRef` usa `tactical-stratum-blur` (`filter: blur`) → eliminar filtro del canvas WebGL y mover feedback al HUD.
5. **Brechas en polígonos / fallo `public/map/*.json`**:
   - Correr `node scripts/verify-map-topology.mjs --json`; corregir vértices o `tolerance: 0` / `maxzoom` / Z-order.

---

## 2. Reglas de Matemática Espacial & Red Vial

- **Picking Analítico $O(1)$ (`coordinates.ts`)**: Usar siempre `lngLatToGridCoords`, `tileFractionToLngLat`, `gridCoordsToLngLat`, `getTileBounds` y `traceSupplyLine` (prohibido raycasting poligonal).
- **Red Vial $A^*$**: `SpatialRoadIndex` (`getCellKey`, `isLocationAdjacentToRoad(lng, lat, 0.15)` $\le 150\text{ m}$), `findOptimalRoadRoute` (`roadNetworkEngine.ts`) y 5 doctrinas de guarnición (`roadGarrisonEngine.ts`).

---

## 3. Oráculo y Bucle de Auto-Reparación

```powershell
node scripts/verify-map-topology.mjs --json
node .agents/skills/webgl-cartography-and-spatial-architect/scripts/audit_webgl_antipatterns.mjs
npm run test:cartography
npm run test:urban
```
- **Oráculo**: `verify-map-topology.mjs` (`ok: true`, `6/6` suites), `audit_webgl_antipatterns.mjs` (`ok: true`, `7/7` GeoJSON `<= 2.0 MB`, Zero-Unmount intacto; `--strict` para `0` anti-patrones), `test:cartography` y `test:urban` = `exit 0`.
- **Auto-reparación**: Si falla topología → ajustar GeoJSON/`TacticalWorldMap.tsx`; si falla anti-patrón → migrar a `setFeatureState` / quitar `blur` y re-auditar.

---

## 4. Handoff Inter-Skill
- **Recibe de**: `supabase-realtime-and-rpc-synchronizer` (deltas `region_sovereignty`), `tactical-command-intel` (tokens C4ISR), `metagame-economy-and-siege-simulator` (adyacencia $\le 150\text{ m}$, asedios).
- **Entrega a**: `tactical-combat-and-ai-architect` (`sector`, `cell`, `ZOOM_TACTICO`, Zero-Unmount), `geotactics-domain-boundary-guardian`, `game-qa-playtester` y `game-dev-quality-gate`.
