export interface DocItem {
  id: string;
  filename: string;
  title: string;
  badge: string;
  summary: string;
  sections: {
    heading: string;
    content: string;
    codeSnippet?: {
      language: string;
      code: string;
    };
  }[];
}

export const GAME_DOCUMENTS: DocItem[] = [
  {
    id: '00_arbol_canonico',
    filename: 'docs/00_ARBOL_CANONICO_DE_SISTEMAS_Y_DESARROLLO.md',
    title: 'Árbol Canónico de Desarrollo (SSOT)',
    badge: 'SSOT Supremo',
    summary: 'Única Fuente de Verdad (SSOT) de DRONEPUNK 0.0.1. Taxonomía de los 4 Estados (Listo, Desplegado, Desarrollado, En Desarrollo) y 4 Dominios Modulares.',
    sections: [
      {
        heading: '1. Los 7 Pilares Inmutables de DRONEPUNK 0.0.1',
        content: `1. **ALMACÉN FÍSICO DE 16 CHASIS MILITARES:** Stock real de hasta 16 tropas (4 slots de vanguardia activa + 12 en reserva dentro de \`user_unit_hangar\`). Las tropas se forjan en refinerías y se despliegan como munición descartable pagando fondos $G.
2. **ESCALA CONTINUA 1-100 HP:** Integridad estructural y daño balístico entero de 1 a 100 HP en \`canonicalCombat.ts\` y \`canonicalDamageChart.ts\`.
3. **0 TROPAS = DERROTA INMEDIATA:** Si un ejército pierde su última unidad sobre el grid táctico o pierde su HQ (\`hqCaptureVictory.ts\`), finaliza el combate en el acto.
4. **TIERS INDUSTRIALES T1 A T5 (+2% por Tier):** Progresión horizontal pura por calidad de manufactura del chasis (hasta +8% en T5; paridad 0% en Tier 1 para torneos clasificados).
5. **TEATRO VENEZUELA Y CAPITALES (+5% BUFF REGIONAL):** 24 estados soberanos jugables (\`REG_VE_01\`..\`REG_VE_24\`), 1 zona marítima (\`BUF_MARITIME_CARIBE\`) y 7 zonas buffer fronterizas (\`BUF_*\`). Capitales con umbral de 15,000 TCP y buff regional +5%; provincias estándar con 10,000 TCP.
6. **PÉRDIDA FÍSICA + 35% CHATARRA + KIT F2P:** Las unidades destruidas se descuentan físicamente del hangar recuperando 35% en \`tech_scrap\` (\`settle_territorial_combat_losses\`); Infantería y Recon Tier 1 gratuitos ilimitados.
7. **HANDSHAKE HUMANO DE 120s Y MERCADO P2P:** Ventana de 120,000 ms (\`HUMAN_HANDSHAKE_WINDOW_MS = 120_000\`) para relevo humano defensivo y mercado 100% impulsado por jugadores (2% split = 1% Sink + 1% Clan, bandas VWAP Collar ±25% y Cargamento Varado).`
      },
      {
        heading: '2. Taxonomía de los 4 Estados de Desarrollo',
        content: `• 🟢 **[LISTO]:** Producción certificada, contratos cerrados y suites deterministas en verde.
• 🔵 **[DESPLEGADO]:** Activo en PostgreSQL (32 migraciones), políticas RLS o vistas frontend montadas en la aplicación.
• 🟡 **[DESARROLLADO]:** Lógica de motor o componente implementado en TypeScript dentro de \`@domains/*\` o \`@shared/*\`.
• 🟠 **[EN DESARROLLO]:** Refactor o especificación activa para cierre de telemetría y playtesting.`
      },
      {
        heading: '3. Los 4 Dominios Modulares y Capa Compartida',
        content: `• **@domains/world (\`src/domains/world/index.ts\`):** Cartografía WebGL Zero-Raster MapLibre GL v6, Semantic Zoom de 3 estratos, proyección WGS84 O(1), grafo vial A* (\`roadNetworkEngine.ts\`, \`spatialRoadIndex.ts\`) y motor geopolítico (\`politicalAliceEngine.ts\`).
• **@domains/tactics (\`src/domains/tactics/index.ts\`):** Motor balístico 1-100 HP (\`canonicalCombat.ts\`), reloj Fischer, niebla de guerra TRAP!, 29 COs (\`coSystem.ts\`), guarnición IA (\`garrisonAIEngine.ts\`) y captura de HQ.
• **@domains/economy (\`src/domains/economy/index.ts\`):** Almacén Físico de 16 Chasis (\`useUserHangar.ts\`, \`UnitHangarModal.tsx\`), complejo industrial de 10 parcelas por feudo (\`industrialEngine.ts\`), mantenimiento imperial (\`upkeepEngine.ts\`) y Mercado P2P 2% (\`P2PMarketplaceView.tsx\`).
• **@domains/game-feel (\`src/domains/game-feel/index.ts\`):** Bark Engine visual de novela gráfica con 29 Comandantes + Mayor Stella (\`barkEngine.ts\`), síntesis Web Audio API (\`audioManager.ts\`) y háptica (\`hapticFeedback.ts\`).
• **@shared (\`src/shared/index.ts\`):** Contratos TypeScript (\`metagame.ts\`, \`database.types.ts\`), Supabase Realtime (\`realtime.ts\`), autenticación y arnés QA.`
      }
    ]
  },
  {
    id: '01_gdd',
    filename: 'docs/00_GEOTACTICS_ONLINE_MASTER_SPEC.md',
    title: 'Especificación Maestra DRONEPUNK 0.0.1',
    badge: 'Master Spec',
    summary: 'Manifiesto de diseño y arquitectura de DRONEPUNK 0.0.1: combate determinista 1-100 HP, Hangar Físico de 16 Chasis, soberanía territorial y Bark Engine C4ISR.',
    sections: [
      {
        heading: '1. Resumen Ejecutivo y los Tres Pilares Fundacionales',
        content: `**DRONEPUNK 0.0.1** es una consola de mando táctico militar y MMORTS geopolítico ejecutada en navegador web que fusiona:
- **Pilar Táctico Determinista (1-100 HP):** Cero azar destructivo en combate, estrellas defensivas proporcionales al HP restante, niebla de guerra estricta con emboscada TRAP! y captura progresiva de propiedades.
- **Pilar Industrial y Soberanía Territorial:** Hangar físico de 16 chasis en Tiers T1 a T5 (munición descartable forjada en refinerías), mercado 100% impulsado por jugadores (P2P con split del 2% y bandas VWAP ±25%) y soberanía territorial continua sin inmunidad en capitales.
- **Pilar Narrativo Visual (Bark Engine C4ISR):** Narrativa contextual de novela gráfica bélica 100% visual (sin voces grabadas), con bocadillos dinámicos y sellos Pop-Art de onomatopeyas (¡BOOM!, ¡ALERT!, ¡CLUTCH!, ¡SINK!, ¡CRASH!).`
      },
      {
        heading: '2. Modos de Juego y Despliegue en Fábricas',
        content: `1. **Duelo Táctico Espejo (Mirror Duel):** Mapas 10x10 simétricos, paridad estricta Tier 1 (0% bonificación), 15s por turno, economía acelerada 1.5x ($1500G/propiedad), bono de apertura $3000G y límite de 12 turnos.
2. **Escaramuza Rápida (Blitz Skirmish):** Mapas 12x12 a 16x16, 30s por turno, economía acelerada 2x ($2000G/propiedad) y despliegue orgánico desde Hangar.
3. **Campaña Táctica (Grand Campaign):** Mapas 24x24 a 32x32, 60s por turno, economía estándar ($1000G/propiedad) y operaciones prolongadas de hasta 40 turnos.
4. **Hangar Físico T1-T5 y Suministros:** Despliegue con Doble Llave (Fondos $G + chasis real disponible en Hangar). Sostenimiento logístico con Soft Cap en 14 tropas en mapa ($200G de mantenimiento por unidad excedente).`
      },
      {
        heading: '3. Terreno, Cobertura y Regla de Emboscada TRAP',
        content: `Cada estrella de terreno reduce el daño recibido proporcionalmente al HP del defensor (1-100 HP):
- **Llanura (1★):** Terreno neutro estándar (costo pie: 1, ruedas: 2, orugas: 1).
- **Bosque (2★):** Oculta unidades en Niebla. Si una tropa aliada intenta cruzar un bosque con enemigo oculto, se interrumpe el movimiento en seco (TRAP), pierde el turno y revela al rival.
- **Montaña (4★):** 40% reducción de daño. Otorga +3 casillas de visión a infantería. Infranqueable para ruedas y tanques.
- **Carretera (0★) y Río (0★):** Vías rápidas o cruces lentos sin cobertura defensiva.
- **Propiedades (Ciudades/Fábricas/HQ - 3★/4★):** Generan fondos y reparan +20 HP/turno (escala 1-100 HP) descontando fondos proporcionales.`
      },
      {
        heading: '4. Matriz de Combate, 16 Arquetipos, 29 COs y Logística',
        content: `Fórmula Canónica (\`src/domains/tactics/core/canonicalCombat.ts\`):
- attackFactor = floor((baseDamage * attackModifier / 100) * attackerTierBonus + luckModifier)
- defenseFactor = (200 - (defenseModifier + defenderTerrainStars * (defenderHP / 10))) / 100
- damage100 = clamp(1, defenderHP, floor(attackFactor * (attackerHP / 100) * defenseFactor))
- Catálogo de 16 Chasis: Infantería, Mech, Recon, APC, Tanque Ligero, Tanque Medio, Neotanque, Artillería, Lanzacohetes, Antiaéreo Vulcan, Misiles AA, B-Copter, T-Copter, Caza, Bombardero y Acorazado Naval.
- Logística de Combustible y Reglas de Crash / Sink:
  * Aeronaves consumen combustible por turno; al llegar a 0 fuel, se estrellan (Crash).
  * Submarinos sumergidos consumen 5 fuel/turno; al llegar a 0 fuel, se hunden (Sink).
- Victoria por Toma de Cuartel General (HQ) o Aniquilación Total:
  * Al capturar el HQ rival o reducir las tropas rivales activas a 0, el vencedor gana de inmediato.`
      },
      {
        heading: '5. Sistema de Diseño Frontend: Skill @tactical-command-intel',
        content: `Toda la interfaz del juego sigue la estética militar C4ISR combinada con energía gráfica Pop-Art:
- **Consola Blindada C4ISR:** Chaflanes a 45° (\`clip-path\`), remaches de acero, sombras duras sin blur (\`box-shadow: 5px 5px 0px #0A0B08\`).
- **Paleta Oficial:** Fondo \`#161712\` / \`#2B2C24\`, blindaje Oliva \`#46521F\`, acero Cromo-Níquel \`#7B8A4A\`, alertas DEFCON Naranja Óxido \`#C46A3A\`, crema fósforo \`#F2E8D5\` y acento radar Matrix \`#00FF66\`.
- **Tipografía:** \`Chakra Petch\` / \`Space Grotesk\` para títulos militares y \`JetBrains Mono\` para telemetría tabular.`,
        codeSnippet: {
          language: 'css',
          code: `.tactical-intel-armor-card {
  background: linear-gradient(180deg, #2B2C24 0%, #1E1F18 100%);
  border: 1px solid #7B8A4A;
  clip-path: polygon(
    14px 0, calc(100% - 14px) 0,
    100% 14px, 100% calc(100% - 14px),
    calc(100% - 14px) 100%, 14px 100%,
    0 calc(100% - 14px), 0 14px
  );
  box-shadow: 5px 5px 0px #0A0B08;
  color: #F2E8D5;
}`
        }
      }
    ]
  },
  {
    id: '01_cartography',
    filename: 'docs/01_MASTER_CARTOGRAPHY_WEBGL_ZERO_RASTER.md',
    title: 'Cartografía WebGL 2.0 Zero-Raster & Red Vial',
    badge: 'WebGL & Spatial',
    summary: 'Pipeline cartográfico WebGL Zero-Raster sobre MapLibre GL JS v6, Semantic Zoom de 3 estratos, proyección WGS84 O(1) y grafo vial A*.',
    sections: [
      {
        heading: '1. Renderizado Vectorial Zero-Raster (MapLibre GL v6)',
        content: `DRONEPUNK 0.0.1 opera sin tiles raster externos, renderizando geometría local GeoJSON/TopoJSON en GPU mediante \`src/domains/world/components/TacticalWorldMap.tsx\`:
- **Fuentes Cartográficas Reales en \`public/map/\`:** \`world_land.json\`, \`theatre_regions.json\`, \`theatre_roads.json\`, \`theatre_urban_roads.json\`, \`theatre_cities.json\` y \`zulia_municipalities.json\`.
- **Semantic Zoom de 3 Estratos:** Nivel Macro Geopolítico (estados soberanos), Nivel Operacional (red vial troncal/urbana y convoyes) y Nivel Micro Táctico (despliegue espacial en cuadrícula).`
      },
      {
        heading: '2. Proyección Analítica O(1), Niebla de 50 Bytes y Grafo Vial A*',
        content: `- **Coordenadas WGS84 O(1) (\`src/domains/world/core/coordinates.ts\`):** Conversión exacta entre coordenadas geográficas y sectores/celdas tácticas sin iteración.
- **Niebla Empaquetada (\`src/domains/world/core/tacticalBitmap.ts\`):** Estado de sector compactado en buffers de 50 bytes para replicación ligera.
- **Índice Espacial Vial O(1) (\`src/domains/world/core/spatialRoadIndex.ts\` & \`roadNetworkEngine.ts\`):** Búsqueda espacial bitwise O(1) y cálculo de rutas de convoy A* con fricción topológica e intercepción.`
      }
    ]
  },
  {
    id: '02_economy',
    filename: 'docs/02_MASTER_METAGAME_INDUSTRY_ECONOMY.md',
    title: 'Metajuego Industrial, Hangar Físico & Mercado P2P',
    badge: 'Economy & Hangar',
    summary: 'Almacén Físico de 16 Chasis (Tiers T1-T5), cadena industrial de 10 parcelas por feudo, mantenimiento imperial y Mercado Libre P2P al 2% split.',
    sections: [
      {
        heading: '1. Almacén Físico de 16 Chasis (Pilar 1)',
        content: `Todo comandante administra existencias físicas reales en \`public.user_unit_hangar\` (\`src/domains/economy/hooks/useUserHangar.ts\`):
- **Capacidad Estructural:** 16 chasis máximo (4 bahías de vanguardia activa + 12 de reserva en Hangar).
- **Doble Llave de Despliegue:** Invocar una tropa en combate exige fondos tácticos ($G) y existencia física real en el Hangar (\`ProductionModal.tsx\`).
- **Kit F2P Garantizado:** Infantería Ligera T1 y Recon T1 poseen stock ilimitado gratuito para impedir cualquier bloqueo de cuenta.`
      },
      {
        heading: '2. Complejo Industrial de 10 Parcelas y Mercado P2P 100% Player-Driven',
        content: `- **Cadena de 10 Parcelas por Feudo (\`src/domains/economy/core/industrialEngine.ts\`):** Extracción de recursos primarios, altos hornos de refinado (Acero, Hormigón, Microchips), merma tras 10 horas y sobrecarga con combustible.
- **Mantenimiento Imperial (\`src/domains/economy/core/upkeepEngine.ts\`):** Penalización exponencial por sobre-expansión más allá de 6 provincias base (\`BASE_PROVINCES_CAP = 6\`) para frenar imperios incontrolados.
- **Mercado Libre P2P (\`src/domains/economy/components/P2PMarketplaceView.tsx\`):** Economía 100% impulsada por jugadores sin liquidez sintética: impuesto total del 2% (\`PLATFORM_BURN_RATE = 0.01\` quemado en Sink + \`PROVINCE_ROYALTY_RATE = 0.01\` para el clan dueño de la terminal), bandas anti-dumping VWAP Collar ±25% y mecánica de Cargamento Varado (\`strandedCargo\`).`
      }
    ]
  },
  {
    id: '03_db_security',
    filename: 'docs/04_MASTER_DATABASE_AND_SECURITY_SPEC.md',
    title: 'Base de Datos Supabase, 32 Migraciones & RLS',
    badge: 'Database & RLS',
    summary: 'Esquema PostgreSQL consolidado de 32 migraciones SQL, aislamiento multi-tenant RLS, contratos TypeScript y RPCs autoritativas.',
    sections: [
      {
        heading: '1. Tablas Autoritativas y Contratos TypeScript',
        content: `El backend PostgreSQL se consolida en \`supabase/CONSOLIDATED_FULL_DATABASE_DEPLOY.sql\` (32 migraciones en \`supabase/migrations/\`) y se refleja en \`src/shared/types/database.types.ts\`:
1. **profiles:** Cuenta global, XP, Fondos $G, Créditos Energéticos (EC) y métricas de telemetría.
2. **user_unit_hangar & faction_unit_hangar:** Inventario físico de 16 chasis (4 activos + 12 reserva, Tiers T1-T5).
3. **state_sovereignty & territorial_siege_sessions:** Soberanía de las 24 entidades de Venezuela, umbrales TCP (15,000 capitales / 10,000 estándar) y Handshake de 120s.
4. **tactical_fief_constructions & p2p_market_orders:** Parcelas industriales, edificios de feudo y libro de órdenes P2P al 2% split.`
      },
      {
        heading: '2. Seguridad RLS y RPCs Autoritativas',
        content: `Todas las mutaciones sensibles se ejecutan mediante funciones \`SECURITY DEFINER\` y políticas RLS estrictas (\`auth.uid()\`):
- **Liquidación Física de Bajas (\`settle_territorial_combat_losses\`):** Descuenta chasis destruidos del Hangar y acredita 35% de recuperación en \`tech_scrap\`.
- **Sincronización SSOT de Catálogos (\`scripts/syncCatalogsFromDb.ts\`):** Compila los catálogos inmutables en \`src/shared/data/catalogs.generated.ts\` validados contra \`system_catalog_manifest\`.`
      }
    ]
  },
  {
    id: '04_engine_networking',
    filename: 'docs/05_MASTER_GAME_ENGINE_AND_NETWORKING.md',
    title: 'Motor Balístico, A* Pathfinding & Realtime',
    badge: 'Engine & Network',
    summary: 'Arquitectura del motor de combate 1-100 HP, Pathfinding A*, IA de Guarnición niveles 1-5, Handshake 120s y protocolo Supabase Realtime.',
    sections: [
      {
        heading: '1. Núcleo Táctico Desacoplado (@domains/tactics)',
        content: `- **Combate Determinista (\`src/domains/tactics/core/canonicalCombat.ts\`):** Evaluación pura de daño entero 1-100 HP con bonificación por Tier T1-T5 (+2% por tier, máximo +8% en T5), estrellas defensivas de terreno y contraataque proporcional.
- **Pathfinding y Niebla (\`pathfinding.ts\`, \`fogOfWar.ts\`):** Cálculo A* heterogéneo por locomoción (pie, ruedas, orugas, aéreo, naval) y detección de emboscadas TRAP! en bosques.
- **Guarnición IA & Orquestador (\`garrisonAIEngine.ts\`, \`autonomousOrchestrator.ts\`):** 5 doctrinas progresivas de defensa automática cuando expira el Handshake de 120 segundos.`
      },
      {
        heading: '2. Sincronización Realtime y Contratos de Red',
        content: `La capa \`src/shared/lib/supabase/realtime.ts\` y \`src/domains/world/hooks/useSiegeRealtime.ts\` orquesta canales de Broadcast de baja latencia y suscripciones \`postgres_changes\` para alertas de asedio, relevo humano de 120s y mutaciones de soberanía en \`stateSovereigntyService.ts\`.`
      }
    ]
  },
  {
    id: '05_commanders_social',
    filename: 'docs/03_MASTER_COMMANDERS_BARK_AND_SOCIAL.md',
    title: '29 Comandantes, Bark Engine Cómic & Clanes',
    badge: 'Commanders & Bark',
    summary: 'Registro de 29 Comandantes (COs), Mayor Stella como sujeto adaptativo, narrativa gráfica Pop-Art sin voces y Corporaciones Militares.',
    sections: [
      {
        heading: '1. Sistema de 29 Comandantes y Bark Engine',
        content: `- **Catálogo Canónico (\`src/domains/tactics/core/coSystem.ts\`):** 29 Comandantes con poderes CO/Super-CO calibrados a escala continua 1-100 HP.
- **Motor Narrativo Reactivo (\`src/domains/game-feel/core/barkEngine.ts\`):** Bucle de telemetría con Mayor Stella (\`geotactics_bark_self_opt_stella_v1\`), bocadillos Speech/Shout/Thought/Whisper/Radio y sellos Pop-Art en \`CommanderBarkWidget.tsx\` y \`ComicVignetteOverlay.tsx\`.`
      },
      {
        heading: '2. Corporaciones Militares y Logística Fraternal',
        content: `En \`src/domains/world/core/clanSystem.ts\` y \`ClanHeadquartersView.tsx\`:
- **Bóveda de Guerra Escalonada (T1-T3):** Recompensas cooperativas según miembros activos.
- **Rescate de Camarada & Donación de Chasis:** Transferencia solidaria de suministros y chasis de Tier entre miembros de la corporación sin mecánicas aleatorias.`
      }
    ]
  },
  {
    id: '06_devops_qa',
    filename: 'docs/06_MASTER_DEVOPS_QA_AND_TELEMETRY.md',
    title: 'DevOps, Audio Procedural Web Audio & Suites QA',
    badge: 'DevOps & QA',
    summary: 'Síntesis procedural Web Audio API, retroalimentación háptica, puente window.__TACTICAL_QA_BRIDGE__ y baterías deterministas + E2E Playwright.',
    sections: [
      {
        heading: '1. Game Feel Auditivo y Háptico (@domains/game-feel)',
        content: `- **Web Audio API (\`src/domains/game-feel/core/audioManager.ts\`):** Síntesis en tiempo real (0 bytes de descarga externa) con modulación por combo y pitch jitter.
- **Retroalimentación Háptica (\`src/domains/game-feel/core/hapticFeedback.ts\`):** Perfiles de vibración diferenciados para despliegues pesados, impactos críticos y alertas DEFCON.`
      },
      {
        heading: '2. Quality Gate Determinista y Playtest E2E',
        content: `- **Guardas de Arquitectura (\`scripts/checkLegacyImports.cjs\`, \`checkMissingExports.cjs\`, \`checkSharedViolations.cjs\`):** Garantizan fronteras estrictas entre los 4 dominios y \`@shared\`.
- **Suites Deterministas:** \`npm run test:cartography\`, \`npm run test:all\` (13 suites) y \`npm run test:geotactics\`.
- **Playtest WebGL (\`tests/e2e/game-playtester.spec.ts\`):** Ejecución real en Chromium sobre \`window.__TACTICAL_QA_BRIDGE__\` (\`src/shared/utils/qaHarness.ts\`).`
      }
    ]
  },
  {
    id: '07_war_room_ui',
    filename: 'docs/07_MASTER_UI_UX_WAR_ROOM.md',
    title: 'Arquitectura UI/UX War Room & Consola C4ISR',
    badge: 'UI/UX C4ISR',
    summary: 'Diorama C4ISR de sala de mando, cabecera dual de recursos, gaveta Paradox retráctil, pantalla de carga DRONEPUNK 0.0.1 y accesibilidad táctil.',
    sections: [
      {
        heading: '1. Componentes del Cuartel General (@domains/world/components)',
        content: `- **Orquestación de Lobby (\`WarLobbyHub.tsx\` & \`TacticalC4ISRBaseDiorama.tsx\`):** Estaciones interactivas conectadas a Hangar de 16 Chasis, Complejo Industrial, Mercado P2P y Teatro Operacional.
- **Tríada C4ISR:** \`DualResourceHeader.tsx\`, \`CommanderBarkWidget.tsx\` y \`ParadoxCommandDrawer.tsx\` con físicas de resortes y barras Ghost Trail (\`TacticalGhostBar.tsx\`).`
      },
      {
        heading: '2. Consola de Carga y Modales Tácticos',
        content: `\`GeotacticsLoadingScreen.tsx\` (alias \`DronepunkLoadingScreen\`) presenta telemetría Zulu en tiempo real, sincronización SSOT de catálogos y barra de progreso con Ghost Trail bajo la identidad canónica **DRONEPUNK 0.0.1**.`
      }
    ]
  },
  {
    id: '08_feudos_industria',
    filename: 'docs/ARQUITECTURA_FEUDOS_CADENA_INDUSTRIAL_ALICE_ALBION.md',
    title: 'Feudos, Cadena Industrial & Logística de Convoyes',
    badge: 'Feudos & Industria',
    summary: 'Integración de 10 parcelas industriales por feudo, infraestructura destructible (torretas/muros) y logística de suministros sobre rutas A*.',
    sections: [
      {
        heading: '1. Cadena Industrial de 10 Parcelas por Feudo',
        content: `Cada feudo territorial permite desplegar parcelas de extracción, refinado y forja de chasis T1-T5, sincronizadas en tiempo real con \`fiefBuildingService.ts\` y \`useUserIndustry.ts\`.`
      },
      {
        heading: '2. Transporte Logístico y Cargamento Varado',
        content: `Las órdenes del Mercado P2P generan convoyes con tiempo de tránsito real sobre el grafo vial; ante corte de ruta o conquista hostil se activa el protocolo de Cargamento Varado (\`strandedCargo\`) recuperable por las partes.`
      }
    ]
  },
  {
    id: '09_alice_metapolitica',
    filename: 'docs/ANALISIS_PROJECT_ALICE_RUTAS_INGENIERIA_MAPA_METAPOLITICA.md',
    title: 'Metapolítica Project Alice & Teatro Venezuela',
    badge: 'Geopolítica Alice',
    summary: 'Soberanía dual de 24 estados de Venezuela + zonas buffer, estratos sociales POPs, riesgo de secesión y ventanas anti-raid.',
    sections: [
      {
        heading: '1. Motor Político de Estratos y Secesión',
        content: `Implementado en \`src/domains/world/core/politicalAliceEngine.ts\`: modela estratos poblacionales provinciales, militancia, conciencia política, reformas y riesgo de secesión en las 24 regiones jugables y 7 zonas buffer.`
      },
      {
        heading: '2. Asedios por TCP y Ventanas de Vulnerabilidad',
        content: `Las provincias estándar requieren 10,000 TCP y las capitales 15,000 TCP (sin inmunidad y con +5% de buff regional), protegidas por ventanas de vulnerabilidad horaria configurables y escudo post-conquista de 4 horas.`
      }
    ]
  },
  {
    id: '10_roadmap_mvp',
    filename: 'docs/MASTER_MVP_BLUEPRINT_AND_ROADMAP.md',
    title: 'Blueprint MVP y Estado DRONEPUNK 0.0.1',
    badge: 'Blueprint 0.0.1',
    summary: 'Consolidación modular de los 4 dominios de DRONEPUNK 0.0.1, separación en 3 capas MVP y hoja de ruta operativa.',
    sections: [
      {
        heading: '1. Arquitectura de Separación en 3 Capas (DRONEPUNK 0.0.1)',
        content: `- **Capa 1 (Activa en MVP):** Metajuego Geopolítico WebGL Zero-Raster, Almacén Físico de 16 Chasis, Cadena Industrial de 10 Parcelas y Mercado P2P al 2% split.
- **Capa 2 (Motor Balístico Certificado):** Simulador táctico determinista 1-100 HP con 16 arquetipos, Tiers T1-T5, 29 COs y pruebas unitarias deterministas integradas.
- **Capa 3 (Bark Engine Adaptativo):** Narrativa gráfica con Mayor Stella y consola C4ISR sin audio externo.`
      },
      {
        heading: '2. Checklist de Certificación DRONEPUNK 0.0.1',
        content: `1. Fronteras limpias entre \`@domains/world\`, \`@domains/tactics\`, \`@domains/economy\`, \`@domains/game-feel\` y \`@shared\`.
2. Cero imports legacy y compilación limpia bajo \`npx tsc --noEmit\` y \`npx vite build\`.
3. Cobertura determinista completa en \`test:all\`, \`test:geotactics\`, \`test:cartography\` y Playtest Playwright E2E \`test:qa\`.`
      }
    ]
  }
];
