# VOLUMEN 1: ARQUITECTURA CARTOGRÁFICA WEBGL 2.0 ZERO-RASTER
**Documento Canónico Unificado:** `01_MASTER_CARTOGRAPHY_WEBGL_ZERO_RASTER.md`  
**Proyecto:** *DRONEPUNK 0.0.1*  
**Versión:** 0.0.1 (Zero-Raster, Topología TopoJSON Bottom-Up, OpenPlace Bridge & Dominio Modular `world`)  
**Estado:** Documento de Verdad Absoluta (SSOT - Single Source of Truth)  
**Archivos Consolidados y Reemplazados:**  
- `WARERA_MAP_ARCHITECTURE_DEEP_DIVE.md` (Arquitectura de alto rendimiento inspirada en WarEra)  
- `PLAN_IMPLEMENTACION_MAPA_VECTORIAL_ZERO_RASTER.md` (Especificación de pipeline vectorial)  
- `PLAN_DESPLIEGUE_MAPA_WEBGL_VENEZUELA.md` (Matriz de 24 Estados de Venezuela, 7 Buffers y Red Troncal)  

---

# 1. VISIÓN FUNDACIONAL: LA FÓRMULA ZERO-RASTER DE ALTO RENDIMIENTO

La mayoría de los juegos web de estrategia militar o geopolítica y las aplicaciones de mapas tradicionales cometen uno de estos dos errores críticos:
1. **Sobrecarga de Tiles Raster (PNG/JPG):** Descargar cientos de imágenes cuadradas (`{z}/{x}/{y}.png`) mediante peticiones HTTP concurrentes cada vez que el usuario hace pan o zoom. Esto satura el ancho de banda, genera parpadeos y consume decenas de megabytes de RAM.
2. **Sobrecarga de DOM/SVG:** Renderizar miles de nodos `<path>` o `<svg>` en el árbol del navegador. Cuando hay más de 500 regiones, cada evento de `mousemove` o cambio de color fuerza un *reflow* y *recalculation* de estilos en la CPU, derrumbando los FPS a menos de 15 FPS.

### La Solución Canónica de DRONEPUNK 0.0.1:
DRONEPUNK opera bajo una arquitectura **WebGL Vectorial Híbrida Zero-Raster** implementada sobre **MapLibre GL JS v6.16.0** dentro del dominio modular `src/domains/world/` (`@domains/world`):
- **Aislamiento de Red 100% Local:** Cero peticiones de red a servidores externos (`cartodb.com`, `mapbox.com`, `openstreetmap.org`). Cero API Keys comerciales.
- **Geometrías Vectoriales Servidas Localmente (`public/map/`) desde Fuente Única Topológica (TopoJSON):**
  - Masa continental global (`/map/world_land.json`, ~542.2 KB): combina Natural Earth 50m (32 países de América/Caribe + `GUF`/`BES`) y 110m (resto del mundo) sustituyendo la geometría de Venezuela (`VEN`) por la masa disuelta bit-a-bit idéntica al teatro TopoJSON.
  - Polígonos soberanos del teatro de operaciones (`/map/theatre_regions.json`, ~321.5 KB): 25 entidades (`REG_VE_01`..`REG_VE_24` disueltas con `topojsonClient.merge` + `BUF_MARITIME_CARIBE` para Dependencias Federales).
  - Malla de fronteras deduplicadas en GPU (`/map/theatre_borders_mesh.json`, ~214.1 KB): `FeatureCollection` con 3 capas topológicas (`mesh_state_internal`, `mesh_theatre_exterior`, `mesh_federal_dependencies`) y `10,585` segmentos únicos sin duplicados.
  - Delimitaciones geográficas reales de los 21 municipios del Estado Zulia (`/map/zulia_municipalities.json`, ~65.4 KB, activa en Estrato 2 desde `minzoom: 8.5` hasta `maxzoom: ZOOM_TACTICO - 0.5 = 14.5`).
  - Red vial troncal nacional (`/map/theatre_roads.json`, ~403.8 KB).
  - Red vial urbana de alta densidad (`/map/theatre_urban_roads.json`, ~16.2 KB, activa en `minzoom: 9.5`).
  - Nodos urbanos, metrópolis y las 21 cabeceras municipales del Zulia (`/map/theatre_cities.json`, ~20.4 KB, activa entre `minzoom: 8.5` y `maxzoom: 15.0`).
- **Fondo Táctico Búnker:** Fondo de pantalla de vacío militar (`#0E100C`) con masas de tierra entintadas (`#1C1E17`) y bordes de camuflaje oliva (`#46521F`).
- **Worker Autónomo Desacoplado y Zero-SSR:** Importación dinámica (`await import('maplibre-gl')`) dentro de `useEffect` y configuración explícita de `setWorkerUrl('/maplibre-gl-worker.mjs')` desde `public/maplibre-gl-worker.mjs`, garantizando carga local inmediata con código 200 OK sin colapsos de CORS, ni fallos de SSR en Vite.
- **Picking Analítico WGS84 O(1) y Malla Vectorial Continua de Viewport Completo:** Resolución instantánea de coordenadas geográficas a sectores Web Mercator y baldosas tácticas de $20 \times 20$ en $<0.001\text{ ms}$ (`src/domains/world/core/coordinates.ts`), acoplada a la malla vectorial GPU de viewport completo (`tactical-viewport-grid` + `tactical-viewport-grid-hover`) en Estrato 3 que dibuja simultáneamente todas las celdas visibles sin parches ni borrados al desplazar la cámara.
- **Standby Automático 0% GPU:** El motor entra en modo ahorro (`0% CPU/GPU`) tras 5 minutos de inactividad (`ACTIVITY_TIMEOUT_MS = 300_000`) o al perder el foco de la ventana (`window.blur`).

### Topología de Archivos del Dominio `src/domains/world/`
| Ruta Modular Canónica (`src/domains/world/...`) | Responsabilidad Arquitectónica |
| :--- | :--- |
| `src/domains/world/components/TacticalWorldMap.tsx` | Renderizador principal WebGL 2.0 C4ISR (exportado también como alias `WorldMapCanvas` en `src/domains/world/index.ts`, consolidando y reemplazando al antiguo `StrategicGlobeMap.tsx`). |
| `src/domains/world/components/TacticalMapControls.tsx` | Panel C4ISR desvinculado del lienzo principal de `TacticalWorldMap.tsx` (preservado como módulo opcional en `@domains/world` para no romper exportaciones del barril, sin montaje sobre el mapa táctico). |
| `src/domains/world/core/coordinates.ts` | Motor de conversión analítica $O(1)$ WGS84 (`LngLat`) $\leftrightarrow$ Sectores Web Mercator $\leftrightarrow$ Cuadrícula Táctica $20 \times 20$ y trazado de líneas logísticas de Bresenham. |
| `src/domains/world/core/tacticalBitmap.ts` | Empaquetado binario ultraligero (`TacticalBitMap` sobre `Uint8Array`) con serialización Base64 para Niebla de Guerra ($20 \times 20 = 400\text{ bits} = 50\text{ bytes}$) y estados macro-regionales. |
| `src/domains/world/core/worldMapEngine.ts` | Motor geopolítico de adyacencia territorial, validación de asaltos fronterizos, cálculo de mantenimiento corporativo superlineal, resolución de TCP y conectividad logística BFS (`validateSupplyLineConnectivity`). |
| `src/domains/world/core/roadNetworkEngine.ts` | Grafo vial navegable (`RoadNetworkEngine`), semilla del corredor petrolero de Cabimas (Zulia), cálculo de tiempos de marcha estilo *Project Alice* y pathfinding $A^*$ (`findOptimalRoadRoute`). |
| `src/domains/world/core/spatialRoadIndex.ts` | Índice de partición espacial 2D (`SpatialRoadIndex`) con hash bitwise de 32 bits (`getCellKey`) para *snapping* $O(1)$ a nodos y validación de adyacencia vial a $\le 150\text{ m}$ (`isLocationAdjacentToRoad`). |
| `src/domains/world/core/politicalAliceEngine.ts` | Motor determinista de Capa 1 (*Project Alice*): registro de las 31 regiones del Teatro Venezuela (24 estados + 7 buffers), 4 facciones, edictos políticos, estratos sociales (POPs) y riesgo de secesión. |
| `src/domains/world/hooks/useTerritoryMap.ts` | Hook reactivo de sincronización territorial entre la réplica local determinista (`politicalAliceEngine`), ` barkEngine` (Mayor Stella) y las tablas `public.regions` / `public.region_sovereignty` en Supabase. |
| `src/domains/world/services/spatialDeploymentService.ts` | Servicio de asignación espacial $O(1)$ a zoom $\ge 15.0$, despliegue de unidades y construcción de estructuras de feudo in-situ con persistencia CDC Realtime en Supabase (`tactical_spatial_deployments` y `tactical_fief_constructions`). |

---

# 2. ESPECIFICACIÓN DEL ESTILO CANÓNICO `ZERO_RASTER_MILITARY_STYLE`

El componente `src/domains/world/components/TacticalWorldMap.tsx` define y consume la especificación de estilo vectorial nativa de MapLibre GL, aplicando además una poda automática de capas civiles (`pruneCivilianLayers` mediante `C4ISR_HIDE_LAYERS_REGEX = /^poi_|^landuse|^building(-3d)?$|^road_label|^waterway_label|^transit_/`):

```typescript
const ZERO_RASTER_MILITARY_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    'world-land': {
      type: 'geojson',
      data: '/map/world_land.json',
    },
  },
  layers: [
    {
      id: 'background',
      type: 'background',
      paint: {
        'background-color': '#0E100C', // --color-bunker-void (profundidad oceánica de búnker)
      },
    },
    {
      id: 'world-land-mass',
      type: 'fill',
      source: 'world-land',
      paint: {
        'fill-color': '#1C1E17', // --color-armor-base secundario (Colombia, Brasil, Caribe)
        'fill-opacity': 0.95,
      },
    },
    {
      id: 'world-land-border',
      type: 'line',
      source: 'world-land',
      maxzoom: 7.5,
      layout: {
        'line-join': 'round',
        'line-cap': 'round',
      },
      paint: {
        'line-color': '#46521F', // --color-military-olive (bisel militar exterior)
        'line-width': 1.2,
        'line-opacity': ['interpolate', ['linear'], ['zoom'], 4.5, 0.65, 7.5, 0],
      },
    },
  ],
};
```

### Paleta Cromática de Soberanía y Facciones (`resolveFactionColor`)
En `src/domains/world/components/TacticalWorldMap.tsx`, el color de cada polígono regional (`ownerColor`) se resuelve dinámicamente según su estado táctico y el clan controlador:
- **En Asedio Activo (`isUnderSiege === true`):** `#EF4444` (Alerta DEFCON 1 / Asedio balístico).
- **Zona Buffer Internacional (`isBuffer === true`):** `#2B2C24` (`--color-armor-base` neutro no capturable).
- **Iron Vanguard Syndicate (`clan-ferro` / Blue Moon):** `#1D4ED8` (Azul Mando Asedio).
- **Consorcio Siderúrgico del Orinoco (`clan-orinoco` / Orange Star):** `#E65100` (Naranja Petroquímico).
- **Frente Balístico de los Andes (`clan-andes` / Black Hole):** `#991B1B` (Carmesí Hostil).
- **Flota Mercante del Caribe (`clan-caribe` / Fallback Heráldico):** Color heráldico del clan (`#10B981`) o `#2B2C24`.

---

# 3. ESTRATIFICACIÓN EN GPU DE CAPAS VECTORIALES, RED VIAL Y DELIMITACIONES DEL ZULIA

Al dispararse el evento `map.on('load')`, `src/domains/world/components/TacticalWorldMap.tsx` monta una jerarquía limpia de **fuentes GeoJSON vectoriales** en la GPU, erradicando el panel flotante superior izquierdo (`TacticalMapControls`), las capas de testeo (`cabimas-road-network`, `cabimas-pois`, `tactical-marks-source`, `fief-buildings-source`, `operational-units-source`) y las nubes de diálogo sobre coordenadas del mapa (`worldBarks`):

### 3.1. Capas de Soberanía Provincial, Malla de Fronteras Deduplicadas y Precisión `tolerance: 0`
En `map.on('load')`, las tres fuentes cartográficas críticas se registran con `tolerance: 0` y `buffer: 64` (desactivando la simplificación `geojson-vt` por tesela, que causaba desalineaciones entre polígonos adyacentes) y se mantiene un **orden Z estricto** en la GPU:

1. **Fuentes GeoJSON con `tolerance: 0, buffer: 64`:**
   - `'tactical-provinces'` (`/map/theatre_regions.json` vía `provincesGeoJSONRef.current`)
   - `'tactical-borders-mesh'` (`/map/theatre_borders_mesh.json`)
   - `'zulia-municipalities'` (`/map/zulia_municipalities.json`)
2. **`provinces-fill` (`type: 'fill'`, `source: 'tactical-provinces'`, `maxzoom: ZOOM_TACTICO - 0.5` = `14.5`):**
   - `fill-color`: `['get', 'ownerColor']`.
   - `fill-opacity`: `0.92` si `isSelected`, `0.84` si `isUnderSiege`, `0.68` por defecto.
3. **`tactical-borders-mesh` (`type: 'line'`, `source: 'tactical-borders-mesh'`, `maxzoom: ZOOM_TACTICO - 0.5` = `14.5`):**
   - Renderiza en **una sola pasada GPU** todos los bordes internos estado-estado (`mesh_state_internal`), el contorno exterior del teatro (`mesh_theatre_exterior`) y las Dependencias Federales (`mesh_federal_dependencies`), eliminando el doble dibujado de aristas compartidas.
   - `layout`: `{ 'line-join': 'round', 'line-cap': 'round' }`.
   - `paint`: `'line-color': '#7B8A4A'`, `'line-width': ['interpolate', ['linear'], ['zoom'], 3.5, 1.2, 10, 1.5]`, `'line-opacity': 0.95`.
4. **`provinces-borders` (`type: 'line'`, `source: 'tactical-provinces'`, `maxzoom: ZOOM_TACTICO - 0.5` = `14.5`):**
   - Restringida **exclusivamente** a estados seleccionados o bajo asedio mediante `filter: ['any', ['boolean', ['get', 'isSelected'], false], ['boolean', ['get', 'isUnderSiege'], false]]`.
   - `layout`: `{ 'line-join': 'round', 'line-cap': 'round' }`.
   - `paint`: `'line-color': ['case', ['boolean', ['get', 'isSelected'], false], '#00FF66', '#EF4444']`, `'line-width': ['case', ['boolean', ['get', 'isSelected'], false], 3.2, 2.2]`, `'line-opacity': 0.95`.
5. **`provinces-vulnerable-halo` (`type: 'line'`, `source: 'tactical-provinces'`, `maxzoom: ZOOM_TACTICO - 0.5` = `14.5`):**
   - Filtro: `['==', ['get', 'isVulnerableActive'], true]`, `layout`: `{ 'line-join': 'round', 'line-cap': 'round' }`.
   - Halo pulsante ámbar (`#F59E0B`, `line-width: 4.5`, `line-opacity: 0.85`, `line-blur: 3.0`) para regiones en ventana de vulnerabilidad activa (Anti-Offline Raiding).

> [!IMPORTANT] ORDEN Z ESTRICTO DE CAPAS EN `TacticalWorldMap.tsx`
> `background` $\rightarrow$ `world-land-mass` $\rightarrow$ `world-land-border` (`maxzoom: 7.5`) $\rightarrow$ `provinces-fill` $\rightarrow$ `zulia-municipalities-fill` $\rightarrow$ `tactical-borders-mesh` $\rightarrow$ `zulia-municipalities-border` $\rightarrow$ `provinces-borders` $\rightarrow$ `provinces-vulnerable-halo` $\rightarrow$ `roads-*` (`roads-ink-shadow`, `roads-glow`, `roads-core`) $\rightarrow$ `urban-roads-*` (`urban-roads-shadow`, `urban-roads-glow`, `urban-roads-core`) $\rightarrow$ `cities-*` (`cities-glow`, `cities-point`, `cities-labels`) $\rightarrow$ `tactical-viewport-grid-*` (`tactical-viewport-grid-lines`, `tactical-viewport-grid-hover-fill`, `tactical-viewport-grid-hover-line`) $\rightarrow$ `tactical-rts-units-*` (`tactical-rts-units-circle`, `tactical-rts-units-labels`).

### 3.2. Red Vial Troncal y Avenidas Principales en Naranja Exclusivo (`tactical-roads` y `tactical-urban-roads`)
Tanto las carreteras troncales (`/map/theatre_roads.json`, `403.8 KB`) como las arterias y avenidas urbanas principales (`/map/theatre_urban_roads.json`, `16.2 KB`, `minzoom: 9.5`) se renderizan exclusivamente con **líneas naranjas/ámbar nítidas sobre sombra oscura** (erradicando los trazos cian/azules/verdes de prueba):
1. **Sombra de Tinta Cómic (`roads-ink-shadow` / `urban-roads-shadow`):**  
   - Color: `#0A0B08` (`line-opacity: 0.85`).  
   - Propósito: Separación visual de alto contraste sobre la masa continental y polígonos municipales.
2. **Resplandor Naranja Táctico (`roads-glow` / `urban-roads-glow`):**  
   - Color: `#F97316` (`line-opacity: 0.38`–`0.42`, `line-blur: 1.5`–`2.0`).
3. **Núcleo de Precisión (`roads-core` / `urban-roads-core`):**  
   - Troncales nacionales (`roads-core`): `#F97316` para `motorway` y `#F59E0B` para el resto de troncales.
   - Avenidas urbanas (`urban-roads-core`): `#FBBF24` para `primary` y `#F97316` para vías secundarias.

### 3.3. Delimitaciones Municipales Reales del Estado Zulia, Ciudades y Malla de Viewport Completo
4. **Delimitación Geográfica Real de los 21 Municipios del Estado Zulia (`source: 'zulia-municipalities'` — `/map/zulia_municipalities.json`, `tolerance: 0`, `buffer: 64`, `minzoom: 8.5`, `maxzoom: ZOOM_TACTICO - 0.5` = `14.5`):**
   - Contiene los polígonos geográficos reales (`Polygon` / `MultiPolygon`) de los **21 municipios del Estado Zulia** (`MUN_ZULIA_MARACAIBO`, `MUN_ZULIA_SAN_FRANCISCO`, `MUN_ZULIA_CABIMAS`, `MUN_ZULIA_SANTA_RITA`, `MUN_ZULIA_MIRANDA`, `MUN_ZULIA_LAGUNILLAS`, `MUN_ZULIA_VALMORE_RODRIGUEZ`, `MUN_ZULIA_BARALT`, `MUN_ZULIA_SIMON_BOLIVAR`, `MUN_ZULIA_MARA`, `MUN_ZULIA_GUAJIRA`, `MUN_ZULIA_JESUS_ENRIQUE_LOSSADA`, `MUN_ZULIA_LA_CANADA_DE_URDANETA`, `MUN_ZULIA_MACHIQUES_DE_PERIJA`, `MUN_ZULIA_ROSARIO_DE_PERIJA`, `MUN_ZULIA_COLON`, `MUN_ZULIA_FRANCISCO_JAVIER_PULGAR`, `MUN_ZULIA_CATATUMBO`, `MUN_ZULIA_JESUS_MARIA_SEMPRUM`, `MUN_ZULIA_SUCRE`, `MUN_ZULIA_ALMIRANTE_PADILLA`).
   - Capa `zulia-municipalities-fill`: relleno táctico semitransparente que se ilumina en `#F59E0B` (`fill-opacity: 0.34`) al seleccionarse el municipio.
   - Capa `zulia-municipalities-border` (`minzoom: 8.5`, `maxzoom: ZOOM_TACTICO - 0.5`, `'line-join': 'round'`, `'line-cap': 'round'`): contorno geográfico real que resalta en `#00FF66` (`line-width: 3.2`, `line-opacity: 0.98`) cuando está seleccionado.
5. **Ciudades, Metrópolis y Cabeceras Municipales (`source: 'tactical-cities'` — `/map/theatre_cities.json`, `minzoom: 8.5`, `maxzoom: 15.0`):**
   - Capas `cities-glow` (`#F59E0B`), `cities-point` y etiquetas `cities-labels` en mayúsculas con halo `#0A0B08`.
   - En la segunda vista (Estrato 2), hacer clic sobre el nombre (`cities-labels`), el punto (`cities-point`) o el polígono (`zulia-municipalities-fill`) selecciona e ilumina inmediatamente la delimitación geográfica real del municipio correspondiente vía `municipalityId`.
6. **Cuadrícula Táctica Vectorial de Viewport Completo (`source: 'tactical-viewport-grid'` & `'tactical-viewport-grid-hover'`, `minzoom: 14.0`):**
   - Sustituye al renderizador parcial de un solo `CanvasSource` por una malla vectorial continua en GPU calculada sobre todo `map.getBounds()` (expandido 1 sector de margen) con líneas continuas horizontales y verticales generadas mediante `tileFractionToLngLat`.
   - Capa `tactical-viewport-grid-lines`: renderiza simultáneamente el 100% de las celdas visibles en pantalla (`#A3E635`, `line-opacity: 0.28`) y bordes de sector (`#00FF66`, `line-width: 1.6`), sin parches vacíos ni borrados al desplazar la cámara.
   - Capas `tactical-viewport-grid-hover-fill` y `tactical-viewport-grid-hover-line`: resaltan en `#FACC15` la celda bajo cursor o seleccionada.

### 3.4. Pipeline Topológico Bottom-Up (Single Topological Source of Truth — TopoJSON)
Para erradicar las brechas y solapamientos de 0.21–2.39 km entre estados adyacentes, municipios del Zulia y la línea de costa continental, la generación cartográfica unifica todas las capas en **una sola topología TopoJSON compartida** mediante `topojson-server@^3.0.1`, `topojson-client@^3.1.0` y `topojson-simplify@^3.0.3`:

1. **`scripts/build-theatre-vector-data.mjs` (Generador Bottom-Up Canónico):**
   - Descarga los municipios oficiales de Venezuela a resolución completa (`geoBoundaries-VEN-ADM2.geojson`) y `geoBoundaries-VEN-ADM1_simplified.geojson` únicamente para: (a) clasificar los 334 municipios válidos (excluyendo `'Zona en Reclamación'`) en su estado padre `REG_VE_01`..`REG_VE_24` mediante muestreo de puntos interiores (`classifyMunicipalityState`) conservando `shapeISO`, y (b) extraer `Dependencias Federales` (`BUF_MARITIME_CARIBE`, `shapeISO: 'VE-W'`).
   - Mapea los 21 municipios de `REG_VE_02` a sus IDs canónicos `MUN_ZULIA_*` y `cityName` sincronizados con `/map/theatre_cities.json`, soportando exportación parametrizada (`--states=REG_VE_02` por defecto o `--states=ALL`), `--min-weight=1.5e-5`, `--skip-roads` y `--rebuild-roads` (preservando `theatre_roads.json` existente salvo `--rebuild-roads`).
   - Pre-ajusta coordenadas (`COORD_DECIMALS = 5`, `cleanGeometry`), construye **una única topología** (`topojsonServer.topology({ municipalities, federal_dependencies }, 1e5)`), ejecuta `topojsonSimplify.presimplify` + `preserveClosedArcs` (protege islas de arco único con $\ge 4$ vértices) + `topojsonSimplify.simplify(..., 1.5e-5)`, y antes de extraer GeoJSON ejecuta `decodeAndSnapTopoArcs(topo, 5)` (decodifica arcos, redondea a 5 decimales, elimina duplicados consecutivos manteniendo $\ge 2$ puntos y ejecuta `delete topo.transform`).
   - Exporta bit-a-bit desde el mismo `topo` validado por `verifyTopologyInvariants`:
     - `/map/theatre_regions.json`: 25 polígonos (`REG_VE_01`..`REG_VE_24` disueltos mediante `topojsonClient.merge` + `BUF_MARITIME_CARIBE`).
     - `/map/zulia_municipalities.json`: 21 municipios de `REG_VE_02`.
     - `/map/theatre_borders_mesh.json`: `FeatureCollection` de `MultiLineString` con 3 features (`mesh_state_internal`, `mesh_theatre_exterior`, `mesh_federal_dependencies`) sin segmentos duplicados.
2. **`scripts/download-world-land.mjs` (Masa Continental Global Sincronizada):**
   - Descarga `ne_50m_admin_0_countries.geojson` (32 códigos de América/Caribe + `GUF` de `FRA` y `BES` de `NLD`) y `ne_110m_admin_0_countries.geojson` para el resto del globo, excluyendo el polígono grueso de Venezuela en Natural Earth.
   - Invoca `buildTheatreTopology({ targetStates: ['REG_VE_02'] })` e inyecta `theatre.venezuelaLandGeometry` como feature `VEN`, garantizando coincidencia bit-a-bit (`0.000 m`) con `/map/theatre_regions.json` y `/map/theatre_borders_mesh.json`.
3. **`scripts/optimize-regions.mjs` (Deprecado / Delegado):**
   - Queda prohibida la simplificación Douglas-Peucker independiente por anillo. Al ejecutarse, `optimize-regions.mjs` emite advertencia `[DEPRECATION]` y delega directamente a `runBuildPipeline({ ...cliOptions, skipRoads: true })`.

---

# 4. PICKING ANALÍTICO O(1), EMPAQUETADO BINARIO (`TacticalBitMap`) Y TOPOLOGÍA (`WorldMapEngine`)

### 4.1. Motor de Coordenadas y Picking Analítico $O(1)$ (`src/domains/world/core/coordinates.ts`)
El puente espacial *OpenPlace Bridge* convierte cualquier par geodésico WGS84 (`LngLat = [number, number]`) al sector planetario Web Mercator y a su celda interna dentro de una cuadrícula táctica de $20 \times 20$ en tiempo constante $O(1)$, sin necesidad de *raycasting* sobre miles de polígonos:

- **Constantes Canónicas Exportadas:**
  - `ZOOM_GLOBAL = 3.5` (Nivel 1: Macro-Geopolítica, $z < 10.0$)
  - `ZOOM_OPERACIONAL = 10.0` (Nivel 2: Red Urbana, Ciudades, Avenidas y Unidades, $10.0 \le z < 15.0$)
  - `ZOOM_TACTICO = 15.0` (Nivel 3: Microjuego, Combate en Celda y Construcción Espacial, $z \ge 15.0$)
  - `TILE_SIZE = 1000` (Resolución de cada `TileCanvas` proyectado: $1000 \times 1000\text{ px}$, es decir, $50 \times 50\text{ px}$ por celda en grilla de $20 \times 20$)
  - `EARTH_RADIUS_M = 6_371_000`
- **Funciones de Transformación Analítica:**
  - `lngLatToGridCoords(lngLat: LngLat, gridSize = 20, zoom = ZOOM_TACTICO): TacticalGridCoords`  
    Clampea la latitud al límite Web Mercator ($\pm 85.05112878^\circ$), proyecta $(x, y)$ en escala $n = 2^{\text{zoom}}$ y devuelve `{ sector: [sectorX, sectorY], cell: [cellX, cellY], pixel: [pixelX, pixelY] }`.
  - `tileFractionToLngLat(tileXFloat: number, tileYFloat: number, zoom = ZOOM_TACTICO): LngLat`  
    Inversa analítica mediante $\arctan(\sinh(\pi \cdot (1 - 2y/n)))$.
  - `gridCoordsToLngLat(sector: [number, number], cell: [number, number], gridSize = 20, zoom = ZOOM_TACTICO): LngLat`  
    Devuelve el centroide geográfico exacto `(cell + 0.5) / gridSize` de cualquier celda táctica.
  - `getTileBounds(sectorX: number, sectorY: number, zoom = ZOOM_TACTICO): QuadLngLatBounds`  
    Devuelve los 4 vértices `[Top-Left, Top-Right, Bottom-Right, Bottom-Left]` requeridos por MapLibre GL para anclar el `CanvasSource` del sector activo.
  - `traceSupplyLine(from: [number, number], to: [number, number]): [number, number][]`  
    Algoritmo raster entero de Bresenham para trazar líneas continuas de suministro entre sectores o celdas.

### 4.2. Empaquetado Binario Ultraligero (`src/domains/world/core/tacticalBitmap.ts`)
La clase `TacticalBitMap` comprime máscaras booleanas espaciales en un `Uint8Array` direccionado a nivel de bit con redimensionamiento dinámico y serialización instantánea Base64 (`toBase64()` / `TacticalBitMap.fromBase64(base64)`):
- **Niebla de Guerra Táctica ($20 \times 20 = 400\text{ celdas}$):** $400\text{ bits} / 8 = \mathbf{50\text{ bytes}}$ por sector.
- **Estado de Alerta / Soberanía Macro-Globo ($3,000\text{ regiones}$):** $3,000\text{ bits} / 8 = \mathbf{375\text{ bytes}}$.
- **Métodos:** `setBit(index: number, value: boolean): void`, `getBit(index: number): boolean`, `toBase64(): string`, `static fromBase64(base64: string): TacticalBitMap`.

### 4.3. Motor Geopolítico, Mantenimiento y Conectividad BFS (`src/domains/world/core/worldMapEngine.ts`)
- **`WorldMapEngine.isRegionCapturable(region: WorldRegion): boolean`**: Verifica si una región permite captura de soberanía (las capitales como `REG_VE_01` son capturables y otorgan el **Buff Regional de +5% recursos/logística** conforme al Pilar Canónico 5, mientras que los 7 buffers fronterizos `BUF_*` tienen `isCapturable: false`).
- **`WorldMapEngine.canAttackRegion(targetRegionId, ownedRegionIds, adjacencyGraph, isEmergencyLandingAllowed)`**: Valida que la corporación atacante posea una frontera terrestre o puente marítimo adyacente al objetivo (o autorización de desembarco expedicionario si tiene 0 territorios).
- **`WorldMapEngine.calculateCorporateUpkeep(provincesCount, buildingsList)`**: Calcula el mantenimiento horario en Créditos Energéticos (`EC`) sumando el coste base provincial y de estructuras (`mine: 60`, `refinery: 110`, `factory: 180`, `garrison_bunker: 250`, `rail_station: 80` por nivel) multiplicado por el factor superlineal de sobre-expansión imperial (`calculateOverExpansionFactor`).
- **`WorldMapEngine.calculateTcpResolution(currentState, winnerClanId, isDecisiveVictory)`**: Resuelve el drenaje o recuperación de Puntos de Control Territorial (`TCP`, delta de `1500` en victoria decisiva o `1200` estándar) y voltea la soberanía con estado `'cooldown_priority'` cuando `updatedTcp <= 0`.
- **`traceSupplyLine(x0, y0, x1, y1)` & `validateSupplyLineConnectivity(regionId, capitalRegionIds, controlledRegionIds, adjacencies)`**: Valida mediante búsqueda en anchura (**BFS**) si una provincia controlada mantiene una ruta logística ininterrumpida hacia la Capital/Nodo Primario a través de aristas que no tengan la bandera `TOPOLOGY_FLAGS.IMPASSIBLE`.

### 4.4. Partición Espacial 2D de Red Vial (`src/domains/world/core/spatialRoadIndex.ts`)
Para evitar búsquedas por fuerza bruta $O(N)$ al interactuar con carreteras y construcciones de feudos:
- `SpatialRoadIndex` divide el plano geodésico en celdas de $0.08^\circ$ ($\approx 8.8\text{ km}$) indexadas con una función pura de hash bitwise de 32 bits (`getCellKey(cx, cy)`).
- `snapCoordinatesToNearestNode(coords)` e `isLocationAdjacentToRoad(coords, maxDistanceKm = 0.15)` inspeccionan las 9 celdas concéntricas inmediatas en tiempo constante $O(1)$, validando la regla de negocio de que los edificios industriales solo pueden erigirse adyacentes a una vía logística.

---

# 5. MATRIZ DE COBERTURA: 24 ENTIDADES FEDERALES Y 7 ZONAS BUFFER

El teatro inicial de operaciones cubre la totalidad de la República de Venezuela y sus fronteras estratégicas, sincronizado al 100% con el seed canónico `CANONICAL_VENEZUELA_REGIONS` en `src/domains/world/core/politicalAliceEngine.ts` y `useTerritoryMap.ts`:

| Código de Región | Entidad Federal / Zona (`politicalAliceEngine.ts`) | Capital / Nodo Estratégico | Bioma Táctico | Commodity Primaria (RGO) & Tier | Eje Vial / Troncal Primaria |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `REG_VE_01` | **Distrito Capital - Caracas** | Caracas (Capital Nacional Capturable, Buff +5%) | Urbano denso (`BIO-URB`) | `petroquimica_fina` (T5, 800/h) | Autopista Regional del Centro / T-01 / T-09 |
| `REG_VE_02` | **Zulia - Maracaibo** | Maracaibo / Cabimas (`CHK-MARACAIBO`) | Planicie petrolera (`BIO-PLA`) | `crudo_ligero` (T4, 600/h) | Troncal 3 / Troncal 6 / Puente Gral. Rafael Urdaneta |
| `REG_VE_03` | **Bolívar - Ciudad Guayana** | Ciudad Guayana / Sidor / Guri | Tierras Altas / Minero (`BIO-HGH`) | `hierro_bauxita` (T5, 750/h) | Troncal 10 / Eje Fluvial Orinoco |
| `REG_VE_04` | **Anzoátegui - Barcelona/PLC** | Barcelona / Puerto La Cruz | Planicie petroquímica (`BIO-PLA`) | `crudo_pesado` (T4, 550/h) | Troncal 9 / Troncal 16 |
| `REG_VE_05` | **Carabobo - Valencia/Pto. Cabello** | Valencia / Puerto Cabello | Urbano industrial / Puerto (`BIO-URB`) | `ensamblaje_mec` (T4, 580/h) | Autopista del Centro / Troncal 1 / Puerto Marítimo |
| `REG_VE_06` | **Miranda - Valles del Tuy** | Los Teques / Valles del Tuy | Planicie manufacturera (`BIO-PLA`) | `manufactura_ligera` (T3, 400/h) | Troncal 9 / Conexión Caracas |
| `REG_VE_07` | **Lara - Barquisimeto** | Barquisimeto | Nudo logístico ferroviario (`BIO-PLA`) | `nudo_ferroviario` (T3, 420/h) | Troncal 1 / Troncal 4 / Troncal 17 |
| `REG_VE_08` | **Aragua - Maracay** | Maracay | Base aeromilitar y blindados (`BIO-URB`) | `blindaje_aereo` (T3, 450/h) | Autopista Regional del Centro / T-02 |
| `REG_VE_09` | **Táchira - San Cristóbal** | San Cristóbal / San Antonio | Montaña andina (`BIO-HGH`) | `carbon_aduanero` (T3, 380/h) | Troncal 1 (Panamericana) / Frontera Cúcuta |
| `REG_VE_10` | **Mérida - Cordillera Andina** | Mérida / El Vigía | Alta montaña andina (`BIO-HGH`) | `silicio_optico` (T3, 350/h) | Troncal 7 (Trasandina) / T-01 |
| `REG_VE_11` | **Falcón - Paraguaná** | Coro / Punto Fijo (CRP Amuay/Cardón) | Planicie costera (`BIO-PLA`) | `refinacion_crp` (T4, 520/h) | Troncal 3 / Troncal 4 |
| `REG_VE_12` | **Monagas - Maturín** | Maturín | Sabana petrolera (`BIO-PLA`) | `gas_natural` (T4, 500/h) | Troncal 10 / Troncal 13 |
| `REG_VE_13` | **Sucre - Cumaná/Golfo de Paria** | Cumaná / Carúpano / Güiria (`CHK-PARIA`) | Costero marítimo (`BIO-ARC-ISL`) | `astillero_naval` (T3, 420/h) | Troncal 9 / Chokepoint Golfo de Paria |
| `REG_VE_14` | **Nueva Esparta - Margarita** | Porlamar / La Asunción | Insular caribeño (`BIO-ARC-ISL`) | `radar_zonafranca` (T2, 300/h) | Ferry Marítimo Puerto La Cruz - Punta de Piedras |
| `REG_VE_15` | **Barinas - Llanos Altos** | Barinas | Llanos agrícolas y crudo (`BIO-PLA`) | `agropecuaria_crudo` (T3, 380/h) | Troncal 5 (Eje Llanero) |
| `REG_VE_16` | **Portuguesa - Acarigua** | Acarigua / Guanare | Agroindustrial (`BIO-PLA`) | `biocombustibles` (T3, 390/h) | Troncal 5 / Autopista José Antonio Páez |
| `REG_VE_17` | **Guárico - Calabozo/San Juan** | San Juan de los Morros / Calabozo | Corazón llanero (`BIO-PLA`) | `satelital_canteras` (T3, 410/h) | Troncal 2 / Troncal 12 / Troncal 13 |
| `REG_VE_18` | **Trujillo - Andes Centrales** | Trujillo / Valera | Valle andino (`BIO-HGH`) | `silice_cemento` (T2, 280/h) | Troncal 1 / Troncal 7 |
| `REG_VE_19` | **Yaracuy - San Felipe** | San Felipe | Valle fértil minero (`BIO-PLA`) | `cobre_fertilizantes` (T2, 300/h) | Troncal 11 |
| `REG_VE_20` | **Cojedes - San Carlos** | San Carlos | Enlace central llanero (`BIO-PLA`) | `pastizales_roca` (T2, 290/h) | Troncal 5 |
| `REG_VE_21` | **Apure - San Fernando** | San Fernando de Apure | Llanos bajos / Frontera fluvial (`BIO-PLA`) | `eje_fluvial` (T2, 310/h) | Troncal 2 / Troncal 19 / Eje Río Apure |
| `REG_VE_22` | **Delta Amacuro - Caños Orinoco** | Tucupita | Delta fluvial / Estuario (`BIO-ARC-ISL`) | `bauxita_delta` (T3, 370/h) | Vías fluviales Delta del Orinoco |
| `REG_VE_23` | **Amazonas - Puerto Ayacucho** | Puerto Ayacucho | Selva profunda (`BIO-JGL`) | `tierras_raras` (T3, 360/h) | Troncal 12 / Eje Alto Orinoco |
| `REG_VE_24` | **Guayana Esequiba - Zona Reclamación** | Tumeremo / Esequibo Occidental | Frontera y Selva Minera (`BIO-JGL`) | `oro_diamantes` (T4, 520/h) | Troncal 10 / Zona en Reclamación |
| `BUF_CO_01` | **Norte de Santander (Cúcuta)** | Cúcuta (Buffer Colombia) | Montaña fronteriza (`BIO-HGH`) | `mineral_metalico` (T3, No Jugable) | Cruce Binacional San Antonio - Cúcuta |
| `BUF_CO_02` | **La Guajira (Maicao)** | Maicao (Buffer Colombia) | Planicie árida (`BIO-PLA`) | `mineral_metalico` (T2, No Jugable) | Cruce Binacional Paraguachón |
| `BUF_CO_03` | **Arauca (Arauquita)** | Arauca (Buffer Colombia) | Llanos fronterizos (`BIO-PLA`) | `mineral_metalico` (T2, No Jugable) | Eje Fluvial Río Arauca |
| `BUF_BR_01` | **Roraima (Pacaraima / Boa Vista)** | Pacaraima (Buffer Brasil) | Selva Fronteriza Sur (`BIO-JGL`) | `tierras_raras` (T3, No Jugable) | Troncal 10 Sur / BR-174 |
| `BUF_GY_01` | **Demerara (Georgetown)** | Esequibo Oriental (Buffer Guyana) | Planicie atlántica (`BIO-PLA`) | `bauxita_delta` (T3, No Jugable) | Corredores Atlánticos |
| `BUF_TT_01` | **Trinidad & Tobago** | Boca de Serpiente (Buffer Trinidad) | Canal Marítimo Oriental (`BIO-ARC-ISL`) | `astillero_naval` (T3, No Jugable) | Estrecho `CHK-PARIA` (Peaje 4.0%) |
| `BUF_CW_01` | **Antillas Neerlandesas (Curazao/Aruba)** | Curazao / Aruba (Buffer Antillas) | Fachada Caribe Norte (`BIO-ARC-ISL`) | `radar_zonafranca` (T2, No Jugable) | Corredor Marítimo Petrolero Paraguaná |

---

# 6. SEMANTIC LOD (3 ESTRATOS), CICLO DE VIDA DE CÁMARA Y MICROJUEGO TÁCTICO

La cámara de MapLibre GL se inicializa sobre el **Epicentro Operacional del Teatro Cabimas (Zulia)** en `center: [-71.455, 10.395]` con `zoom: 9.8` (`minZoom: 2.0`, `maxZoom: 18.0`). El método `getStratumForZoom(z)` en `src/domains/world/components/TacticalWorldMap.tsx` y las constantes de `src/domains/world/core/coordinates.ts` gobiernan 3 estratos de nivel de detalle semántico (*Semantic LOD*), disparando una transición cinética de enfoque (`tactical-stratum-blur` durante $260\text{ ms}$) al cruzar cada umbral:

1. **Estrato 1 — Vista Macro-Estratégica (`z < 10.0`, `ZOOM_GLOBAL = 3.5`):**
   - Polígonos de soberanía estadal (`provinces-fill` y resaltados `provinces-borders` filtrados exclusivamente a estados `isSelected || isUnderSiege`) más la malla única de fronteras (`tactical-borders-mesh`) y red vial troncal nacional en naranja (`tactical-roads`).
   - El contorno continental exterior `world-land-border` aplica `maxzoom: 7.5` con interpolación de opacidad (`4.5 -> 0.65`, `7.5 -> 0`), desvaneciéndose antes del Estrato Operacional para impedir líneas duplicadas de baja resolución.
   - A partir de `z >= 8.5` emergen las delimitaciones municipales reales del Estado Zulia (`zulia-municipalities`) y los nodos/etiquetas de ciudades (`tactical-cities`).
   - En la Capa 1 Geopolítica (`useTerritoryMap.ts` y `politicalAliceEngine.ts`), las declaraciones de ataque y asedios regionales también pueden ejecutarse mediante resolución política determinista sobre los Puntos de Control Territorial (`TCP`).

2. **Estrato 2 — Teatro Operacional, Avenidas Naranjas y Municipios del Zulia (`10.0 <= z < 15.0`, `ZOOM_OPERACIONAL = 10.0`):**
   - Activación de la malla vial urbana real exclusivamente en tonos naranjas/ámbar (`tactical-urban-roads`, `minzoom: 9.5`) sin marcadores o unidades de prueba sobre el mapa.
   - Visibilidad completa de las 21 cabeceras municipales y ciudades del Zulia (`tactical-cities`, `minzoom: 8.5`): al hacer clic en el nombre de cualquier ciudad/municipio se selecciona e ilumina su delimitación geográfica poligonal real en `zulia-municipalities` (`#F59E0B` relleno / `#00FF66` contorno).

3. **Estrato 3 — Cuadrícula Vectorial de Viewport Completo y Microjuego Espacial (`z >= 15.0`, `ZOOM_TACTICO = 15.0`):**
   - **Corte estricto de LOD:** Todas las capas macro y operacionales de polígonos y fronteras (`provinces-fill`, `provinces-borders`, `provinces-vulnerable-halo`, `tactical-borders-mesh`, `zulia-municipalities-fill`, `zulia-municipalities-border`) declaran `maxzoom: ZOOM_TACTICO - 0.5` (`14.5`), dejando el terreno táctico completamente limpio al cruzar `z >= 14.5` (y `world-land-border` ya está apagado desde `z >= 7.5`).
   - `syncViewportGrid` actualiza en `load`, `move`, `moveend` y `zoom` las fuentes vectoriales GPU `tactical-viewport-grid` y `tactical-viewport-grid-hover` cubriendo el 100% del viewport actual (`map.getBounds()` + 1 sector de margen) con cuadrícula continua de $20 \times 20$ celdas por sector, sin parches vacíos ni borrado de sectores adyacentes al desplazar la cámara.
   - **Despliegue y Construcción In-Situ (`spatialDeploymentService.ts`):** Al seleccionar cualquier celda a `z >= 15.0`, el HUD inferior (`MicroTacticalDeckHUD`) expone las coordenadas `SEC [x,y] • CELL [x,y]`, el tipo de micro-terreno (`urban_asphalt`, `industrial_compound`, `defensive_ridge`, `open_plains`), las estrellas de defensa y permite abrir el `TacticalUnitDeployModal` o el `TacticalConstructionDrawer` sincronizados en tiempo real con Supabase CDC.

---

# 7. AUDITORÍA TOPOLÓGICA DETERMINISTA (`0.000 m`) Y VERIFICACIÓN E2E PLAYWRIGHT

La integridad matemática de la cartografía vectorial y su cumplimiento estricto de Semantic LOD se auditan en dos niveles automatizados:

### 7.1. Auditoría Determinista CLI y Suite TypeScript (`npm run test:cartography`)
Implementada en `scripts/verify-map-topology.mjs` (CLI `node scripts/verify-map-topology.mjs [--json]`) y ejecutada en conjunto con `coordinatesAndBitmap.test.ts` mediante `src/domains/world/__tests__/cartographyTopologyAudit.test.ts`:
- **Pre-check SSOT (`@domains/world`):** Verifica constantes (`ZOOM_GLOBAL === 3.5`, `ZOOM_OPERACIONAL === 10.0`, `ZOOM_TACTICO === 15.0`), los 24 IDs `REG_VE_01`..`REG_VE_24` + `BUF_MARITIME_CARIBE`, los 21 IDs `MUN_ZULIA_*`, `signedShoelaceArea` y `pointToSegmentDistKm`.
- **Test 1 (`auditCanonicalIdsAndGeometry`):** Valida las 25 features en `theatre_regions.json`, 21 features (`stateId === 'REG_VE_02'`) en `zulia_municipalities.json`, $\ge 4$ vértices por anillo, anillos cerrados, cero vértices consecutivos duplicados y área Shoelace no nula.
- **Test 2 (`auditStateToStateBoundaries`):** Audita la coherencia estado-estado bit-a-bit (`0.000 m`): cero colisiones en el mismo sentido, devanado opuesto `(u -> v)` vs `(v -> u)` en las aristas internas compartidas, cero near-misses internos (`0.0001–2.5 km`), cero huecos/slivers en el grafo disuelto e igualdad del 100% con `mesh_state_internal` en `theatre_borders_mesh.json`.
- **Test 3 (`auditZuliaMunicipalitiesCoherence`):** Verifica coincidencia al 100% de segmentos y vértices exteriores (`multiplicidad === 1`) entre `zulia_municipalities.json` y `REG_VE_02` en `theatre_regions.json`.
- **Test 4 (`auditBordersMeshUniqueness`):** Verifica cero segmentos no dirigidos duplicados y cero segmentos de longitud cero entre `mesh_state_internal`, `mesh_theatre_exterior` y `mesh_federal_dependencies` en `theatre_borders_mesh.json`.
- **Test 5 (`auditWorldLandVenezuelaCoherence`):** Valida que la única feature `VEN` de `world_land.json` coincide al 100% (`0.000 m`) con el perímetro exterior de `theatre_regions.json` y con `mesh_theatre_exterior + mesh_federal_dependencies`.
- **Test 6 (`auditTacticalWorldMapInvariants`):** Auditoría estática read-only de `TacticalWorldMap.tsx` que verifica cero URLs externas `http(s)` / capas `raster`, `maxzoom` en las 4 capas de contorno (`world-land-border`, `provinces-borders`, `tactical-borders-mesh`, `zulia-municipalities-border`), `tolerance: 0` en las 3 fuentes tácticas (`tactical-provinces`, `tactical-borders-mesh`, `zulia-municipalities`), filtro exclusivo de `provinces-borders` (`isSelected` / `isUnderSiege`) y el orden Z estricto de capas.

### 7.2. Verificación E2E en Chromium WebGL (`npm run test:qa`)
La suite `tests/e2e/game-playtester.spec.ts` inspecciona `window.__TACTICAL_MAP_INSTANCE__` y `window.__TACTICAL_QA_BRIDGE__` sobre el renderizador real en Chromium comprobando:
- Carga completa de fuentes locales (`world-land`, `tactical-provinces`, `tactical-borders-mesh`, `zulia-municipalities`) con `tolerance === 0`, `buffer === 64`, `maxzoom` esperados (`7.5` y `14.5`) y orden Z estricto.
- **Estrato Global (`zoom 5.5`, `[-66.5, 8.2]`):** `provinces-fill`, `tactical-borders-mesh` y `world-land-border` visibles; `zulia-municipalities-*` inactivos.
- **Estrato Operacional (`zoom 10.5`, Lago de Maracaibo `[-71.35, 9.95]` y Cabimas `[-71.455, 10.395]`):** `world-land-border` apagado (`0` features); `zulia-municipalities-fill`, `zulia-municipalities-border` y `tactical-borders-mesh` activos con Cabimas, Mene Grande y Bobures visibles.
- **Estrato Táctico (`zoom 15.5`, Cabimas `[-71.455, 10.395]`):** `tactical-viewport-grid-lines` activo cubriendo el viewport $20 \times 20$; `0` features renderizadas en `world-land-border`, `provinces-fill`, `provinces-borders`, `tactical-borders-mesh`, `zulia-municipalities-fill` y `zulia-municipalities-border`, con `0` errores de consola/red y `0` peticiones a servidores externos de teselas raster.
