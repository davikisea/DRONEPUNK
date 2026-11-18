# Changelog — DRONEPUNK 0.0.1

Todos los cambios notables de **DRONEPUNK 0.0.1** serán documentados en este archivo.

El formato se basa en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/),
y este proyecto se adhiere a [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [0.0.1] - Sistema MMO 2D en Vivo, Logística Dual, Devastación y Programación de Drones (2026-11-18)

### Cierre del Bucle MMO 2D en Mapa WebGL (`TacticalWorldMap.tsx` + Migración `20261118000004`)

#### Added
- **Migración `20261118000004_mmo_dual_logistics_devastation_and_city_bases_seed.sql` (39 migraciones consolidadas)**:
  - Proyección analítica `lat_lng_to_h3_res9` SafeInteger IEEE-754 (`0x0009000000000000n`) alineada 1:1 con `src/domains/world/core/coordinates.ts`.
  - RPCs atómicas `create_infra_edge`, `execute_collector_haul`, `trigger_vulnerability_handshake` (Handshake 120s), `damage_infrastructure` (estados `DAMAGED` / `RUINED` / `severed` con saqueo del 35% `tech_scrap` sin borrado permanente) y `seed_historical_city_bases()` (28 enclaves históricos conquistables en `theatre_cities.json`).
  - Actualización de `sync_pipeline_logistics` para manejar flujo continuo por tuberías operacionales y detención por almacén finito (`storage_cap`, `is_production_halted = true`) en extractores aislados.
- **Renderizado en Vivo e Interacción Directa en Mapa WebGL (`TacticalWorldMap.tsx`)**:
  - Capas GPU `db-mmo-infra-edges` (`pipeline`, `road`, `bridge`, estado `operational`/`severed`) y `db-mmo-buildings` (bases históricas, viviendas, extractores, depósitos, alerta `ALMACÉN LLENO`, estados `OPERATIONAL`/`DAMAGED`/`RUINED`) sincronizadas vía Supabase Realtime CDC.
  - Panel contextual in-situ (`map-infra-action-panel`) para capturar enclaves, abrir producción Advance Wars (`BaseProductionModal`), recolectar ciudadanos, sincronizar tuberías, acarrear con unidades `collector`, trazar aristas entre hexágonos H3, iniciar Handshake 120s, atacar infraestructura y reparar ruinas (~35% costo).
- **Interpolación en Tiempo Real de Drones Programados (`TacticalRtsEngine` + `DroneSchedulerDrawer.tsx`)**:
  - Interpolación continua de `unit_command_schedules` (`move`, `patrol`, `auto_collect`, `skirmish`, `scheduled_deploy`) y suscripción Realtime CDC en bitácora.
- **Pruebas Deterministas y E2E**:
  - Nueva suite `src/domains/economy/__tests__/dualLogisticsAndInfraDevastation.test.ts` (4/4 pruebas deterministas superadas) y cobertura en `tests/e2e/game-playtester.spec.ts`.

---

## [0.0.1] - Consolidación Modular, Zoom Continuo & Soberanía Territorial (2026-11-06)

### Arquitectura de 3 Vistas de Zoom Continuo & Soberanía Territorial C4ISR

Implementación integral y certificación de la arquitectura unificada en 3 niveles de interacción espacial sobre el mismo mapa continuo (MapLibre WebGL 2.0):

#### Added
- **Nivel 1 (Macro / Geopolítico, Zoom < 10.0)**:
  - `StateInspectorDrawer.tsx`: Panel C4ISR que se abre reactivamente al hacer clic en un estado; expone PIB de Guerra ($G/hr), rendimiento de recursos estratégicos (Crudo, Acero, Raros, Blindaje), nivel de defensa y heráldica del Clan/Facción hegemónico.
  - `StateSovereignDeckModal.tsx`: Estado Mayor de Soberanía que permite a Líderes de Clan y Gestores de Facción modificar el nombre canónico y soberano de Estados y Países (e.g. Confederación Ártica de Venezuela), redefinir lemas y emitir proclamaciones bélicas en vivo.
  - `stateSovereigntyService.ts` & `20261106_state_sovereignty_rbac.sql`: Capa SSOT y políticas RLS en Postgres que garantizan que únicamente oficiales autorizados muten la soberanía territorial.
- **Nivel 2 (Operacional / Red Urbana, Zoom 10.0 a < 15.0)**:
  - Vectorización y renderizado de la **Red Vial Urbana Real** (`theatre_urban_roads.json`) y **Ciudades** (`theatre_cities.json`) activados en el umbral exacto `z = 10.0`.
  - Inclusión de arterias y avenidas de ciudades reales: Cabimas (Av. Intercomunal, Carretera H/K/J, Av. 32), Maracaibo (Av. Bella Vista, Las Delicias, La Limpia, C2, El Milagro, 5 de Julio), Caracas (Av. Francisco de Miranda, Libertador, Baralt, Urdaneta, Cota Mil), Valencia y Barquisimeto.
  - `operationalUnitsService.ts`: Registro GeoJSON de tropas operacionales desplegadas en el mapa con callsigns, HP y colores de facción visibles desde `z = 10.0`.
- **Nivel 3 (Microjuego Táctico / Construcción In-Situ, Zoom >= 15.0)**:
  - `MicroTacticalDeckHUD.tsx`: Consola táctica inferior que emerge reactivamente en `z = 15.0`.
  - `spatialDeploymentService.ts`: Motor de asignación espacial analítica $O(1)$ (`Sector X, Y`, `Cell X, Y`, Coordenadas WGS84, Cobertura 10-40% y estado de ocupación).
  - `TacticalUnitDeployModal.tsx`: Consola de despliegue in-situ para tanques medianos, jeeps de reconocimiento, artillería autopropulsada, blindados antiaéreos y helicópteros con callsign personalizado y validación de costos.
  - `TacticalConstructionDrawer.tsx`: Ingeniería de fortificación in-situ para construir Refinerías de Crudo, Fundiciones Microchip C4ISR, Búnkeres de Munición y Estaciones Radar FLIR conectadas con la economía industrial.
- **Pruebas Automatizadas y Certificación E2E Multimodal**:
  - `src/domains/world/__tests__/coordinatesAndBitmap.test.ts` (10/10 pasaron).
  - `src/domains/world/__tests__/stateSovereignty.test.ts` (7/5 pasaron).
  - `src/domains/world/__tests__/urbanRoadsAndCities.test.ts` (6/6 pasaron).
  - `src/domains/world/__tests__/spatialDeployment.test.ts` (6/6 pasaron).
  - `tests/e2e/game-playtester.spec.ts`: Suite E2E de Playwright que valida el Metajuego Geopolítico Capa 1 y las 3 Vistas de Zoom en Chromium real (2/2 pasaron en 2.1m con 0 errores fatales).

#### Fixed
- **ReferenceError `useMemo` en `WarLobbyHub.tsx`**: Añadida la importación faltante de `useMemo` desde React.
- **Strict Mode Violation en Playwright**: Resuelto el conflicto de selector duplicado en el botón "SOBERANÍA" mediante coincidencia exacta.
- **Intercepción de Puntero en Modales**: Implementado `force: true` y `dispatchEvent('click')` para garantizar disparos de eventos sobre botones y descarte de modales sin bloqueos por overlays del Bark Engine.
- **Filtro de Ruido WebAudio en Headless**: Sanitizado el oráculo de errores en Playwright para ignorar advertencias de emulación WebAudio en entornos headless de CI.

---

## [0.0.1] - Núcleo WebGL Zero-Raster, Metajuego & Economía Player-Driven (2026-11-05)

### Lanzamiento DRONEPUNK 0.0.1 — Soberanía Territorial Persistente & Consola C4ISR Atompunk

Consolidación acumulativa de **DRONEPUNK 0.0.1**: arquitectura del motor táctico por turnos (TBS), experiencia visual de historieta cinética, motor geopolítico persistente (Project Alice Engine × Consola C4ISR Atompunk), expansión territorial celular y metajuego de soberanía masiva.

### Fase 1 & 2: Soberanía Persistente (Project Alice Engine × Consola C4ISR Atompunk)

### Fase 1: Arquitectura Cartográfica WebGL 2.0 Venezuela & Certificación E2E Multimodal

#### Added
- **Arquitectura Cartográfica Zero-Raster Local (Estilo WarEra)**:
  - Eliminación total de dependencias externas y API keys comerciales de CartoDB/Mapbox.
  - Generación de `public/map/theatre_regions.json` (164 KB) con los 24 estados oficiales de Venezuela (geoBoundaries simplificado).
  - Generación de `public/map/theatre_roads.json` (2.1 MB) con la red vial troncal de Venezuela (OpenStreetMap Overpass: Troncales 1 a 19 y autopistas) optimizada con compresión Douglas-Peucker.
  - Masas continentales circundantes `public/map/world_land.json` (134 KB) para dar contexto geográfico al Caribe y Sudamérica.

#### Changed
- **Pantalla de Carga 100% Cinemática y Automática (`src/domains/tactics/components/GeotacticsLoadingScreen.tsx`)**:
  - Transición automática al Cuartel General y mapa WebGL en cuanto la precarga de búferes alcanza el 100%.
  - Actualización de la suite E2E de Playwright (`tests/e2e/game-playtester.spec.ts`) para verificar la auto-transición.
- **Consolidación de Arquitectura WebGL 2.0 Exclusiva (`src/domains/world/components/WarLobbyHub.tsx` & `TacticalWorldMap.tsx`)**:
  - Establecimiento de `TacticalWorldMap` (`src/domains/world/components/TacticalWorldMap.tsx`) como renderizador cartográfico único y canónico en WebGL 2.0 MapLibre GL v6.
  - Consolidación de la interfaz `ProvinceVisualData` en `src/shared/types/metagame.ts` para preservar la integridad de tipos en `src/domains/world/components/TerritoryInspectorModal.tsx`.
- **Neutralización del Parpadeo Cíclico en WebGL (`TacticalWorldMap.tsx` & `WarLobbyHub.tsx`)**:
  - Implementación del patrón de *Stable Ref* (`useRef`) para callbacks de selección (`onSelectProvinceRef`, `onSelectTacticalCellRef`), desacoplando el ciclo de vida del contexto WebGL 2.0 del ticker económico de 1000ms.
  - Inicialización del mapa en efecto de montaje único (`[]`), manteniendo viva la instancia de MapLibre GL a 60 FPS ininterrumpidos.
  - Memoización de `handleSelectProvinceFromMap` con `useCallback` en `WarLobbyHub.tsx`.
- **Alineación Cromática Canónica (`@tactical-command-intel`)**:
  - Sustitución de colores genéricos de Tailwind por la paleta militar de sala de guerra:
    - Océano / Mar Caribe: `--color-bunker-void` (`#0E100C`).
    - Masa continental circundante: `--color-armor-base` (`#1C1E17`) con bisel `--color-military-olive` (`#46521F`).
    - *Clan Ferro*: Blue Moon (`#1D4ED8`).
    - *Clan Orinoco*: Orange Star (`#E65100`).
    - *Clan Andes*: Black Hole / Crimson (`#991B1B`).
    - *Zonas Buffer / Neutrales*: Chasis blindado (`#2B2C24`) con bisel metálico (`#7B8A4A`).
    - *Estado Seleccionado*: Verde Fósforo CRT Radar (`#00FF66`).
    - *Autopistas y Troncales*: Triple capa en WebGL con sombra de tinta cómic (`#0A0B08`), resplandor radar y núcleo verde fósforo CRT (`#00FF66`) / ámbar militar (`#FBBF24`).

#### Added
- **Plan Maestro de Despliegue Cartográfico (`docs/archive_legacy/PLAN_DESPLIEGUE_MAPA_WEBGL_VENEZUELA.md`)**:
  - Especificación de las 5 fases para consolidar el lienzo geográfico WebGL 2.0 (MapLibre GL v6) Zero-Raster.
  - Mapeo canónico de las 24 entidades federales soberanas (`REG_VE_01` a `REG_VE_24`), `BUF_MARITIME_CARIBE` y las 7 zonas buffer de frontera (`BUF_*`).
  - Matriz de jerarquía para las Troncales 1 a 19, Eje Fluvial Orinoco-Apure y corredores marítimos del Caribe.
- **Worker Autónomo WebGL (`public/maplibre-gl-worker.mjs`)**:
  - Binario desacoplado del bundler de Vite para carga inmediata local con código 200 OK, eliminando excepciones 504 de tiempo de espera en workers de mapas.
- **Capa Semántica Accesible E2E en `TacticalWorldMap.tsx`**:
  - Puntos de anclaje accesibles (`data-region-id` y `data-buffer-zone`) proyectados sobre el lienzo WebGL que permiten a los motores de accesibilidad y suites de automatización Playwright ejecutar navegación, asedios y selección de provincias a 60 FPS sin sobrecargar la CPU.

#### Changed
- **Calibración de Centroide Nacional (`TacticalWorldMap.tsx`)**:
  - Centro geográfico reajustado a las coordenadas precisas de la República de Venezuela (`lng: -66.5897, lat: 6.4238`) a zoom `5.5`, abarcando toda la fachada caribeña y los límites fronterizos.

#### Verified
- **Suite de Calidad Playwright E2E (`test-results/qa-run-latest.json`)**:
  - Estado: `PASS_CLEAN` (12.4s en Chromium).
  - Telemetría: 0 errores fatales (`fatalErrorsCount: 0`), 0 fallos de red (`networkFailuresCount: 0`), 60 FPS estables.
  - 24 regiones soberanas y 7 zonas buffer validadas.
  - Promulgación de edicto, ajuste de peaje en `CHK-MARACAIBO` (7.5%), bloqueo de zona buffer `BUF_CO_01`, asedio político en Cojedes (`REG_VE_20`) y bark reactivo de la Mayor Stella certificados.
- **Suite Cartográfica Determinista (`coordinatesAndBitmap.test.ts`)**:
  - 10/10 tests superados (100% de éxito en 6ms).

### Documentación & Especificación Arquitectónica Canónica

#### Added
- **Master MVP Blueprint & Roadmap (`docs/MASTER_MVP_BLUEPRINT_AND_ROADMAP.md`)**:
  - Especificación canónica de refundación modular bajo Arquitectura Hexagonal Pura y Estado Unidireccional Basado en Eventos (`DRONEPUNK 0.0.1`).
  - Aislamiento e invariantes de los 4 Dominios: Metapolítica Macro & Cartografía WGS84 (Estudio Alpha), Motor Táctico TBS & Atrición Determinista (Estudio Beta), Bark Engine & Game Feel Cómic (Estudio Gamma) y Capa de Invariantes Universales (Estudio Delta).
  - Contratos de tipo inmutables (`docs/contracts/`): `alpha/macroCartographyContracts.ts`, `beta/tacticalContracts.ts`, `schema.ts`, `typesBridge.ts`.
- **Análisis Forense & Replicación Cartográfica WarEra (`docs/archive_legacy/WARERA_MAP_ARCHITECTURE_DEEP_DIVE.md`)**:
  - Deconstrucción de arquitectura WebGL Zero-Raster, TopoJSON estático quantizado y reactividad en GPU con `feature-state` con 0% de re-renders de CPU.
- **Plan de Implementación Mapa Vectorial Zero-Raster (`docs/archive_legacy/PLAN_IMPLEMENTACION_MAPA_VECTORIAL_ZERO_RASTER.md`)**:
  - Hoja de ruta para migración a TopoJSON, MapLibre GL nativo y Deck.gl (`MapboxOverlay`).
- **Análisis de Arquitectura Histórica (`docs/archive_legacy/ANALISIS_ARQUITECTURA_GEOTACTICS.md`)**:
  - Convergencia entre lienzo territorial OpenPlace y motor de eventos y logística Project Alice.

#### Added
- **Topología de Nodos Estratégicos & Soberanía Regional (`20261105000001_geotactics_strategic_nodes_and_queues.sql`)**:
  - Migración DDL con tabla `public.strategic_nodes` para los 7 puntos estratégicos del Teatro Venezuela: Capital Central Caracas (`REG_VE_01`), Estrecho Canal de Maracaibo (`REG_VE_02`), Refinería CRP Amuay (`REG_VE_11`), Estrecho Golfo de Paria (`REG_VE_13`), Hidroeléctrica Guri (`REG_VE_03`), Radar C4ISR Margarita (`REG_VE_14`) y Base SAM Maracay (`REG_VE_08`).
  - Hangar Comunitario de Facción (`public.faction_unit_hangar`) que permite a los clanes sostener inventarios militares colectivos administrados por rango de mando.
  - Cola de Producción Física (`public.unit_production_queue`) con duraciones de espera deterministas y funciones RPC atómicas `queue_unit_production` y `claim_finished_unit`.
- **Motor Lógico de Forja y Nodos Estratégicos (`src/domains/economy/core/strategicAndProductionEngine.ts`)**:
  - Función `calculateUnitProductionDuration` con escalado de Tiers T1 a T5 (+35% de duración por grado industrial) y reducción de tiempo por Buff Hegemónico de Capital Nacional Caracas (-10%).
  - Kit de Supervivencia F2P inagotable: Infantería Ligera y Reconocimiento T1 con duración de 0s y costo nulo de insumos pesados.
  - Reglas de Comando Delegado de Facción: Reclutas bloqueados, Cabos acotados a Tier 2, Sargentos y Veteranos autorizados para desplegar blindados pesados y aviación comunitaria.
- **Interfaz C4ISR Atompunk (Fase 2 UI/UX)**:
  - **Header Superior Dual (`DualResourceHeader.tsx`)**: Separación diegética estricta entre recursos individuales del comandante ($G, EC, tech_scrap, rango, trofeos) y recursos de facción (estandarte, bóveda en EC, chasis comunes, control TCP).
  - **Bark Engine Reactivo (`CommanderBarkWidget.tsx`)**: Viñeta interactiva en la esquina inferior izquierda con retrato cómic del comandante activo, tramas Ben-Day, 5 geometrías de bocadillo (`radio`, `panic`, `thought`, `shout`, `whisper`) y sellos pop-art angulados (`¡¡BAJO FUEGO!!`, `¡DEFCON 1!`). Responde a cada clic directo y emite avisos situacionales ante clics en el mapa.
  - **Candado de Zonas Buffer**: Clics en sectores de amortiguación fronteriza (`BUF_CO`, `BUF_BR`, `BUF_GY`, etc.) activan bocadillo de pánico y sello "ZONA RESTRINGIDA" con el mensaje `"SECTOR FUERA DEL TEATRO OPERACIONAL DE FASE 1 (ACTIVO: REPÚBLICA DE VENEZUELA)"`.
  - **Consola Lateral Retráctil Paradox (`ParadoxCommandDrawer.tsx`)**: Panel deslizable estilo *Stellaris* / *Victoria 3* con 4 pestañas operativas: Macro-inspección territorial, Nodos estratégicos con buffs hegemónicos, Colas de forja con temporizadores de cuenta atrás en tiempo real y solicitud de unidades al Arsenal de Facción.
- **Batería de Pruebas de Calidad**:
  - `strategicAndProductionEngine.test.ts`: 14/14 tests superados (100%).
  - `phase2InterfaceAndBark.test.ts`: 13/13 tests superados (100%).
  - Build de producción Vite/Tailwind verificado sin errores.

### Fase 3: Expansión Territorial.io & Multiplicador de Nodos Industriales

#### Added
- **Motor de Expansión Territorial Celular (`src/domains/world/core/territorialExpansionEngine.ts`)**:
  - Malla celular determinista de sub-sectores por región con cobertura de estrellas de terreno (1★ a 4★).
  - Algoritmo de avance de frontera por ondas ("Pintado de Zonas" estilo *Territorial.io*): propagación celular ortogonal según presupuesto de Fondos $G / Manpower militar.
  - Desgaste dinámico de celdas enemigas y consolidación de Soberanía *De Facto* al superar el umbral del 50% de la región.
  - Captura en vivo de Puntos Estratégicos (Capital Nacional Caracas, Refinería CRP Amuay, Hidroeléctrica Guri, etc.).
  - Función `calculateIndustrialYieldWithNodes` que aplica en tiempo real los buffs de nodos sobre el rendimiento extractivo de las 10 Parcelas Territoriales (ej. 1,000 EC $\to$ 1,400 EC con Capital + Refinería) y la aceleración de forja (+10%).
- **Batería de Pruebas Automatizadas de Fase 3**:
  - `territorialExpansionEngine.test.ts`: 13/13 tests superados (100%).
  - Build de producción Vite/Tailwind verificado y empaquetado en 33.83s.

### Fase 4: Seamless Zoom, Doble Llave & Human Handshake 120s

#### Added
- **Integración de Combate Táctico y Zoom Continuo (`src/domains/tactics/core/tacticalCombatSeamlessIntegration.ts`)**:
  - Controlador de Semantic LOD (LOD 1 Global $z < 6.0$, LOD 2 Operacional $6.0 \le z < 13.0$, LOD 3 Táctico $z \ge 13.0$).
  - Inyección dinámica de `TileCanvas` HTML5 sobre coordenadas WGS84 con conmutación de textura bilineal a `nearest` (pixel-art).
  - Validador estricto de la **Doble Llave**: exige Fondos $\$G$ in-match Y existencia física de chasis en Hangar Personal o Arsenal de Facción (con excepción del Kit F2P inagotable para Infantería y Recon T1).
  - Liquidación de siniestralidad real: sumidero permanente del 65% de unidades no-F2P destruidas + recuperación del **35% en Chatarra Balística (`tech_scrap`)** refundible en Altos Hornos (2 Scrap $\to$ 1 Acero).
  - Protocolo de Human Handshake de 120 segundos: alerta defensiva DEFCON 1 en Bark Engine, relevo a PvP en vivo con un clic, o asunción automática de Guarnición IA al expirar el tiempo.
- **Batería de Pruebas Automatizadas de Fase 4**:
  - `tacticalCombatSeamlessIntegration.test.ts`: 17/17 tests superados (100%).

### Base Fundacional (DRONEPUNK 0.0.1 Core) — Motor Táctico, Metajuego y Backend

#### Added
- **Motor Táctico Determinista (Advance Wars 1-100 HP Core)**:
  - Implementación determinista estricta (cero azar, $\text{RNG} = 0$) basada en la matriz oficial atacante/defensor de *Advance Wars*.
  - Escala balística de precisión continua de **1 a 100 HP** que erradica redondeos artificiales y soporta bonos incrementales del $+2\%$ por nivel.
  - Mitigación proporcional de daño por cobertura de estrellas de terreno (1★ Llanuras, 2★ Bosques, 3★ Ciudades/Fábricas, 4★ Montañas/Cuartel General).
  - Regla canónica de emboscada **TRAP** en niebla de guerra: detención en seco, revelación de unidad enemiga oculta y pérdida de turno.
  - Sistema de combustible y abastecimiento logístico: derribo de aeronaves en vuelo (`Crash`), hundimiento de submarinos sin combustible (`Sink`) y reabastecimiento en sedes aliadas.
  - Sistema de captura y desmantelamiento de Cuartel General (20 puntos de captura) con anexión de propiedades e incautación de contingentes supervivientes.
  - Roster de **28 Oficiales Comandantes (COs)** balanceados con poderes activos (`COP` y `SCOP`), cargas pasivas de medidor y bonificaciones simétricas.
  - Balística destructible y mapeador de elementos *Advance Wars By Web* (AWBW): torres de telecomunicaciones, tuberías y costuras blindadas con 100 HP.
- **Bark Engine Cómic y HUD Táctico C4ISR**:
  - Motor de narrativa reactiva contextual estilo novela gráfica bélica inspirado en *Hades* y *Persona 5*, operando 100% de manera visual (cero locución de voz).
  - 5 geometrías de bocadillos dinámicos (Globo Habla, Grito Dentado, Radio Militar Cuadrado, Pensamiento Nube, Susurro Punteado) y sellos de onomatopeyas Pop-Art con tramas Ben-Day (`¡BOOM!`, `¡CRASH!`, `¡ALERT!`, `¡SINK!`, `¡CLUTCH!`).
  - Viñeta diegética flotante del Comandante en Jefe con física reactiva de resortes y amortiguación elástica (`cubic-bezier(0.34, 1.56, 0.64, 1)`).
  - Consola lateral retráctil C4ISR (`MetaCommandConsole`) que integra en una sola vista la telemetría del sector, órdenes de asedio, mando de guarniciones, hangares y ticker de recursos.
- **Metajuego Territorial Soberano (Lienzo Vivo Victoria 3 × Wplace)**:
  - Lienzo mundial interactivo a pantalla completa renderizado continuamente sobre la pantalla principal, eliminando menús estáticos flotantes.
  - **Cero regiones inexpugnables**: Las 195 capitales históricas y sedes mundiales son conquistables y operan como súper-nodos económicos con multiplicador $2.0\times$ de producción.
  - Asedio territorial por drenaje de Puntos de Control Territorial (**TCP**) y activación de Escudos de Cooldown de Prioridad (4 a 6 horas) para evitar *steamrolling*.
  - Protocolo de refuerzos tácticos con retardo logístico calibrado de **1 a 4 turnos** según la fatiga del combate.
  - Generación continua de recursos por minuto (*Wplace Economy*) con liquidación periódica y cobro de upkeep en Créditos Energéticos (**EC**).
  - Ecuación matemática de sobre-expansión imperial $\Psi_{\text{Over}}$ con penalización superlineal de mantenimiento a partir del umbral $N_{\text{cap}} = 6$ provincias.
- **Hangar Físico de Unidades y Cadena de Valor Industrial (Albion Online)**:
  - Consolidación de **Almacenes Físicos de 16 Chasis Militares (4 slots en vanguardia + 12 en reserva táctica)** donde toda tropa desplegada representa munición descartable forjada previamente.
  - Escalamiento industrial horizontal de tropas en 5 Tiers de calidad (T1 a T5):
    $$\text{BonoEfectividad}(T) = (T - 1) \times 2.0\% \quad \text{hasta } +8\% \text{ en Tier 5 (paridad } 0\% \text{ en Tier 1 competitivo)}$$
  - Desbloqueo de **Patentes Tecnológicas Permanentes** mediante quema de materiales brutos y refinados de la guerra moderna (aleaciones de titanio, tierras raras, grafeno, micro-conductores, hormigón armado e hidrocarburos).
  - Sistema de reciclaje y recuperación de chatarra con retención base del 35% de valor en desguace.
- **Mercado Libre P2P Descentralizado**:
  - Negociación de materias primas, refinados, patentes y consumibles con **split transaccional del 2%**:
    - **1%** quemado permanentemente como sumidero deflacionario.
    - **1%** transferido como regalía soberana a la corporación dueña del territorio donde radica el mercado.
  - Estabilización algorítmica mediante **Bandas VWAP Collar $\pm 25\%$** para impedir transferencias fraudulentas o manipulación de precios.
  - Prohibición terminante de venta de tropas terminadas (crafteo físico obligatorio, 0% Pay-to-Win).
- **Mando Autónomo de Guarniciones IA**:
  - 5 niveles cognitivos de guarnición defensiva (desde Milicia Local heurística hasta Gran Mariscal Búnker con árbol MCTS y mapas de calor).
  - Regla canónica de envejecimiento y pase a retiro de Comandantes Legendarios tras **21 días reales** de servicio activo.
  - Protocolo de relevo humano (*Human Handshake* de 120 segundos) previo a la intervención de la IA.
- **Infraestructura de Datos y Backend (Supabase PostgreSQL)**:
  - 32 migraciones maestras de esquemas relacionales consolidadas en `supabase/migrations/` y `supabase/CONSOLIDATED_FULL_DATABASE_DEPLOY.sql`.
  - Seguridad declarativa mediante **Row Level Security (RLS)** y ejecución atómica vía funciones RPC (`execute_p2p_market_transaction`, `rebalance_garrison_tier`, `grant_match_rewards`).
  - Sincronización en tiempo real a través de canales WebSocket de Supabase Realtime.

### Changed
- Consolidación de Hangares Físicos de 16 chasis militares persistentes en base de datos (`public.user_unit_hangar`).
- Sustitución de la tasa municipal previa del 12% por la regla canónica del split del 2% en el Mercado P2P.
- Migración de la arquitectura web hacia una SPA nativa en React 19 empaquetada con Vite 8 y estilizada con Tailwind CSS v4.

### Security & Infrastructure
- Erradicación de almacenamiento en memoria volátil o colecciones mock para inventarios, mercados y guarniciones; 100% de persistencia en PostgreSQL.
- Verificación criptográfica y validación estricta de coordenadas, límites territoriales adyacentes y balance de Créditos Energéticos en procedimientos almacenados.
