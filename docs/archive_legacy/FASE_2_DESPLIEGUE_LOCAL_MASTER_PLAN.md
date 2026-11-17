# PLAN MAESTRO DE EJECUCIÓN HISTÓRICO — FASE GENERAL 2: EL DESPLIEGUE LOCAL

> **Estado Documental:** Especificación Histórica Archivada — Alineada a **DRONEPUNK 0.0.1**  
> **Documento:** `docs/archive_legacy/FASE_2_DESPLIEGUE_LOCAL_MASTER_PLAN.md`  
> **Proyecto:** **DRONEPUNK 0.0.1**  
> **Estado Histórico:** Archivado tras consolidación local y transición hacia la arquitectura de 4 dominios  
> **Objetivo Original:** Transición del desarrollo teórico hacia una aplicación web funcional, estable y jugable en entorno local (`localhost`), con base de datos Supabase aprovisionada (32 migraciones SQL), repositorio sincronizado y pruebas de experiencia de usuario.

---

## 1. MARCO CONCEPTUAL: TRANSICIÓN DE ETAPAS

```
┌────────────────────────────────┐       ┌────────────────────────────────┐       ┌────────────────────────────────┐
│            FASE 1              │       │            FASE 2              │       │            FASE 3              │
│      DESARROLLO TEÓRICO        │  ──►  │       DESPLIEGUE LOCAL         │  ──►  │       DESPLIEGUE CLOUD         │
│  • GDD & Pilares Canónicos     │       │  • Instalación de Runtimes     │       │  • Vercel Edge / Static CDN    │
│  • Motores 4 Dominios (TS)     │       │  • Sincronización Git          │       │  • Supabase Cloud Production   │
│  • 32 Migraciones SQL          │       │  • Aprovisionamiento DB        │       │  • Dominio & SSL Oficial       │
│  • Arquitectura UI / WebGL     │       │  • npm install & dev server    │       │  • Pipeline CI/CD Automatizado │
│  • Red Teaming & Simulación    │       │  • Playtesting Humano Local    │       │  • Monitorización & Telemetría │
└────────────────────────────────┘       └────────────────────────────────┘       └────────────────────────────────┘
         [HISTÓRICO BASE]                      [FASE DOCUMENTADA]                   [DESPLIEGUE OBJETIVO]
```

### Principios Operativos de la Fase 2:
1. **Cero Suposiciones:** Todo cambio de código debe compilar (`npx tsc --noEmit`) y probarse en tiempo de ejecución.
2. **Prioridad a la Jugabilidad Local (Single Player & Hotseat):** El modo multijugador online Realtime se aísla de forma segura cuando no existe sesión remota, garantizando que el motor táctico `1-100 HP` sea 100% robusto y libre de bloqueos.
3. **Persistencia Progresiva:** Pasar de un estado en memoria volátil a un esquema con fallback local (`localStorage`) e hidratación gradual contra Supabase (`supabase/migrations/`).
4. **Trazabilidad Git Continua:** Cada hito superado debe reflejarse en un commit atómico y descriptivo en el repositorio.

---

## 2. DIAGNÓSTICO DEL ENTORNO ANFITRIÓN (HOST REALITY CHECK HISTÓRICO)

En la etapa inicial de aprovisionamiento de la máquina local se documentó el checklist de verificación previa:
* **Node.js / Bun:** Verificación de binarios en el `PATH`.
* **Git CLI:** Verificación de cliente Git y rama principal.
* **`node_modules`:** Instalación limpia de dependencias (`package.json`).
* **Base de datos Supabase:** Esquemas escritos en SQL (`supabase/migrations/`, 32 migraciones + `supabase/CONSOLIDATED_FULL_DATABASE_DEPLOY.sql` + `supabase/seed.sql`).

Por tanto, el despliegue local siguió un orden secuencial estricto en Hitos.

---

## 3. HITOS ESTRUCTURALES DE LA FASE 2

```
                                      CRONOGRAMA DE HITOS - FASE 2
                                                    │
    ┌─────────────────┬─────────────────┬───────────┴─────┬─────────────────┬─────────────────┐
    ▼                 ▼                 ▼                 ▼                 ▼                 ▼
[ HITO 2.1 ]      [ HITO 2.2 ]      [ HITO 2.3 ]      [ HITO 2.4 ]      [ HITO 2.5 ]      [ HITO 2.6 ]
 Entorno Host &    Git & Repositorio Aprovisionamiento  Dependencias &    Estabilización    Playtesting &
 Runtimes          Remoto            Supabase DB        Dev Server (3000) Core Loop Local   Vercel Prep
```

---

### HITO 2.1: PREPARACIÓN DEL RUNTIME Y HERRAMIENTAS HOST

**Meta:** Dotar al sistema operativo del motor de ejecución de JavaScript/TypeScript y las herramientas de control de versiones.

* **Paso 2.1.1: Instalación de Node.js / Bun**
  * Opción Recomendada: Instalar **Node.js LTS (v20 o v22)** desde el sitio oficial (`nodejs.org`) o mediante administrador de paquetes (`winget install OpenJS.NodeJS.LTS`).
  * Alternativa de alto rendimiento: Instalar **Bun** (`winget install Oven-sh.Bun`).
  * *Verificación:* `node -v` y `npm -v` deben responder con versiones válidas.

* **Paso 2.1.2: Instalación de Git for Windows**
  * Instalar Git (`winget install Git.Git`) y configurar identidad de autor antes de sincronizar cambios.

---

### HITO 2.2: INICIALIZACIÓN Y VINCULACIÓN DEL REPOSITORIO

**Meta:** Mantener el espacio de trabajo local (`DRONEPUNK`) conectado con el repositorio remoto del proyecto.

* **Paso 2.2.1: Verificación del Repositorio Local**
  ```powershell
  cd c:\Users\Usuario\DRONEPUNK
  git status
  ```

* **Paso 2.2.2: Configuración del `.gitignore`**
  Verificar que `.gitignore` excluya `node_modules/`, `dist/`, `.env`, `.env.local`, `.DS_Store` y `*.log`.

---

### HITO 2.3: APROVISIONAMIENTO Y DESPLIEGUE DE LA BASE DE DATOS SUPABASE

**Meta:** Levantar una instancia funcional de PostgreSQL gestionada por Supabase y ejecutar las **32 migraciones** de `supabase/migrations/` más los datos semilla (`supabase/seed.sql`).

Existen **dos rutas viables** para este paso:

#### Ruta A: Supabase Cloud (Recomendada para agilidad sin Docker)
1. Iniciar sesión en [database.new](https://database.new) (Supabase Dashboard).
2. Crear un proyecto de desarrollo denominado `dronepunk-dev`.
3. Obtener la **Project URL** y la **anon public API Key** desde `Project Settings -> API`.
4. En el SQL Editor de Supabase Dashboard, ejecutar `supabase/CONSOLIDATED_FULL_DATABASE_DEPLOY.sql` o usar la CLI de Supabase vinculada sobre las 32 migraciones:
   ```powershell
   npx supabase login
   npx supabase link --project-ref <tu-project-ref>
   npx supabase db push
   ```
5. Ejecutar `supabase/seed.sql` para poblar usuarios, feudos y perfiles de prueba.

#### Ruta B: Supabase Local con Docker
1. Contar con Docker Desktop instalado y corriendo.
2. Ejecutar en la terminal del proyecto:
   ```powershell
   npx supabase init
   npx supabase start
   ```
3. Aplicar las 32 migraciones locales automáticamente:
   ```powershell
   npx supabase db reset
   ```
4. Supabase correrá en `http://127.0.0.1:54321` con Studio en `http://127.0.0.1:54323`.

* **Paso 2.3.3: Configuración de Variables de Entorno (`.env.local`)**
  Crear el archivo `.env.local` con las claves reales de la base elegida:
  ```env
  VITE_APP_ENV="development"
  VITE_APP_URL="http://localhost:3000"
  VITE_SUPABASE_URL="https://tu-proyecto.supabase.co" # o http://127.0.0.1:54321
  VITE_SUPABASE_ANON_KEY="tu-anon-key"
  VITE_ENABLE_PERF_MONITOR="true"
  VITE_AUDIO_ENABLED="true"
  ```

---

### HITO 2.4: INSTALACIÓN DE DEPENDENCIAS Y ARRANQUE DEL SERVIDOR LOCAL

**Meta:** Instalar paquetes NPM, compilar el bundle y levantar Vite en el puerto 3000.

* **Paso 2.4.1: Instalación de Paquetes**
  ```powershell
  npm install
  ```

* **Paso 2.4.2: Verificación de Tipos (TypeScript)**
  ```powershell
  npm run lint
  ```
  *Resolver cualquier advertencia de tipado (`npx tsc --noEmit`) antes de arrancar.*

* **Paso 2.4.3: Arranque del Servidor de Desarrollo**
  ```powershell
  npm run dev
  ```
  * Abrir en el navegador: `http://localhost:3000`
  * Confirmar que la aplicación renderiza el Cuartel General (`src/domains/world/components/WarLobbyHub.tsx`) sin errores en consola DevTools.

---

### HITO 2.5: ESTABILIZACIÓN DEL CORE LOOP TÁCTICO LOCAL

**Meta:** Garantizar que una sesión completa de juego (despliegue desde Almacén Físico de 16 Chasis, combate `1-100 HP`, IA, economía, victoria) sea fluida y libre de bloqueos.

* **Paso 2.5.1: Aislamiento del Módulo Multijugador Realtime**
  * Mantener el hook `src/domains/tactics/hooks/useMatchSync.ts` y `src/domains/world/hooks/useSiegeRealtime.ts` con fallback seguro cuando no hay sesión Realtime activa.
  * En `src/App.tsx`, asegurar que no se disparen suscripciones WebSocket bloqueantes en modo offline/local.

* **Paso 2.5.2: Resolución Dinámica del Foco Inicial de Unidades**
  * En `src/App.tsx`, resolver dinámicamente las primeras unidades desplegadas del jugador activo y del rival desde el mapa inicial en lugar de depender de IDs rígidos.

* **Paso 2.5.3: Blindaje del Reloj Fischer contra Race Conditions**
  * Asegurar que el cambio automático de turno cuando el reloj llega a 0 verifique que las animaciones de combate hayan concluido y que la IA táctica (`src/domains/tactics/core/aiBot.ts`) no esté a medio procesar.

* **Paso 2.5.4: Fallback de Persistencia Local (`localStorage`)**
  * Implementar persistencia de respaldo en el cliente para que los créditos, los chasis físicos del hangar (`user_unit_hangar`) y las partidas completadas se conserven en `localStorage` cuando Supabase no esté conectado.

---

### HITO 2.6: PLAYTESTING Y PRE-REQUISITOS DE PRODUCCIÓN

**Meta:** Someter **DRONEPUNK 0.0.1** a sesiones reales de juego en navegador (humanas y automatizadas con `npm run test:qa`) y verificar la compilación estática de producción.

* **Protocolo de Playtesting:**
  1. Jugar partidas completas en modo **Blitz Skirmish** contra la IA (`src/domains/tactics/core/aiBot.ts`) en dificultad Normal y Difícil.
  2. Jugar una partida en modo **Hotseat 2 Jugadores** en escala continua `1-100 HP` (`src/domains/tactics/core/canonicalCombat.ts`).
  3. Probar la activación de un Superpoder CO (SCOP) y comprobar la aparición de viñetas cómicas (`src/domains/game-feel/core/barkEngine.ts`).
  4. Producir una unidad en `src/domains/tactics/components/ProductionModal.tsx` validando la Doble Llave Material (fondos in-match + stock del Almacén Físico de 16 Chasis o kit F2P ilimitado `infantry` / `recon` Tier 1).
  5. Navegar a los módulos logísticos (Hangar Físico en `src/domains/economy/components/UnitHangarModal.tsx`, Complejo Industrial en `src/domains/economy/components/IndustrialComplexView.tsx`, Mercado P2P en `src/domains/economy/components/P2PMarketplaceView.tsx`) y volver al Lobby Bélico sin desmontar el estado.
  6. Ganar por eliminación de todas las tropas rivales o captura de Cuartel General (`src/domains/tactics/core/hqCaptureVictory.ts`) y validar el despliegue del modal de victoria (`src/shared/ui/MatchSummaryModal.tsx`).

* **Verificación de Build y Suites Deterministas:**
  ```powershell
  npm run test:all
  npm run test:geotactics
  npm run build
  npm run preview
  ```
  * Confirmar que la carpeta `dist/` se genera de forma limpia, sin errores críticos de Rollup/Vite.

---

## 4. MATRIZ DE CRITERIOS DE ACEPTACIÓN (DEFINITION OF DONE - FASE 2)

| Requisito | Criterio de Éxito | Estado Histórico |
|:---|:---|:---:|
| **Control de Versiones** | Repositorio actualizado con commits limpios y rama `main` sincronizada. | ✅ Consolidado |
| **Ambiente Local** | Servidor Vite corriendo en `localhost:3000` sin errores bloqueantes. | ✅ Consolidado |
| **Base de Datos** | 32 migraciones (`supabase/migrations/`) y `supabase/seed.sql` aplicables en Supabase (Local o Cloud). | ✅ Consolidado |
| **Jugabilidad Core** | Partida jugable de principio a fin en `1-100 HP` con Almacén Físico de 16 Chasis. | ✅ Consolidado |
| **Persistencia** | Progreso de jugador y hangar retenidos entre sesiones. | ✅ Consolidado |
| **Build Ready** | `npm run build` genera `dist/` válido listo para despliegue estático. | ✅ Consolidado |

---
*Especificación Histórica Archivada — Alineada al canon de **DRONEPUNK 0.0.1**.*
