import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

interface LogEntry {
  type: string;
  text: string;
  timestamp: string;
}

test.describe('DRONEPUNK 0.0.1 - Playtesting E2E Capa 1 (Metajuego Geopolítico Teatro Venezuela)', () => {
  const screenshotsDir = path.resolve('test-results/screenshots');
  const capturedLogs: LogEntry[] = [];
  const networkFailures: string[] = [];

  test.beforeAll(async () => {
    if (!fs.existsSync(screenshotsDir)) {
      fs.mkdirSync(screenshotsDir, { recursive: true });
    }
  });

  async function setupSupabaseMocks(page: any) {
    await page.route('**/rest/v1/state_sovereignty*', async (route: any) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          {
            state_id: 'REG_VE_02',
            country_id: 'COUNTRY_VEN',
            canonical_country_name: 'República de Venezuela',
            custom_country_name: 'Hegemonía Petrolera de Maracaibo',
            canonical_state_name: 'Zulia',
            custom_state_name: 'Estado Zulia (Teatro Cabimas)',
            controlling_faction_id: 'blue_moon',
            controlling_clan_id: 'clan-ferro',
            tcp_current: 10000,
            tcp_max: 10000,
            gdp_war_credits_per_hour: 12400,
            defense_level: 4,
            custom_motto: 'Acero Frío y Petróleo Pesado',
            sovereign_proclamation: 'El Lago de Maracaibo y la Costa Oriental operan bajo jurisdicción militar del Clan Ferro.',
          },
        ]),
      });
    });

    await page.route('**/rest/v1/tactical_spatial_deployments*', async (route: any) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          {
            id: 'unit-cab-01',
            region_id: 'REG_VE_02',
            cell_key: '9880_15432_0_11',
            sector_x: 9880,
            sector_y: 15432,
            cell_x: 0,
            cell_y: 11,
            lat: 10.395,
            lng: -71.458,
            unit_code: 'md_tank',
            unit_name: 'División Blindada Ferro A-1',
            clan_id: 'clan-ferro',
            clan_tag: 'FERR',
            faction_id: 'blue_moon',
            callsign: 'FERRO-TITÁN-01',
            tier: 2,
            hp: 100,
            max_hp: 100,
            status: 'holding',
            color_hex: '#1D4ED8',
          },
        ]),
      });
    });

    await page.route('**/rest/v1/tactical_fief_constructions*', async (route: any) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          {
            id: 'bld-salina-seaport',
            fief_id: 'fief-cabimas-salina',
            region_id: 'REG_VE_02',
            cell_key: '9880_15432_0_11_bld',
            sector_x: 9880,
            sector_y: 15432,
            cell_x: 0,
            cell_y: 11,
            lat: 10.395,
            lng: -71.458,
            building_type: 'seaport_terminal',
            clan_id: 'clan-ferro',
            level: 3,
            current_hp: 12000,
            max_hp: 12000,
            hourly_upkeep_ec: 450,
          },
        ]),
      });
    });

    await page.route('**/rest/v1/system_catalog_manifest*', async (route: any) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          version_tag: 'v1.0.0-6870aaf8',
          content_hash: '6870aaf802c5ca1dbe383937f72f80acda49de83f3c43743719ff57c375df5d0',
        }),
      });
    });

    await page.route('**/rest/v1/territorial_vulnerability_windows*', async (route: any) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          {
            region_id: 'REG_VE_02',
            clan_id: 'clan-ferro',
            window_start_utc: '20:00:00',
            window_end_utc: '23:00:00',
            cooldown_until_utc: new Date(Date.now() + 48 * 3600 * 1000).toISOString(),
            is_active: true,
          },
        ]),
      });
    });
  }

  test(' Recorrido E2E Capa 1: Boot, Teatro Venezuela (24+7), Edictos, Peajes, Asedio Político y Bark de Mayor Stella', async ({ page }) => {
    test.setTimeout(180000);
    await setupSupabaseMocks(page);

    // 1. Escuchar mensajes de consola
    page.on('console', (msg) => {
      const type = msg.type();
      const text = msg.text();
      capturedLogs.push({ type, text, timestamp: new Date().toISOString() });
      if (type === 'error') {
        console.log(`[BROWSER ERROR] ${text}`);
      }
    });

    // 2. Escuchar excepciones no atrapadas de JavaScript
    page.on('pageerror', (err) => {
      const errText = `${err.name}: ${err.message}\n${err.stack || ''}`;
      capturedLogs.push({ type: 'pageerror', text: errText, timestamp: new Date().toISOString() });
      console.log(`[PAGE CRASH] ${errText}`);
    });

    // 3. Escuchar respuestas HTTP con error (404, 500, etc.)
    page.on('response', (res) => {
      if (res.status() >= 400) {
        const failure = `[HTTP ${res.status()}] ${res.url()}`;
        networkFailures.push(failure);
        console.log(`[NETWORK 4xx/5xx] ${failure}`);
      }
    });

    // --- FASE A.1: CARGA DE ARRANQUE (BOOT SCREEN) ---
    console.log('QA [1/6]: Navegando a http://localhost:5000...');
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 35000 });
    await page.waitForFunction(
      () => (document.querySelector('#root')?.children.length ?? 0) > 0,
      { timeout: 25000 }
    );

    const rootChildren = await page.locator('#root').evaluate((el) => el.children.length);
    expect(rootChildren, 'La aplicación debe montar contenido en #root').toBeGreaterThan(0);

    const bootScreenshot = path.join(screenshotsDir, '01_boot_screen.png');
    await page.screenshot({ path: bootScreenshot, fullPage: true });
    console.log('QA: Captura 01_boot_screen.png registrada.');

    // Esperar a que el Boot Screen alcance el 100% y transicione automáticamente al Estado Mayor
    await page.waitForSelector('[data-region-id^="REG_VE_"]', { timeout: 20000 });
    await page.waitForTimeout(1200);

    // --- FASE A.2: VISUALIZACIÓN DEL MAPA DE VENEZUELA (24 SOBERANAS + 7 BUFFERS) Y HUD MAP-FIRST ---
    console.log('QA [2/6]: Verificando Layout Map-First y Teatro Venezuela (24 regiones soberanas + 7 zonas buffer)...');
    await expect(page.getByTestId('map-first-shell')).toBeVisible();
    await expect(page.getByTestId('persistent-top-header')).toBeVisible();
    await expect(page.getByTestId('left-collapsible-rail')).toBeVisible();
    await expect(page.getByTestId('unified-region-inspector')).toBeVisible();
    await expect(page.getByTestId('right-action-dock')).toBeVisible();
    await expect(page.getByTestId('dock-btn-shop')).toBeVisible();
    await expect(page.getByTestId('dock-btn-industry')).toBeVisible();
    await expect(page.getByTestId('dock-btn-armory')).toBeVisible();
    await expect(page.getByTestId('dock-btn-marketplace')).toBeVisible();
    await expect(page.getByTestId('dock-btn-clans')).toBeVisible();
    await expect(page.getByTestId('dock-btn-docs')).toBeVisible();

    // Subir a Escala 1: País para validar telemetría global del Teatro Venezuela y Project Alice
    await page.getByTestId('breadcrumb-country').click();
    await page.waitForTimeout(350);
    await expect(page.getByTestId('unified-region-inspector')).toHaveAttribute('data-scale', 'country');
    await expect(page.getByText(/METAMANDO POLÍTICO • PROJECT ALICE/i)).toBeVisible();
    await expect(page.getByText(/TEATRO VENEZUELA \(24 ESTADOS \+ 7 BUFFERS\)/i)).toBeVisible();

    // Verificar aislamiento de capas en las píldoras de estado
    await expect(page.locator('text=L1: POLÍTICA ON')).toBeVisible();
    await expect(page.locator('text=L2: BATALLA OFF')).toBeVisible();
    await expect(page.locator('text=/L3: STELLA/i').or(page.getByText(/L3: STELLA/i))).toBeVisible();

    // Contar regiones renderizadas en el lienzo del mapa
    const sovereignCount = await page.locator('[data-region-id^="REG_VE_"]').count();
    const bufferCount = await page.locator('[data-region-id^="BUF_"]').count();
    console.log(`QA: Regiones renderizadas -> Soberanas: ${sovereignCount}, Buffers: ${bufferCount}`);
    expect(sovereignCount, 'Deben existir las 24 regiones soberanas de Venezuela').toBe(24);
    expect(bufferCount, 'Deben existir las 7 zonas buffer fronterizas').toBe(7);

    const mapScreenshot = path.join(screenshotsDir, '02_map_theatre.png');
    await page.screenshot({ path: mapScreenshot, fullPage: true });
    console.log('QA: Captura 02_map_theatre.png registrada.');

    // --- FASE A.3 & A.4: APERTURA DE PESTAÑA GOBIERNO, PROMULGACIÓN Y PEAJE ---
    console.log('QA [3/6]: Abriendo pestaña GOBIERNO en UnifiedRegionInspector...');
    const govTabBtn = page.getByTestId('inspector-tab-government');
    await govTabBtn.click();
    await page.waitForTimeout(400);

    await expect(page.getByText('Aduanas de Estrechos Estratégicos (0% - 10%)')).toBeVisible();
    await expect(page.getByText('Plan Quinquenal de Extracción RGO')).toBeVisible();

    console.log('QA [4/6]: Promulgando edicto "Plan Quinquenal de Extracción RGO" y ajustando peaje en CHK-MARACAIBO...');
    const promulgateButtons = page.getByRole('button', { name: 'Promulgar' });
    await expect(promulgateButtons.first()).toBeVisible();
    await promulgateButtons.first().click();
    await page.waitForTimeout(400);

    await expect(page.getByText(/Plan Quinquenal de Extracción RGO.*promulgado/i)).toBeVisible();

    // Ajustar slider de peaje en CHK-MARACAIBO a 7.5%
    const maracaiboSlider = page.locator('input[type="range"]').first();
    await maracaiboSlider.fill('7.5');
    await maracaiboSlider.dispatchEvent('change');
    await page.waitForTimeout(400);

    await expect(page.getByText('7.5%', { exact: true })).toBeVisible();
    await expect(page.getByText(/Mayor Stella \(stella\)/i)).toBeVisible();

    const metaConsoleScreenshot = path.join(screenshotsDir, '03_meta_console.png');
    await page.screenshot({ path: metaConsoleScreenshot, fullPage: true });
    console.log('QA: Captura 03_meta_console.png registrada.');

    // --- FASE A.5: VERIFICACIÓN DE BLOQUEO BUFFER Y ASEDIO POLÍTICO EN COJEDES (REG_VE_20) ---
    console.log('QA [5/6]: Volviendo a pestaña RESUMEN y validando candado de Zona Buffer...');
    const summaryTabBtn = page.getByTestId('inspector-tab-summary');
    await summaryTabBtn.click();
    await page.waitForTimeout(400);

    // 1. Verificar que una región Buffer (BUF_CO_01) esté bloqueada en Fase 1
    const bufferNode = page.locator('[data-region-id="BUF_CO_01"]');
    await bufferNode.dispatchEvent('click');
    await page.waitForTimeout(400);
    await expect(page.getByTestId('unified-region-inspector')).toHaveAttribute('data-scale', 'state');
    await expect(page.getByRole('button', { name: /ZONA BUFFER BLOQUEADA \(FASE 1\)/i })).toBeVisible();

    // 2. Seleccionar provincia fronteriza en disputa Cojedes (REG_VE_20) y lanzar asedio político
    console.log('QA [6/6]: Seleccionando Cojedes (REG_VE_20) y ejecutando operación de asedio político...');
    const cojedesNode = page.locator('[data-region-id="REG_VE_20"]');
    await cojedesNode.dispatchEvent('click');
    await page.waitForTimeout(400);

    await expect(page.getByRole('heading', { name: /Cojedes - San Carlos/i })).toBeVisible();

    const siegeButton = page.getByRole('button', { name: /EJECUTAR PRESIÓN DE ASEDIO \(-TCP\)/i });
    await expect(siegeButton).toBeVisible();
    await siegeButton.click();
    await page.waitForTimeout(800);

    // Verificar feedback del asedio político y reducción de TCP
    await expect(page.getByText(/Asedio político ejecutado sobre Cojedes - San Carlos/i)).toBeVisible();

    // --- FASE A.6: VERIFICACIÓN DE BARK DE MAYOR STELLA Y AISLAMIENTO DE CAPA 2 ---
    // Confirmar que seguimos en Capa 1 (lobby) y nunca se abrió CombatTheaterView
    const bridgeActive = await page.evaluate(() => typeof window.__TACTICAL_QA_BRIDGE__ !== 'undefined');
    let finalSnapshot: any = null;
    if (bridgeActive) {
      finalSnapshot = await page.evaluate(() => window.__TACTICAL_QA_BRIDGE__!.getSnapshot());
      expect(finalSnapshot?.activeScreen).toBe('lobby');
    }

    // Verificar emisión de Bark de Mayor Stella en el overlay o telemetría
    const stellaOverlayVisible = await page
      .getByText(/Mayor Stella/i)
      .first()
      .isVisible()
      .catch(() => false);
    console.log(`QA: ¿Bark contextual de Mayor Stella visible en pantalla?: ${stellaOverlayVisible}`);
    expect(stellaOverlayVisible, 'El Bark contextual de la Mayor Stella debe mostrarse tras el asedio').toBe(true);

    const siegeScreenshot = path.join(screenshotsDir, '04_siege_executed.png');
    await page.screenshot({ path: siegeScreenshot, fullPage: true });
    console.log('QA: Captura 04_siege_executed.png registrada.');

    // --- GENERACIÓN DEL REPORTE DE TELEMETRÍA ---
    const fatalErrors = capturedLogs.filter(
      (l) =>
        (l.type === 'error' || l.type === 'pageerror') &&
        !l.text.includes('AudioContext') &&
        !l.text.includes('audio device')
    );
    const reportData = {
      timestamp: new Date().toISOString(),
      status: fatalErrors.length === 0 && networkFailures.length === 0 ? 'PASS_CLEAN' : 'ISSUES_DETECTED',
      rootMounted: rootChildren > 0,
      bridgeActive,
      layer1Verified: {
        sovereignRegionsCount: sovereignCount,
        bufferRegionsCount: bufferCount,
        edictEnacted: 'Plan Quinquenal de Extracción RGO',
        chokepointTollAdjusted: 'CHK-MARACAIBO -> 7.5%',
        bufferLockVerified: 'BUF_CO_01',
        siegeExecutedOn: 'REG_VE_20 (Cojedes - San Carlos)',
        stellaBarkVerified: stellaOverlayVisible,
        layer2CombatIsolated: finalSnapshot?.activeScreen === 'lobby',
      },
      fatalErrorsCount: fatalErrors.length,
      fatalErrors,
      networkFailuresCount: networkFailures.length,
      networkFailures,
      finalSnapshot,
      screenshots: ['01_boot_screen.png', '02_map_theatre.png', '03_meta_console.png', '04_siege_executed.png'],
    };

    const reportFile = path.resolve('test-results/qa-run-latest.json');
    fs.writeFileSync(reportFile, JSON.stringify(reportData, null, 2), 'utf-8');
    console.log(`QA: Reporte de telemetría guardado en ${reportFile}`);

    expect(fatalErrors.length, `Errores fatales detectados: ${JSON.stringify(fatalErrors)}`).toBe(0);
    expect(networkFailures.length, `Fallos de red detectados: ${JSON.stringify(networkFailures)}`).toBe(0);
  });

  test('Recorrido E2E 3 Niveles de Zoom: Macro (z<10), Operacional (z=10) y Microjuego (z=15)', async ({ page }) => {
    test.setTimeout(180000);
    await setupSupabaseMocks(page);
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });

    console.log('QA ZOOM [1/4]: Cargando aplicación y esperando mapa WebGL...');
    await page.goto('/?no-splash=1', { waitUntil: 'domcontentloaded', timeout: 35000 });
    await page.waitForSelector('[data-region-id^="REG_VE_"]', { timeout: 20000 });
    await page.waitForTimeout(1000);

    // --- NIVEL 1: ESCALA PAÍS (COUNTRY_VEN) Y ESCALA ESTADO (REG_VE_02) ---
    console.log('QA ZOOM [2/4]: Escala País (COUNTRY_VEN) y Escala Estado (REG_VE_02 Zulia) en UnifiedRegionInspector...');
    const countryNode = page.locator('[data-country-id="COUNTRY_VEN"]');
    await countryNode.dispatchEvent('click');
    await page.waitForTimeout(400);
    await expect(page.getByTestId('unified-region-inspector')).toHaveAttribute('data-scale', 'country');

    const zuliaBtn = page.locator('[data-region-id="REG_VE_02"]');
    await zuliaBtn.dispatchEvent('click');
    await page.waitForTimeout(600);
    await expect(page.getByTestId('unified-region-inspector')).toHaveAttribute('data-scale', 'state');

    // Validar telemetría en UnifiedRegionInspector (Escala Estado)
    await expect(page.getByText(/PIB DE GUERRA/i)).toBeVisible();
    await expect(page.getByText(/RENDIMIENTO DE RECURSOS/i)).toBeVisible();

    const unlockBtn = page.getByRole('button', { name: /DESBLOQUEAR PANEL DE CONTROL/i });
    if (await unlockBtn.isVisible()) {
      await unlockBtn.dispatchEvent('click');
      await page.waitForTimeout(600);
      await expect(page.getByText(/PANEL DE CONTROL DEL ESTADO/i)).toBeVisible();
      // Cerrar modal
      const closeBtn = page.getByTitle('Cerrar Consola');
      if (await closeBtn.isVisible()) await closeBtn.dispatchEvent('click');
    }

    const macroScreenshot = path.join(screenshotsDir, '05_macro_zoom_level1.png');
    await page.screenshot({ path: macroScreenshot, fullPage: true });

    // --- NIVEL 2: VISTA OPERACIONAL Y ESCALA MUNICIPIO (z = 10.5) ---
    console.log('QA ZOOM [3/4]: Conmutando a Nivel 2 Operacional (z = 10.5) y Escala Municipio (Cabimas)...');
    await page.evaluate(() => {
      if (typeof (window as any).__SET_TACTICAL_ZOOM__ === 'function') {
        (window as any).__SET_TACTICAL_ZOOM__(10.5);
      } else {
        const map = (window as any).__TACTICAL_MAP_INSTANCE__;
        if (map) {
          map.jumpTo({ center: [-71.455, 10.395], zoom: 10.5 });
          map.fire('zoom');
        }
      }
    });
    await page.waitForTimeout(1000);

    // Validar telemetría de HUD de Zoom (debe reflejar >= 10x)
    const zoomText = await page.locator('text=OPENPLACE WEBGL • ZOOM:').textContent();
    console.log(`QA ZOOM: Telemetría de zoom en pantalla: "${zoomText}"`);
    expect(zoomText).toMatch(/ZOOM: 10\./);

    // Seleccionar Municipio Cabimas y validar Escala 3 (municipality)
    const cabimasBtn = page.locator('[data-municipality-id="MUN_ZULIA_CABIMAS"]');
    await cabimasBtn.dispatchEvent('click');
    await page.waitForTimeout(500);
    await expect(page.getByTestId('unified-region-inspector')).toHaveAttribute('data-scale', 'municipality');
    await expect(page.getByRole('heading', { name: /Cabimas/i })).toBeVisible();

    const operationalScreenshot = path.join(screenshotsDir, '06_operational_zoom_level2.png');
    await page.screenshot({ path: operationalScreenshot, fullPage: true });

    // --- NIVEL 3: VISTA MICROJUEGO TÁCTICO & ESCALA CELDA 20x20 (z = 15.2) ---
    console.log('QA ZOOM [4/4]: Conmutando a Nivel 3 Microjuego Táctico (z = 15.2) y Escala Celda...');
    await page.evaluate(() => {
      if (typeof (window as any).__SET_TACTICAL_ZOOM__ === 'function') {
        (window as any).__SET_TACTICAL_ZOOM__(15.2);
      } else {
        const map = (window as any).__TACTICAL_MAP_INSTANCE__;
        if (map) {
          map.jumpTo({ center: [-71.455, 10.395], zoom: 15.2 });
          map.fire('zoom');
        }
      }
    });
    await page.waitForTimeout(1000);

    // Validar Escala 4 (cell) y HUD del Microjuego Táctico dentro de UnifiedRegionInspector
    await expect(page.getByTestId('unified-region-inspector')).toHaveAttribute('data-scale', 'cell');
    await expect(page.getByText('LOD 3 • MICROJUEGO TÁCTICO', { exact: true })).toBeVisible();
    await expect(page.getByText(/ASIGNACIÓN ESPACIAL O\(1\)/i).first()).toBeVisible();

    // Validar botones de acción en-situ: DESPLEGAR y CONSTRUIR
    const deployBtn = page.getByRole('button', { name: /DESPLEGAR/i }).first();
    const buildBtn = page.getByRole('button', { name: /CONSTRUIR/i }).first();
    await expect(deployBtn).toBeVisible();
    await expect(buildBtn).toBeVisible();

    // Probar apertura del Modal de Despliegue de Unidades
    await deployBtn.click({ force: true });
    await page.waitForTimeout(500);
    await expect(page.getByText(/DESPLIEGUE TÁCTICO DE TROPA/i)).toBeVisible();
    const closeDeploy = page.getByTitle('Cerrar Despliegue');
    if (await closeDeploy.isVisible()) await closeDeploy.click({ force: true });
    await page.waitForTimeout(400);

    // Probar apertura del Drawer de Construcción de Estructuras
    await buildBtn.click({ force: true });
    await page.waitForTimeout(500);
    await expect(page.getByText(/CONSTRUCCIÓN IN-SITU/i)).toBeVisible();
    const closeBuild = page.getByTitle('Cerrar Construcción');
    await expect(closeBuild).toBeVisible();
    await closeBuild.click();
    await expect(page.getByText(/CONSTRUCCIÓN IN-SITU/i)).toBeHidden();

    const tacticalScreenshot = path.join(screenshotsDir, '07_microgame_zoom_level3.png');
    await page.screenshot({ path: tacticalScreenshot, fullPage: true });

    // Probar interacción RTS en celda táctica
    console.log('QA RTS: Probando interacción de combate continuo y selección en cuadrícula...');
    const mapCanvas = page.locator('canvas.maplibregl-canvas');
    if (await mapCanvas.isVisible()) {
      const box = await mapCanvas.boundingBox();
      if (box) {
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        await page.waitForTimeout(400);
      }
    }
    const rtsScreenshot = path.join(screenshotsDir, '08_continuous_rts_engagement.png');
    await page.screenshot({ path: rtsScreenshot, fullPage: true });

    // --- VERIFICACIÓN PERIMETRAL: RAIL IZQUIERDO, CERO SOLAPAMIENTOS, OVERLAY INDUSTRIA Y RESOLUCIONES ---
    console.log('QA LAYOUT: Validando Rail Izquierdo, Overlay sobre Mapa y Cero Solapamientos (1280x720 & 1920x1080)...');
    await page.getByTestId('left-rail-toggle').click();
    await page.waitForTimeout(350);
    await expect(page.getByTestId('left-rail-drawer')).toBeVisible();

    const barkWidget = page.locator('[aria-label="Oficial al Mando de Vanguardia (Bark Engine)"]');
    await expect(barkWidget).toBeVisible();

    const drawerBox = await page.getByTestId('left-rail-drawer').boundingBox();
    const barkBox = await barkWidget.boundingBox();
    const inspectorBox = await page.getByTestId('unified-region-inspector').boundingBox();
    const dockBox = await page.getByTestId('right-action-dock').boundingBox();

    expect(drawerBox, 'Left rail drawer debe tener boundingBox').not.toBeNull();
    expect(barkBox, 'CommanderBarkWidget debe tener boundingBox').not.toBeNull();
    expect(inspectorBox, 'UnifiedRegionInspector debe tener boundingBox').not.toBeNull();
    expect(dockBox, 'RightActionDock debe tener boundingBox').not.toBeNull();

    if (drawerBox && barkBox) {
      expect(
        drawerBox.y + drawerBox.height,
        `LeftRailDrawer (${drawerBox.y + drawerBox.height}) no debe invadir BarkWidget (${barkBox.y})`
      ).toBeLessThanOrEqual(barkBox.y + 2);
    }
    if (inspectorBox && dockBox) {
      expect(
        inspectorBox.y + inspectorBox.height,
        `UnifiedRegionInspector (${inspectorBox.y + inspectorBox.height}) no debe solaparse con RightActionDock (${dockBox.y})`
      ).toBeLessThanOrEqual(dockBox.y + 2);
    }

    // Captura 1280x720 con Rail Izquierdo e Inspector Derecho visibles
    await page.screenshot({ path: path.join(screenshotsDir, '12_map_first_1280x720.png'), fullPage: true });

    // Colapsar rail izquierdo y probar apertura de estación DOCTRINA como overlay sin desmontar el mapa WebGL
    await page.getByTestId('left-rail-toggle').click();
    await page.waitForTimeout(300);
    await page.getByTestId('dock-btn-docs').click();
    await page.waitForTimeout(450);
    await expect(page.locator('canvas.maplibregl-canvas')).toBeAttached();
    const closeOverlayBtn = page.getByTitle('Cerrar estación y volver al Mapa Táctico [ESC]');
    await expect(closeOverlayBtn).toBeVisible();
    await closeOverlayBtn.click();
    await page.waitForTimeout(350);

    // Captura 1920x1080 y validación de no-solapamiento en Full HD
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.waitForTimeout(450);
    const fhdInspectorBox = await page.getByTestId('unified-region-inspector').boundingBox();
    const fhdDockBox = await page.getByTestId('right-action-dock').boundingBox();
    if (fhdInspectorBox && fhdDockBox) {
      expect(fhdInspectorBox.y + fhdInspectorBox.height).toBeLessThanOrEqual(fhdDockBox.y + 2);
    }
    await page.screenshot({ path: path.join(screenshotsDir, '13_map_first_1920x1080.png'), fullPage: true });
    await page.setViewportSize({ width: 1280, height: 720 });

    // Cero errores críticos
    const fatalErrors = errors.filter(
      (e) =>
        !e.includes('deprecated') &&
        !e.includes('favicon') &&
        !e.includes('AudioContext') &&
        !e.includes('audio device')
    );
    expect(fatalErrors.length, `Errores fatales en test de zoom: ${JSON.stringify(fatalErrors)}`).toBe(0);
    console.log('QA ZOOM: ¡Las 3 Vistas de Zoom (Macro, Operacional, Microjuego) superadas con 100% de éxito!');
  });

  test('Auditoría Topológica WebGL Zero-Raster y Semantic LOD en Venezuela & Zulia (Zooms 5.5, 10.5 y 15.5)', async ({ page }) => {
    test.setTimeout(180000);
    await setupSupabaseMocks(page);

    const consoleErrors: string[] = [];
    const httpFailures: string[] = [];
    const requestedUrls: string[] = [];

    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
        console.log(`[BROWSER ERROR] ${msg.text()}`);
      }
    });
    page.on('pageerror', (err) => {
      consoleErrors.push(`${err.name}: ${err.message}`);
      console.log(`[PAGE CRASH] ${err.message}`);
    });
    page.on('request', (req) => {
      requestedUrls.push(req.url());
    });
    page.on('response', (res) => {
      if (res.status() >= 400) {
        const failure = `[HTTP ${res.status()}] ${res.url()}`;
        httpFailures.push(failure);
        console.log(`[NETWORK 4xx/5xx] ${failure}`);
      }
    });

    console.log('QA TOPOLOGY [1/5]: Navegando y esperando mapa WebGL + fuentes TopoJSON locales...');
    await page.goto('/?no-splash=1', { waitUntil: 'domcontentloaded', timeout: 35000 });
    await page.waitForSelector('[data-region-id^="REG_VE_"]', { timeout: 25000 });

    // Plegar el inspector derecho si está abierto para despejar el teatro venezolano completo en las capturas
    const foldConsoleTab = page.getByTestId('close-inspector-btn');
    if (await foldConsoleTab.isVisible().catch(() => false)) {
      await foldConsoleTab.click();
      await page.waitForTimeout(350);
    }

    // Esperar a que __TACTICAL_QA_BRIDGE__, __TACTICAL_MAP_INSTANCE__ y todas las fuentes GeoJSON carguen
    await page.waitForFunction(
      () => {
        const bridge = (window as any).__TACTICAL_QA_BRIDGE__;
        const map = (window as any).__TACTICAL_MAP_INSTANCE__;
        if (!bridge || !map) return false;
        const snap = bridge.getSnapshot();
        if (!snap || snap.activeScreen !== 'lobby' || !snap.canvasRendered) return false;
        if (!map.isStyleLoaded()) return false;

        const requiredSources = ['world-land', 'tactical-provinces', 'tactical-borders-mesh', 'zulia-municipalities'];
        for (const srcId of requiredSources) {
          if (!map.getSource(srcId) || !map.isSourceLoaded(srcId)) return false;
        }

        const requiredLayers = [
          'world-land-border',
          'provinces-fill',
          'zulia-municipalities-fill',
          'tactical-borders-mesh',
          'zulia-municipalities-border',
          'provinces-borders',
          'provinces-vulnerable-halo',
          'tactical-viewport-grid-lines',
        ];
        for (const layerId of requiredLayers) {
          if (!map.getLayer(layerId)) return false;
        }

        // Confirmar que theatre_regions.json (con BUF_MARITIME_CARIBE) reemplazó el fallback inicial
        const provSourceData = map.getStyle()?.sources?.['tactical-provinces']?.data;
        const features = provSourceData?.features;
        return Array.isArray(features) && features.some((f: any) => f.id === 'BUF_MARITIME_CARIBE');
      },
      null,
      { timeout: 30000 }
    );

    // Verificar invariantes de estilo, maxzoom, tolerance: 0, buffer: 64 y Z-order estricto
    const styleAudit = await page.evaluate(() => {
      const bridge = (window as any).__TACTICAL_QA_BRIDGE__;
      const map = (window as any).__TACTICAL_MAP_INSTANCE__;
      const style = map.getStyle();
      const layerIds = (style.layers || []).map((l: any) => l.id);

      const sources = style.sources || {};
      const borderMeshSource = map.getSource('tactical-borders-mesh');

      return {
        ping: bridge.ping(),
        snapshot: bridge.getSnapshot(),
        hasBordersMeshSource: Boolean(borderMeshSource),
        bordersMeshLoaded: map.isSourceLoaded('tactical-borders-mesh'),
        provincesLoaded: map.isSourceLoaded('tactical-provinces'),
        zuliaLoaded: map.isSourceLoaded('zulia-municipalities'),
        maxzooms: {
          worldLandBorder: map.getLayer('world-land-border')?.maxzoom,
          tacticalBordersMesh: map.getLayer('tactical-borders-mesh')?.maxzoom,
          provincesBorders: map.getLayer('provinces-borders')?.maxzoom,
          zuliaMunicipalitiesBorder: map.getLayer('zulia-municipalities-border')?.maxzoom,
          provincesFill: map.getLayer('provinces-fill')?.maxzoom,
          zuliaMunicipalitiesFill: map.getLayer('zulia-municipalities-fill')?.maxzoom,
          provincesVulnerableHalo: map.getLayer('provinces-vulnerable-halo')?.maxzoom,
        },
        tolerances: {
          tacticalProvinces: sources['tactical-provinces']?.tolerance,
          tacticalBordersMesh: sources['tactical-borders-mesh']?.tolerance,
          zuliaMunicipalities: sources['zulia-municipalities']?.tolerance,
        },
        buffers: {
          tacticalProvinces: sources['tactical-provinces']?.buffer,
          tacticalBordersMesh: sources['tactical-borders-mesh']?.buffer,
          zuliaMunicipalities: sources['zulia-municipalities']?.buffer,
        },
        provincesBordersFilter: JSON.stringify(map.getLayer('provinces-borders')?.filter || null),
        layerIds,
      };
    });

    expect(styleAudit.ping).toBe('PONG_TACTICAL_QA_ACTIVE');
    expect(styleAudit.snapshot.activeScreen).toBe('lobby');
    expect(styleAudit.hasBordersMeshSource).toBe(true);
    expect(styleAudit.bordersMeshLoaded).toBe(true);
    expect(styleAudit.provincesLoaded).toBe(true);
    expect(styleAudit.zuliaLoaded).toBe(true);

    expect(styleAudit.maxzooms.worldLandBorder).toBe(7.5);
    expect(styleAudit.maxzooms.tacticalBordersMesh).toBe(14.5);
    expect(styleAudit.maxzooms.provincesBorders).toBe(14.5);
    expect(styleAudit.maxzooms.zuliaMunicipalitiesBorder).toBe(14.5);
    expect(styleAudit.maxzooms.provincesFill).toBe(14.5);
    expect(styleAudit.maxzooms.zuliaMunicipalitiesFill).toBe(14.5);
    expect(styleAudit.maxzooms.provincesVulnerableHalo).toBe(14.5);

    expect(styleAudit.tolerances.tacticalProvinces).toBe(0);
    expect(styleAudit.tolerances.tacticalBordersMesh).toBe(0);
    expect(styleAudit.tolerances.zuliaMunicipalities).toBe(0);
    expect(styleAudit.buffers.tacticalProvinces).toBe(64);
    expect(styleAudit.buffers.tacticalBordersMesh).toBe(64);
    expect(styleAudit.buffers.zuliaMunicipalities).toBe(64);
    expect(styleAudit.provincesBordersFilter).toContain('isSelected');
    expect(styleAudit.provincesBordersFilter).toContain('isUnderSiege');

    const expectedZOrder = [
      'background',
      'world-land-mass',
      'world-land-border',
      'provinces-fill',
      'zulia-municipalities-fill',
      'tactical-borders-mesh',
      'zulia-municipalities-border',
      'provinces-borders',
      'provinces-vulnerable-halo',
      'roads-ink-shadow',
      'cities-glow',
      'tactical-viewport-grid-lines',
      'tactical-rts-units-sprites',
    ];
    for (let i = 1; i < expectedZOrder.length; i++) {
      const prevIdx = styleAudit.layerIds.indexOf(expectedZOrder[i - 1]!);
      const currIdx = styleAudit.layerIds.indexOf(expectedZOrder[i]!);
      expect(prevIdx, `Falta capa ${expectedZOrder[i - 1]}`).toBeGreaterThanOrEqual(0);
      expect(currIdx, `Falta capa ${expectedZOrder[i]}`).toBeGreaterThanOrEqual(0);
      expect(currIdx, `Z-order inválido: ${expectedZOrder[i - 1]} -> ${expectedZOrder[i]}`).toBeGreaterThan(prevIdx);
    }

    const jumpAndWaitIdle = async (center: [number, number], zoom: number) => {
      await page.evaluate(
        async ({ targetCenter, targetZoom }) => {
          const map = (window as any).__TACTICAL_MAP_INSTANCE__;
          await new Promise<void>((resolve) => {
            let done = false;
            const finish = () => {
              if (done) return;
              done = true;
              resolve();
            };
            map.once('idle', finish);
            map.jumpTo({ center: targetCenter, zoom: targetZoom });
            if (typeof (window as any).__SET_TACTICAL_ZOOM__ === 'function') {
              (window as any).__SET_TACTICAL_ZOOM__(targetZoom);
            }
            setTimeout(finish, 4500);
          });
        },
        { targetCenter: center, targetZoom: zoom }
      );
      // Esperar >260ms para que finalice el transition blur de cambio de estrato
      await page.waitForTimeout(450);
    };

    // --- ZOOM 5.5: ESTRATO GLOBAL (VENEZUELA COMPLETA) ---
    console.log('QA TOPOLOGY [2/5]: Validando Estrato Global (Zoom 5.5, Venezuela [-66.5, 8.2])...');
    await jumpAndWaitIdle([-66.5, 8.2], 5.5);

    const globalMetrics = await page.evaluate(() => {
      const map = (window as any).__TACTICAL_MAP_INSTANCE__;
      return {
        zoom: map.getZoom(),
        provincesFillCount: map.queryRenderedFeatures({ layers: ['provinces-fill'] }).length,
        provincesRenderedIds: Array.from(
          new Set(
            map.queryRenderedFeatures({ layers: ['provinces-fill'] }).map((f: any) => f.properties?.id)
          )
        ),
        bordersMeshCount: map.queryRenderedFeatures({ layers: ['tactical-borders-mesh'] }).length,
        worldLandBorderCount: map.queryRenderedFeatures({ layers: ['world-land-border'] }).length,
        zuliaMunFillCount: map.queryRenderedFeatures({ layers: ['zulia-municipalities-fill'] }).length,
        zuliaMunBorderCount: map.queryRenderedFeatures({ layers: ['zulia-municipalities-border'] }).length,
      };
    });
    expect(globalMetrics.zoom).toBeCloseTo(5.5, 1);
    expect(globalMetrics.provincesFillCount).toBeGreaterThan(0);
    expect(globalMetrics.provincesRenderedIds.length).toBeGreaterThanOrEqual(20);
    expect(globalMetrics.bordersMeshCount).toBeGreaterThan(0);
    expect(globalMetrics.worldLandBorderCount).toBeGreaterThan(0);
    expect(globalMetrics.zuliaMunFillCount).toBe(0);
    expect(globalMetrics.zuliaMunBorderCount).toBe(0);

    await page.screenshot({ path: path.join(screenshotsDir, '09_global_zoom_5_5.png'), fullPage: true });
    console.log('QA TOPOLOGY: Captura 09_global_zoom_5_5.png registrada.');

    // --- ZOOM 10.5: ESTRATO OPERACIONAL (ZULIA / LAGO DE MARACAIBO / CABIMAS / MENE GRANDE / BOBURES) ---
    console.log('QA TOPOLOGY [3/5]: Validando Estrato Operacional (Zoom 10.5, Lago [-71.35, 9.95], Cabimas, Mene Grande, Bobures)...');
    await jumpAndWaitIdle([-71.35, 9.95], 10.5);

    const operationalLakeMetrics = await page.evaluate(() => {
      const map = (window as any).__TACTICAL_MAP_INSTANCE__;
      const munFill = map.queryRenderedFeatures({ layers: ['zulia-municipalities-fill'] });
      const munIds = Array.from(new Set(munFill.map((f: any) => f.properties?.id)));
      const cityPts = map.queryRenderedFeatures({ layers: ['cities-point'] });
      const cityNames = Array.from(new Set(cityPts.map((f: any) => f.properties?.name)));
      return {
        zoom: map.getZoom(),
        worldLandBorderCount: map.queryRenderedFeatures({ layers: ['world-land-border'] }).length,
        zuliaMunFillCount: munFill.length,
        zuliaMunIds: munIds,
        zuliaMunBorderCount: map.queryRenderedFeatures({ layers: ['zulia-municipalities-border'] }).length,
        bordersMeshCount: map.queryRenderedFeatures({ layers: ['tactical-borders-mesh'] }).length,
        cityNames,
      };
    });

    expect(operationalLakeMetrics.zoom).toBeCloseTo(10.5, 1);
    expect(operationalLakeMetrics.worldLandBorderCount).toBe(0);
    expect(operationalLakeMetrics.zuliaMunFillCount).toBeGreaterThan(0);
    expect(operationalLakeMetrics.zuliaMunBorderCount).toBeGreaterThan(0);
    expect(operationalLakeMetrics.bordersMeshCount).toBeGreaterThan(0);
    expect(operationalLakeMetrics.zuliaMunIds).toContain('MUN_ZULIA_BARALT');
    expect(operationalLakeMetrics.zuliaMunIds).toContain('MUN_ZULIA_VALMORE_RODRIGUEZ');

    await page.screenshot({ path: path.join(screenshotsDir, '10_operational_zulia_10_5.png'), fullPage: true });
    console.log('QA TOPOLOGY: Captura 10_operational_zulia_10_5.png registrada.');

    // Verificar cada enclave clave del Zulia a zoom 10.5: Cabimas, Mene Grande y Bobures
    const zuliaCheckpoints: Array<{ label: string; center: [number, number]; munId: string; cityName: string }> = [
      { label: 'Cabimas', center: [-71.455, 10.395], munId: 'MUN_ZULIA_CABIMAS', cityName: 'Cabimas' },
      { label: 'Mene Grande', center: [-70.9253, 9.8167], munId: 'MUN_ZULIA_BARALT', cityName: 'Mene Grande' },
      { label: 'Bobures', center: [-71.16, 9.235], munId: 'MUN_ZULIA_SUCRE', cityName: 'Bobures' },
    ];
    for (const cp of zuliaCheckpoints) {
      await jumpAndWaitIdle(cp.center, 10.5);
      const cpMetrics = await page.evaluate((targetCenter) => {
        const map = (window as any).__TACTICAL_MAP_INSTANCE__;
        const centerPt = map.project(targetCenter);
        const centerMuns = map.queryRenderedFeatures(centerPt, { layers: ['zulia-municipalities-fill'] });
        const cityPts = map.queryRenderedFeatures({ layers: ['cities-point'] });
        return {
          worldLandBorderCount: map.queryRenderedFeatures({ layers: ['world-land-border'] }).length,
          zuliaMunFillCount: map.queryRenderedFeatures({ layers: ['zulia-municipalities-fill'] }).length,
          zuliaMunBorderCount: map.queryRenderedFeatures({ layers: ['zulia-municipalities-border'] }).length,
          bordersMeshCount: map.queryRenderedFeatures({ layers: ['tactical-borders-mesh'] }).length,
          hitMunIds: centerMuns.map((f: any) => f.properties?.id),
          cityNames: Array.from(new Set(cityPts.map((f: any) => f.properties?.name))),
          opUnitSpritesCount: map.queryRenderedFeatures({ layers: ['tactical-operational-units-heatmap'] }).length,
        };
      }, cp.center);
      expect(cpMetrics.worldLandBorderCount, `${cp.label}: world-land-border no debe renderizar a z=10.5`).toBe(0);
      expect(cpMetrics.zuliaMunFillCount, `${cp.label}: zulia-municipalities-fill debe estar activo`).toBeGreaterThan(0);
      expect(cpMetrics.zuliaMunBorderCount, `${cp.label}: zulia-municipalities-border debe estar activo`).toBeGreaterThan(0);
      expect(cpMetrics.bordersMeshCount, `${cp.label}: tactical-borders-mesh debe estar activo`).toBeGreaterThan(0);
      expect(cpMetrics.hitMunIds, `${cp.label}: centro debe caer en ${cp.munId}`).toContain(cp.munId);
      expect(cpMetrics.cityNames, `${cp.label}: cabecera ${cp.cityName} debe renderizarse`).toContain(cp.cityName);
      if (cp.munId === 'MUN_ZULIA_CABIMAS') {
        expect(cpMetrics.opUnitSpritesCount, 'Cabimas Estrato 2 debe renderizar sprites verdes de unidades').toBeGreaterThan(0);
      }
    }

    // --- ZOOM 15.5: ESTRATO TÁCTICO 20x20 (CABIMAS) ---
    console.log('QA TOPOLOGY [4/5]: Validando Estrato Táctico 20x20 (Zoom 15.5, Cabimas [-71.455, 10.395])...');
    await jumpAndWaitIdle([-71.455, 10.395], 15.5);

    const tacticalMetrics = await page.evaluate(() => {
      const map = (window as any).__TACTICAL_MAP_INSTANCE__;
      return {
        zoom: map.getZoom(),
        gridLinesCount: map.queryRenderedFeatures({ layers: ['tactical-viewport-grid-lines'] }).length,
        worldLandBorderCount: map.queryRenderedFeatures({ layers: ['world-land-border'] }).length,
        provincesFillCount: map.queryRenderedFeatures({ layers: ['provinces-fill'] }).length,
        provincesBordersCount: map.queryRenderedFeatures({ layers: ['provinces-borders'] }).length,
        tacticalBordersMeshCount: map.queryRenderedFeatures({ layers: ['tactical-borders-mesh'] }).length,
        zuliaMunFillCount: map.queryRenderedFeatures({ layers: ['zulia-municipalities-fill'] }).length,
        zuliaMunBorderCount: map.queryRenderedFeatures({ layers: ['zulia-municipalities-border'] }).length,
        rtsSpritesCount: map.queryRenderedFeatures({ layers: ['tactical-rts-units-sprites'] }).length,
        sectorTerrainFillCount: map.queryRenderedFeatures({ layers: ['tactical-sector-terrain-fill'] }).length,
        sectorTerrainSpritesCount: map.getLayer('tactical-sector-terrain-webgl') ? 1 : 0,
      };
    });

    expect(tacticalMetrics.zoom).toBeCloseTo(15.5, 1);
    expect(tacticalMetrics.gridLinesCount).toBeGreaterThan(0);
    expect(tacticalMetrics.sectorTerrainFillCount, 'Estrato 3 debe renderizar geografía persistente de sector (tactical-sector-terrain-fill)').toBeGreaterThan(0);
    expect(tacticalMetrics.sectorTerrainSpritesCount, 'Estrato 3 debe renderizar sprites de terreno (tactical-sector-terrain-sprites)').toBeGreaterThan(0);
    expect(tacticalMetrics.rtsSpritesCount, 'Estrato 3 (Cabimas z=15.5) debe renderizar los sprites RTS verdes').toBeGreaterThanOrEqual(25);
    expect(tacticalMetrics.worldLandBorderCount).toBe(0);
    expect(tacticalMetrics.provincesFillCount).toBe(0);
    expect(tacticalMetrics.provincesBordersCount).toBe(0);
    expect(tacticalMetrics.tacticalBordersMeshCount).toBe(0);
    expect(tacticalMetrics.zuliaMunFillCount).toBe(0);
    expect(tacticalMetrics.zuliaMunBorderCount).toBe(0);

    await page.screenshot({ path: path.join(screenshotsDir, '11_tactical_grid_15_5.png'), fullPage: true });
    console.log('QA TOPOLOGY: Captura 11_tactical_grid_15_5.png registrada.');

    // --- AUDITORÍA DE RED, CONSOLA Y ZERO-RASTER ---
    console.log('QA TOPOLOGY [5/5]: Verificando 0 errores consola/red y 0 peticiones raster externas...');
    const fatalConsoleErrors = consoleErrors.filter(
      (e) =>
        !e.includes('AudioContext') &&
        !e.includes('audio device')
    );
    const externalTileRequests = requestedUrls.filter((u) => {
      if (u.startsWith('http://localhost') || u.startsWith('http://127.0.0.1')) return false;
      return /(cartodb|mapbox|openstreetmap|tile\.|arcgisonline|maptiler|stamen|thunderforest|\/tiles\/|\/\d+\/\d+\/\d+\.(png|jpg|jpeg|webp|pbf|mvt))/i.test(
        u
      );
    });

    expect(fatalConsoleErrors, `Errores de consola detectados: ${JSON.stringify(fatalConsoleErrors)}`).toHaveLength(0);
    expect(httpFailures, `Errores HTTP >= 400 detectados: ${JSON.stringify(httpFailures)}`).toHaveLength(0);
    expect(
      externalTileRequests,
      `Peticiones a servidores externos de tiles detectadas: ${JSON.stringify(externalTileRequests)}`
    ).toHaveLength(0);
    expect(requestedUrls.some((u) => u.includes('/map/theatre_borders_mesh.json'))).toBe(true);
    expect(requestedUrls.some((u) => u.includes('/map/theatre_regions.json'))).toBe(true);
    expect(requestedUrls.some((u) => u.includes('/map/zulia_municipalities.json'))).toBe(true);
    expect(requestedUrls.some((u) => u.includes('/map/world_land.json'))).toBe(true);
  });
});
