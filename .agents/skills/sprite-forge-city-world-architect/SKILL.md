---
name: sprite-forge-city-world-architect
description: Arquitecto del Motor de Ciudades Orgánicas 100% fiel a SPRITE-FORGE-STUDIO (09_city_world_engine.py v6.0.0-awbw) adaptado a @domains/world de DRONEPUNK: 5 familias de silueta Chaikin, beltway_real 0-blobs, 4 particiones polimórficas, 5 distritos funcionales, 9 micro-grains, k-core 0 dead-ends, max_empty_square_side <= 3, 5 familias satélite, AC-01..AC-07, D4 rejection e invariante 100% edificios grises neutrales (ownerId: null).
---

# Sprite-Forge City World Architect (`@domains/world`)

Gobierna el port y la evolución 100 % fiel del motor urbano de **SPRITE-FORGE-STUDIO** (`C:\Users\Usuario\SPRITE-FORGE-STUDIO\src\09_city_world_engine.py` v6.0.0-awbw) dentro de `src/domains/world/core/` en **DRONEPUNK**, preservando intacto el terreno real por polígonos (`zulia_municipalities.json`, `theatre_regions.json`, `world_land.json`) y la regla absoluta de **edificios 100 % neutrales grises (`ownerId: null`)** en creación inicial.

*(Especificación matemática, constantes y pseudocódigo exacto en `references/sprite-forge-algorithms-spec.md`)*.

---

## 1. Regla de Oro Anti-Degradación (Prohibido Portar al 35 %)

Nunca sustituir un algoritmo de `09_city_world_engine.py` por una aproximación simplificada (módulos globales, colocación radial aleatoria o poda ciega por sector `20x20`). Cada ciudad compilada debe cumplir los **10 Pilares de Paridad**:

1. **Hidrología Previa a la Silueta**: Evaluar `water_grid` (`sea | shoal | reef | river`) **antes** de compilar `inland_real`. Prohibido estampar una ciudad sobre un río existente o dejar lagunas `2x2` dentro del casco urbano.
2. **Silueta Orgánica + Chaikin + `_clean_lobe_mask`**: Las 5 familias matemáticas (`harmonic_fourier_polygon`, `multi_ellipse_metaball`, `coastal_arc_crescent`, `river_corridor_split`, `alpine_wedge_terrace`) suavizadas con Chaikin `0.78 / 0.22` (`passes=2`), filtrado a bloques `3x3` (`_keep_only_3x3_blocks`) y *notching* de entrada (`notch_hw`).
3. **`beltway_real` 0-Blobs + Rotondas `R5`/`R7`**: Extraído con `extract_thin_ring` + `peel_2x2` (0 bloques `2x2` de carretera). En metrópolis `x3` (`T5_METROPOLIS_X3`), colocar obligatoriamente una **sub-rotonda secundaria** `5x5` a `11 <= d <= 19` tiles de la rotonda primaria.
4. **Partición Polimórfica de Sectores**: 4 métodos reales (`voronoi_geodesic`, `coast_parallel_bands`, `elevation_terraces`, `non_orthogonal_angular`) con `sector_id_grid` exacto.
5. **5 Distritos Funcionales No-Cuadrados**: Antes del relleno residencial, reservar e insertar en orden estricto: `waterfront_port` -> `air_hub` -> `civic_core` -> `industrial_logistics_park` -> `science_campus`, usando `_find_strip_slot` + `_stamp_rect_road_ring` + conexión por 2 esquinas opuestas.
6. **9 Gramáticas `micro_grain` Acotadas por Sector**: Pintadas dentro de `[qx0..qx1, qy0..qy1]` sobre `q_allowed`, con reconexión de componentes (`_trace_4conn_no_2x2`) y cierre de bucles (`_close_loop_from_deg1`, `max_len=8`).
7. **Invariante Cero Vacíos `4x4`**: Fase 7a (cuota por cuadrante + ~12 % pocket parks), Fase 7b (`min_fill * dry_area`), Fase 7c (`_max_empty_square_side(plain_int) <= 3`).
8. **Supervivencia K-Core (`0 dead-ends`, `0 floating stubs`, `100 % edificios conectados`)**: Ejecutar el cierre topológico en la **ventana completa de la ciudad** (`cityBlueprint`), rescatando edificios desconectados con trazado de 2 piernas y degradando a parque (`wood`) cualquier `city` aislada excedente. **Prohibido** ejecutar poda ciega `pruneDeadEndRoads` por sector `20x20` independiente sobre celdas urbanas.
9. **5 Familias Orgánicas para Pueblos Satélite (`T1`/`T2`)**: `_synthesize_organic_sat_layout` (`highway_roundabout_hub`, `harbor_promenade_cove`, `ridge_terrace_citadel`, `riverbend_mill_hamlet`, `industrial_freight_crescent`) en lienzo `33x33` con Chaikin, rotonda `3x3`/`5x5` y mediana en Y.
10. **Motor de Variabilidad & Soberanía Neutral**: Aplicar `AC-01..AC-07` (`apply_anti_collision_repairs`), chequeo `max_d4_iou` y firma topológica 9D (`_compute_topo_signature`). Todo edificio nace con `ownerId: null` (sprites `Neutral/*.png`, **0 tuberías** `pipe*`, **North Setback** `OVERHANG_PX >= 8`).
11. **Escalas Reales `x1`..`x5` Separadas de SATs Procedurales**: Toda ciudad real de `theatre_cities.json` escala estrictamente por población real (`x5 >= 2M [80x80]`, `x4 >= 1M [68x68]`, `x3 >= 350k [56x56]`, `x2 >= 150k [44x44]`, `x1 < 150k [36x36]`). Los SATs intermedios (`33x33`) son una capa procedural independiente colocada *entre ciudades* con selección automática de familia por bioma real (`harbor_promenade_cove` marítimo en costa, `riverbend_mill_hamlet` en río, `highway_roundabout_hub` en cruces, `industrial_freight_crescent`, `ridge_terrace_citadel`).
12. **Red Multi-Salida (U-Turnouts) y Malla `Ciudad ↔ SAT ↔ Ciudad` + `SAT ↔ SAT`**: Cada ciudad abre `3–7` salidas en todas las direcciones secas (`N/E/S/W` con U-turnouts cerrados estilo `Solstice West`) conectando con ciudades vecinas y SATs intermedios, y los SATs conectan entre sí.
13. **Macro-Puentes Rectos 1D + 2 SATs Marítimos de Cabecera**: Todo macro-puente canónico (ej. `Puente General Rafael Urdaneta`) se estampa como línea recta 100 % horizontal/vertical (`HBridge`/`VBridge`, sin aborto de span) flanqueado por 2 SATs marítimos (`harbor_promenade_cove`) en ambas orillas.

---

## 2. Árbol de Decisión / Heurística de Depuración

1. **Aparecen tramos de carretera flotantes de 2–3 tiles (`[-]`) en bordes de ciudad**:
   - *Causa*: `pruneDeadEndRoads` está corriendo aislado sobre `20x20` en `gbaMapPipeline.ts` después del slicing.
   - *Fix*: Proteger celdas urbanas/troncales en `gbaMapPipeline.ts` y ejecutar el bucle k-core + `_close_loop_from_deg1` únicamente dentro de `urbanDistrictAndGrainEngine.ts` sobre la ventana completa.
2. **Ríos cortados o lagunas `2x2` atrapadas dentro de la ciudad**:
   - *Causa*: Etapa 2 de `gbaMapPipeline.ts` genera hidrología después o desconectada de `urbanContainmentMasks.ts`.
   - *Fix*: Extraer el predicado determinista `isGlobalRiverAtCell(gx, gy)` a un helper puro compartido; excluir ríos de `inland_real` al compilar la ciudad y suprimir `lake2x2` dentro del bounding box urbano + cinturón periurbano.
3. **Las ciudades lucen como grillas rectangulares idénticas**:
   - *Causa*: Falta partición polimórfica (`voronoi_geodesic`, `coast_parallel_bands`, etc.), distritos funcionales con `_stamp_rect_road_ring` o `AC-01..AC-07` + `max_d4_iou`.
   - *Fix*: Activar `resolveCityDnaProfile` + `applyAntiCollisionRepairs` + los 5 planificadores de distritos antes de `populateMicroGrainStreets`.
4. **Edificios altos (`hq`, `factory`, `commtower`, `lab`, `silo`) tapan otro edificio o montaña al norte**:
   - *Causa*: Faltó validar `(x, y - 1)` y `(x, y + 1)` contra `AWBW_BUILDING_OVERHANG_PX >= 8`.
   - *Fix*: Enforcer estricto en `safePlaceNeutralBuilding` (degradar a `city` o rechazar si `allowDowngrade === false`).

---

## 3. Oráculo de Verificación Obligatorio

```powershell
npm run test:urban
npm run test:cartography
node scripts/auditBoundaries.cjs
node scripts/run_quality_gate.cjs --mode=full
npm run test:qa
```

- **Métricas cuantitativas exigidas (Gate de Paridad 100 %)**:
  - `count2x2RoadBlobs === 0` en el 100 % de las 33 ciudades.
  - `remainingDeadEnds === 0` y `floatingRoadStubs === 0` (ni en ventana de ciudad ni tras rebanado `20x20`).
  - `maxEmptySquareSide <= 3` en el 100 % de ciudades `x1`/`x2`/`x3`.
  - `tallOverhangViolations === 0` y `nonNeutralInitialBuildings === 0`.
  - `functionalDistrictsPlaced >= 2` en `x1`, `>= 4` en `x2`/`x3` (`civic_core` + `industrial_logistics_park` + `air_hub` + `waterfront_port` si costera).
  - `distinctMicroGrains >= min(K, 3)` por ciudad y `max_d4_iou(cityA, cityB) <= 0.85` entre pares del mismo estado.
  - `riverCutsInsideCity === 0` y `lakes2x2InsideCity === 0`.

---

## 4. Handoff Inter-Skill
- **Recibe de**: `webgl-cartography-and-spatial-architect` (`coordinates.ts`, `zulia_municipalities.json`, `theatre_regions.json`, `world_land.json`, `theatre_cities.json`, `theatre_roads.json`).
- **Entrega a**: `geotactics-domain-boundary-guardian` (cero imports de `@domains/tactics` ni mutación de `TerrainTile`), `game-qa-playtester` (evidencia visual Playwright en `test-results/screenshots/`), y `game-dev-quality-gate` (cierre verde `lint` + `build` + `100 %` suites).
