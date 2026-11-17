# Plan Histórico de Implementación: Migración del Motor Cartográfico C4ISR a Arquitectura WebGL Zero-Raster

> **Estado Documental:** Especificación Histórica Archivada — Alineada a **DRONEPUNK 0.0.1**  
> **Documento:** `docs/archive_legacy/PLAN_IMPLEMENTACION_MAPA_VECTORIAL_ZERO_RASTER.md`  
> **Proyecto:** **DRONEPUNK 0.0.1** (`@domains/world`)

## Metas del Spike y la Implementación
1. Erradicar la dependencia de teselas raster externas (CartoDB / OpenStreetMap) sustituyéndolas por topología vectorial local renderizada directamente en WebGL 2.0 por MapLibre GL v6 en `src/domains/world/components/TacticalWorldMap.tsx`.
2. Migrar la interactividad (hover, selección, asedio) a `feature-state` en la GPU, garantizando **0% de re-renders de React en el hilo principal** al interactuar con el mapa.
3. Preservar la compatibilidad canónica con el **LOD Semántico de 3 estratos** (`ZOOM_GLOBAL = 3.5`, `ZOOM_OPERACIONAL = 10.0`, `ZOOM_TACTICO = 15.0` en `src/domains/world/core/coordinates.ts`), el **TacticalBitMap** de 50 bytes de niebla de guerra (`src/domains/world/core/tacticalBitmap.ts`) y los eventos del **Bark Engine** (`src/domains/game-feel/core/barkEngine.ts`).
4. Soportar de forma nativa el **Teatro Venezuela** (24 estados soberanos `REG_VE_01`..`REG_VE_24` + `BUF_MARITIME_CARIBE` en `public/map/theatre_regions.json` y 7 zonas buffer fronterizas `BUF_*` en `src/domains/world/core/politicalAliceEngine.ts`).

---

## Decisiones Arquitectónicas Aprobadas

1. **Formato de Geometría Base Local**: Artefactos GeoJSON/TopoJSON vectoriales estáticos servidos localmente desde `public/map/`:
   - `public/map/theatre_regions.json` (24 entidades soberanas `REG_VE_01`..`REG_VE_24` + `BUF_MARITIME_CARIBE`)
   - `public/map/theatre_borders_mesh.json` (malla única de fronteras sin aristas duplicadas)
   - `public/map/theatre_roads.json` y `public/map/theatre_urban_roads.json` (red troncal y vialidad urbana)
   - `public/map/theatre_cities.json`, `public/map/zulia_municipalities.json` y `public/map/world_land.json`
2. **Renderizado Vectorial GPU en MapLibre GL v6**: Renderizador unificado en `src/domains/world/components/TacticalWorldMap.tsx` sobre estilo oscuro C4ISR (`#0E100C` / `#090D14`) con cero peticiones externas.
3. **Cuadrícula Táctica Vectorial (LOD 3 a `ZOOM_TACTICO = 15.0`)**: Cuadrícula proyectada directamente como capa vectorial en MapLibre GL (`line` layer) eliminando texturas pesadas de Canvas 2D hacia VRAM.
4. **Gestión de Estado y Soberanía**: Mutación en la GPU mediante `map.setFeatureState` al recibir eventos de Supabase Realtime (`src/domains/world/hooks/useTerritoryMap.ts` y `src/domains/world/hooks/useSiegeRealtime.ts`).

---

## Fases Históricas de Ejecución

### Fase 1: Alineación y Decisiones [COMPLETADA]
- [x] Consolidar decisiones sobre formato de datos local en `public/map/*.json`, niebla binaria de 50 bytes (`TacticalBitMap`) y `feature-state` en GPU.
- [x] Alinear el Teatro Venezuela (`24` estados soberanos + `BUF_MARITIME_CARIBE` + `7` zonas buffer `BUF_*`).

### Fase 2: Validación y Contratos Cartográficos [COMPLETADA]
- [x] Instalar dependencias vectoriales (`maplibre-gl`, `topojson-client`, `topojson-server`, `topojson-simplify` en `package.json`).
- [x] Compilar y validar la topología del Teatro Venezuela en `public/map/theatre_regions.json`, `public/map/theatre_borders_mesh.json`, `public/map/theatre_roads.json`, `public/map/theatre_urban_roads.json`, `public/map/theatre_cities.json`, `public/map/zulia_municipalities.json` y `public/map/world_land.json`.
- [x] Desarrollar y ejecutar las suites deterministas `src/domains/world/__tests__/cartographyTopologyAudit.test.ts` y `src/domains/world/__tests__/coordinatesAndBitmap.test.ts`.

### Fase 3: Integración Canónica en `src/domains/world/components/TacticalWorldMap.tsx` [COMPLETADA]
- [x] Retirar basemaps raster externos y consolidar el estilo Zero-Raster local en `src/domains/world/components/TacticalWorldMap.tsx`.
- [x] Conectar `src/domains/world/hooks/useTerritoryMap.ts` con `feature-state` para actualizar soberanía territorial sin remontar capas.
- [x] Proyectar la cuadrícula táctica vectorial nativa a `ZOOM_TACTICO = 15.0` junto con `TacticalBitMap` (`src/domains/world/core/tacticalBitmap.ts`).

### Fase 4: Calidad y Verificación Integral
- [x] Ejecutar suites cartográficas: `npm run test:cartography` y `npm run test:all`.
- [x] Ejecutar prueba E2E de Playwright (`npm run test:qa` sobre `tests/e2e/game-playtester.spec.ts`) para verificar cero regresiones WebGL.
- [x] Verificar reporte de compilación con `npm run build`.

---
*Especificación Histórica Archivada — Alineada a **DRONEPUNK 0.0.1**.*
