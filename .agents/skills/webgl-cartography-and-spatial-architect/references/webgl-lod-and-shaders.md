# WebGL LOD, Shaders & Performance Reference (`@domains/world`)

## 1. Semantic Zoom Strata (`src/domains/world/core/coordinates.ts`)
- **Estrato 1 (`ZOOM_GLOBAL = 3.5`, $1.5 \le z < 10.0$)**: Vista macro geopolítica (`theatre_regions.json`, `theatre_borders_mesh.json`, capitales `15,000 TCP`).
- **Estrato 2 (`ZOOM_OPERACIONAL = 10.0`, $10.0 \le z < 15.0$)**: Red vial urbana (`theatre_urban_roads.json` `minzoom: 9.5`), ciudades (`theatre_cities.json` `minzoom: 8.5..15.0`), Cabimas `[-71.455, 10.395]`, `zulia_municipalities.json`.
- **Estrato 3 (`ZOOM_TACTICO = 15.0`, $z \ge 15.0$)**: Cuadrícula vectorial GPU (`tactical-viewport-grid`, sin `CanvasSource`), `TacticalBitMap` 50 bytes, escala `1–100 HP`.

## 2. Current Performance Debt in `TacticalWorldMap.tsx`
- `hoveredCellGlobal` (L326-329, L1535-1539) triggers `syncHoverGrid` -> `hoverSrc.setData(...)` on `mousemove`.
- `0` calls to `map.setFeatureState(...)`; selection uses `setPaintProperty` or full `provincesGeoJSON` rebuild (`L1437-1443`).
- `L1674` applies `tactical-stratum-blur` (`src/index.css:361-362`: `filter: blur(2px)`) directly on `mapContainerRef`.
- Missing `webglcontextlost` / `webglcontextrestored` handlers; 100ms RTS `setInterval` (`L1605-1614`) runs even when `WarLobbyHub` is `hidden` in `App.tsx:2512`.
- `TacticalMapControls.tsx` exists but is not mounted in `WarLobbyHub.tsx` (which uses `LeftCollapsibleRail`).
