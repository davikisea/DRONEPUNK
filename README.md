# DRONEPUNK 0.0.1

[![Version](https://img.shields.io/badge/version-0.0.1-blue.svg)](package.json)
[![Vite](https://img.shields.io/badge/Vite-8.3.0-646CFF.svg)](https://vitejs.dev/)
[![React](https://img.shields.io/badge/React-19.0.1-61DAFB.svg)](https://react.dev/)
[![MapLibre GL](https://img.shields.io/badge/MapLibre_GL-6.16.0-396CB2.svg)](https://maplibre.org/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-v4.3.3-38B2AC.svg)](https://tailwindcss.com/)
[![Supabase](https://img.shields.io/badge/Supabase-Realtime_PostgreSQL-3ECF8E.svg)](https://supabase.com/)

Videojuego MMORTS táctico y geopolítico ejecutado nativamente en el navegador como una **Single Page Application (SPA)** de alto rendimiento sobre arquitectura modular de 4 dominios (`@domains/world`, `@domains/tactics`, `@domains/economy`, `@domains/game-feel`) y capa compartida (`@shared`). Combina cartografía vectorial WebGL 2.0 Zero-Raster (**MapLibre GL JS v6.16.0**) con Semantic Zoom de 3 estratos sobre el Teatro Venezuela, combate determinista en escala continua de **1 a 100 HP enteros**, narrativa cómic del **Bark Engine** (29 Comandantes + Mayor Stella #01, sin actores de voz) y una economía artesanal **100% impulsada por jugadores (*player-driven*)** con **Almacén Físico de 16 Chasis Militares**.

---

## 1. Pila Tecnológica Canónica

- **Frontend & Bundler**: [React 19](https://react.dev/) + [TypeScript 7](https://www.typescriptlang.org/) + [Vite 8](https://vitejs.dev/) (`@vitejs/plugin-react` y `@tailwindcss/vite`).
- **Cartografía WebGL 2.0 Zero-Raster**: [MapLibre GL JS v6.16.0](https://maplibre.org/) (`src/domains/world/components/TacticalWorldMap.tsx`) con worker local (`public/maplibre-gl-worker.mjs`), geometrías GeoJSON locales (`public/map/*.json`), picking analítico WGS84 $O(1)$ (`src/domains/world/core/coordinates.ts`) y niebla binaria de 50 bytes (`src/domains/world/core/tacticalBitmap.ts`).
- **Diseño & Animación**: [Tailwind CSS v4](https://tailwindcss.com/) + [Motion](https://motion.dev/) + [Lucide React](https://lucide.dev/) bajo estética C4ISR Atompunk.
- **Motor Táctico Determinista**: Balística continua **1 a 100 HP enteros** (`src/domains/tactics/core/canonicalCombat.ts`), pathfinding $A^*$ (`src/domains/tactics/core/pathfinding.ts`) y simulación RTS por celda (`src/domains/tactics/core/tacticalRtsEngine.ts`).
- **Backend & Base de Datos**: [Supabase](https://supabase.com/) con **PostgreSQL 15+**, **32 migraciones maestras** (`supabase/migrations/`), despliegue consolidado (`supabase/CONSOLIDATED_FULL_DATABASE_DEPLOY.sql`), Row Level Security (RLS) multi-tenant y canales WebSocket de Supabase Realtime (CDC).
- **Audio & Háptica**: Síntesis procedural Web Audio API (`src/domains/game-feel/core/audioManager.ts`) y vibración háptica (`src/domains/game-feel/core/hapticFeedback.ts`).

---

## 2. Requisitos Previos e Instalación Local

### Requisitos del Sistema
- **Node.js**: Versión `20.19+` o `22.12+` (recomendado Node 22 LTS).
- **npm**: Versión `10+`.

### Pasos de Instalación
```bash
# 1. Clonar el repositorio
git clone https://github.com/tu-organizacion/dronepunk.git
cd dronepunk

# 2. Instalar dependencias exactas
npm install

# 3. Configurar variables de entorno
cp .env.example .env.local
```

---

## 3. Variables de Entorno (`.env.local`)

Crea un archivo `.env.local` en la raíz del proyecto con tus credenciales de Supabase:

```env
# Supabase Configuration (Vite Client-Side)
VITE_SUPABASE_URL="https://tu-proyecto.supabase.co"
VITE_SUPABASE_ANON_KEY="tu-anon-key-publica"

# Opcional: Gemini API para generación avanzada de diálogos y barks
GEMINI_API_KEY="tu-gemini-api-key"
```

---

## 4. Scripts y Comandos de Ejecución

Todos los scripts se gestionan mediante `npm`:

| Comando | Descripción |
| :--- | :--- |
| `npm run dev` | Inicia el servidor de desarrollo Vite en `http://localhost:5000` con Hot Module Replacement (HMR). |
| `npm run build` | Compila y optimiza la SPA completa en el directorio `dist/` para producción. |
| `npm run preview` | Previsualiza localmente el artefacto compilado en `dist/`. |
| `npm run test:all` | Ejecuta las 13 suites deterministas troncales (combate, economía, hangar, asedio y cartografía). |
| `npm run test:geotactics` | Ejecuta la batería unificada de 7 suites especializadas (93 aserciones deterministas). |
| `npm run test:cartography` | Audita invariantes de coordenadas WGS84, bitmaps y topología GeoJSON `0.000 m`. |
| `npm run test:metagame` | Ejecuta la batería determinista del Metajuego Territorial Soberano. |
| `npm run test:pve` | Ejecuta las pruebas del orquestador autónomo y balanceador contra IA. |
| `npm run test:e2e` | Ejecuta la suite CLI de integración de extremo a extremo (13 pasos). |
| `npm run test:qa` | Ejecuta la suite E2E WebGL en Chromium real con Playwright (`tests/e2e/game-playtester.spec.ts`). |
| `npm run lint` | Ejecuta la verificación estricta de tipos de TypeScript (`npx tsc --noEmit`). |
| `npm run quality:gate` | Ejecuta la compuerta maestra completa (`lint`, `test:all`, `test:qa`). |

---

## 5. Arquitectura del Repositorio

```
DRONEPUNK/
├── docs/                                         # Corpus documental canónico DRONEPUNK 0.0.1
│   ├── README.md                                 # Índice maestro de volúmenes y dominios
│   ├── 00_ARBOL_CANONICO_DE_SISTEMAS_Y_DESARROLLO.md # Árbol SSOT de sistemas y 4 estados
│   ├── 00_GEOTACTICS_ONLINE_MASTER_SPEC.md       # Especificación maestra de producto
│   ├── 01_MASTER_CARTOGRAPHY_WEBGL_ZERO_RASTER.md # Cartografía WebGL 2.0 Zero-Raster (MapLibre v6)
│   ├── 02_MASTER_METAGAME_INDUSTRY_ECONOMY.md    # Hangar físico 16 chasis, 10 parcelas y P2P 2%
│   ├── 03_MASTER_COMMANDERS_BARK_AND_SOCIAL.md   # Bark Engine, 29 Comandantes y clanes
│   ├── 03_TACTICAL_STRATEGY_SYSTEM_DESIGN.md     # Diseño de 3 vistas, RTS de celda y vulnerabilidad
│   ├── 04_MASTER_DATABASE_AND_SECURITY_SPEC.md   # Esquema PostgreSQL, 32 migraciones y RLS
│   ├── 05_MASTER_GAME_ENGINE_AND_NETWORKING.md   # Motor táctico, Realtime WebSockets y Canvas
│   ├── 06_MASTER_DEVOPS_QA_AND_TELEMETRY.md      # CI/CD, suites deterministas, audio y háptica
│   ├── 07_MASTER_UI_UX_WAR_ROOM.md               # Sistema de diseño Atompunk Map-First C4ISR
│   ├── contracts/                                # Contratos compartidos entre dominios
│   └── archive_legacy/                           # Archivo histórico alineado a DRONEPUNK 0.0.1
├── public/                                       # Assets estáticos, atlas WebP, worker y mapas GeoJSON
│   ├── assets/                                   # Retratos CO, spritesheets e iconos
│   └── map/                                      # Capas locales (theatre_regions.json, theatre_roads.json, etc.)
├── scripts/                                      # Auditorías de dominio, build cartográfico y DB deploy
├── src/
│   ├── domains/
│   │   ├── world/                                # @domains/world/*: MapLibre v6, ALICE, asedios 120s, clanes
│   │   ├── tactics/                              # @domains/tactics/*: Balística 1-100 HP, A*, 29 COs, Guarnición IA
│   │   ├── economy/                              # @domains/economy/*: Almacén 16 chasis, 10 parcelas, P2P 2%
│   │   └── game-feel/                            # @domains/game-feel/*: Bark Engine, Web Audio API, háptica
│   ├── shared/                                   # @shared/*: Supabase client, tipos globales, UI base, QA
│   ├── App.tsx                                   # Orquestador principal Map-First y puente entre dominios
│   ├── docsData.ts                               # Datos estructurados para el visor interno de documentación
│   ├── main.tsx                                  # Punto de entrada de la SPA React 19
│   └── index.css                                 # Tokens Atompunk y utilidades de Tailwind CSS v4
├── supabase/
│   ├── CONSOLIDATED_FULL_DATABASE_DEPLOY.sql     # Despliegue consolidado PostgreSQL
│   └── migrations/                               # 32 migraciones maestras de PostgreSQL
├── tests/
│   └── e2e/                                      # Suites Playwright E2E WebGL (game-playtester, startup-audit)
├── CHANGELOG.md                                  # Registro histórico de versiones (Keep a Changelog)
├── package.json                                  # Metadatos del paquete DRONEPUNK 0.0.1 y scripts
├── tsconfig.json                                 # Configuración estricta de TypeScript y alias @domains/*
└── vite.config.ts                                # Configuración de compilación y code-splitting de Vite 8
```

---

## 6. Los 7 Pilares Canónicos de Diseño (DRONEPUNK 0.0.1)

1. **Almacén Físico de 16 Chasis Militares (Pilar 1):** Todo comandante gestiona un stock físico real de hasta **16 unidades** (**4 slots de vanguardia activa + 12 en reserva** en `public.user_unit_hangar`). Las tropas desplegadas en combate funcionan como munición descartable forjada previamente en industrias territoriales y validada por **Doble Llave** (`$G` in-match + chasis físico).
2. **Combate Determinista en Escala Continua 1–100 HP (Pilar 2):** Cálculo balístico entero continuo de **1 a 100 HP** (`CANONICAL_MAX_HP = 100`) en `src/domains/tactics/core/canonicalCombat.ts`, con mitigación por estrellas de terreno ($0\star$–$4\star$), torres de comunicación y niebla de guerra con emboscadas `¡TRAP!`.
3. **Derrota Inmediata por Aniquilación o Captura de HQ (Pilar 3):** Quedar con **0 tropas vivas** sobre la cuadrícula táctica o perder el Cuartel General (`src/domains/tactics/core/hqCaptureVictory.ts`) decreta la derrota inmediata e inapelable.
4. **Progresión Horizontal de Manufactura T1 a T5 (Pilar 4):** Los chasis escalan horizontalmente de **Tier T1 a T5** (**+2% de efectividad por tier**, techo máximo de **+8% en T5**), con paridad competitiva estricta (**0% Tier 1 Espejo**) en modos clasificados y esports.
5. **Teatro Venezuela y Conquista de Capitales (Pilar 5):** Cartografía WebGL 2.0 Zero-Raster (MapLibre GL v6) sobre `public/map/*.json` cubriendo los **24 estados soberanos (`REG_VE_01`..`REG_VE_24`)**, `BUF_MARITIME_CARIBE` y **7 zonas buffer fronterizas (`BUF_*`)**. Las Capitales requieren **15,000 TCP** y otorgan **+5% de buff regional** (provincias estándar **10,000 TCP**), protegidas por ventanas diarias de vulnerabilidad contra *offline raiding*.
6. **Pérdida Física Real, 35% Chatarra y Kit F2P Inagotable (Pilar 6):** Toda tropa destruida se descuenta físicamente del hangar (**65% sumidero irreversible + 35% recuperación en `tech_scrap`** mediante `settle_territorial_combat_losses`). La Infantería Ligera T1 y el Reconocimiento T1 cuentan con dotación F2P ilimitada anti-bloqueo.
7. **Human Handshake 120s y Mercado P2P Player-Driven (Pilar 7):** Todo asedio abre una ventana defensiva de **120 segundos** (`HUMAN_HANDSHAKE_WINDOW_MS = 120_000`) antes de delegar en la IA de Guarnición (Niveles 1–5). El comercio opera en un **mercado 100% impulsado por jugadores (*player-driven*)** con Cargamento Varado (`strandedCargo`), impuesto del **2%** (**1% Burn Sink + 1% Regalía al Clan Hub**) y bandas dinámicas **VWAP Collar ±25%**.

---

## 7. Licencia

Proyecto privado bajo desarrollo y propiedad de DRONEPUNK Team. Todos los derechos reservados.
