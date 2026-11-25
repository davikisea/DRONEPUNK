/**
 * ==============================================================================
 * EXPORTADOR STANDALONE DE PLANOS DE DISEÑO URBANO (ESTILO SPRITE-FORGE-STUDIO)
 * ==============================================================================
 * Herramienta de diagnóstico fuera del juego (NO modifica código de producción).
 * Compila las ciudades reales de DRONEPUNK (Maracaibo, Cabimas, San Francisco,
 * Puente Rafael Urdaneta + SATs) con el motor real y renderiza PNGs anotados
 * con sprites AWBW + zonas verdes de expansión, distritos, flechas amarillas,
 * pads cian de puentes, puertos futuros azules y badges SAT.
 *
 * Uso: npx tsx scripts/exportUrbanBlueprintMaps.ts
 * Salida: test-results/urban-blueprints/*.png
 * ==============================================================================
 */

import fs from 'fs';
import path from 'path';
import { chromium } from '@playwright/test';
import {
  clearGbaPipelineCache,
  generateGbaSectorBlueprint,
  isLandAtCabimasPolygon,
  registerLandPolygons,
} from '../src/domains/world/core/gbaMapPipeline';
import { registerYellowTrunkGeoJson } from '../src/domains/world/core/yellowTrunkBackboneIndex';
import {
  getAllUrbanAndSatSpecs,
  getOrCompileCityBlueprint,
  resetUrbanBlueprintCache,
} from '../src/domains/world/core/urbanSectorBridge';
import { getResolvedMacroBridges } from '../src/domains/world/core/macroBridgeCorridors';
import { URBAN_CELL_BIT_LOBE } from '../src/domains/world/types/urbanMorphologyTypes';

const TILE_PX = 16;
const GRID_SIZE = 20;
const EXPORT_ALL = process.argv.includes('--all');
const OUT_DIR = path.resolve(
  process.cwd(),
  EXPORT_ALL ? 'test-results/urban-blueprints/all-cities' : 'test-results/urban-blueprints'
);
const AWBW_ROOT = path.resolve(process.cwd(), 'public/assets/awbw/Map');

function loadSpriteDataUri(relPath: string): string | null {
  const full = path.join(AWBW_ROOT, relPath);
  if (!fs.existsSync(full)) return null;
  const buf = fs.readFileSync(full);
  return `data:image/png;base64,${buf.toString('base64')}`;
}

function buildSpriteAtlasMap(): Record<string, string> {
  const entries: Record<string, string> = {
    plains: 'Classic/Plain.png',
    forest: 'Classic/Wood.png',
    mountain: 'Classic/Mountain.png',
    sea: 'Classic/Sea/Sea.png',
    reef: 'Classic/Reef.png',
    shoal: 'Classic/Shoal/N-E-S-W.png',
    shoal_n: 'Classic/Shoal/N.png',
    shoal_s: 'Classic/Shoal/S.png',
    shoal_e: 'Classic/Shoal/E.png',
    shoal_w: 'Classic/Shoal/W.png',
    river_h: 'Classic/River/H.png',
    river_v: 'Classic/River/V.png',
    river_c: 'Classic/River/C.png',
    river_es: 'Classic/River/ES.png',
    river_sw: 'Classic/River/SW.png',
    river_wn: 'Classic/River/WN.png',
    river_ne: 'Classic/River/NE.png',
    river_nes: 'Classic/River/NES.png',
    river_esw: 'Classic/River/ESW.png',
    river_swn: 'Classic/River/SWN.png',
    river_wne: 'Classic/River/WNE.png',
    road_h: 'Classic/Road/H.png',
    road_v: 'Classic/Road/V.png',
    road_c: 'Classic/Road/C.png',
    road_es: 'Classic/Road/ES.png',
    road_sw: 'Classic/Road/SW.png',
    road_wn: 'Classic/Road/WN.png',
    road_ne: 'Classic/Road/NE.png',
    road_nes: 'Classic/Road/NES.png',
    road_esw: 'Classic/Road/ESW.png',
    road_swn: 'Classic/Road/SWN.png',
    road_wne: 'Classic/Road/WNE.png',
    bridge_h: 'Classic/Road/HBridge.png',
    bridge_v: 'Classic/Road/VBridge.png',
    hq: 'AW2/Neutral/HQ-0.png',
    city: 'AW2/Neutral/City-0.png',
    factory: 'AW2/Neutral/Base-0.png',
    airport: 'AW2/Neutral/Airport-0.png',
    port: 'AW2/Neutral/Port-0.png',
    commtower: 'AW2/Neutral/ComTower-0.png',
    lab: 'AW2/Neutral/Lab-0.png',
    silo: 'AW2/Neutral/Silo-0.png',
    usedSilo: 'Classic/Neutral/SiloEmpty-0.png',
  };
  const out: Record<string, string> = {};
  const missing: string[] = [];
  for (const [k, rel] of Object.entries(entries)) {
    const uri = loadSpriteDataUri(rel);
    if (uri) out[k] = uri;
    else missing.push(`${k} (${rel})`);
  }
  if (missing.length > 0) {
    throw new Error(`Faltan ${missing.length} sprites AWBW: ${missing.join(', ')}`);
  }
  console.log(`✅ Sprites AWBW verificados: ${Object.keys(out).length}/${Object.keys(entries).length} (0 faltantes)`);
  return out;
}

interface ExportScenePayload {
  title: string;
  fileName: string;
  minGx: number;
  minGy: number;
  wTiles: number;
  hTiles: number;
  tiles: string[]; // flat array of TerrainType (wTiles * hTiles)
  cities: Array<{
    id: string;
    name: string;
    scale: string;
    isSat: boolean;
    fillRatio: number;
    circleIoU: number;
    buildingCount: number;
    originX: number;
    originY: number;
    w: number;
    h: number;
    lobeMask: number[];
    expansionMask: number[];
    districtGrid: number[];
    districtLegend: Array<{ dIdx: number; tag: string; kind: 'functional' | 'residential'; archetype: string }>;
    functionalDistricts: Array<{ archetype: string; orientation: string; bbox: readonly [number, number, number, number] }>;
    residentialDistricts: Array<{ grain: string; bbox: readonly [number, number, number, number] }>;
    interchangeArrows: Array<{ gx: number; gy: number; dx: number; dy: number }>;
    futurePortPlots: Array<{ gx: number; gy: number; bbox: readonly [number, number, number, number] }>;
  }>;
  bridgeheads: Array<{ name: string; wx: number; wy: number; ex: number; ey: number }>;
}

function collectScene(
  title: string,
  fileName: string,
  centerGx: number,
  centerGy: number,
  wTiles: number,
  hTiles: number
): ExportScenePayload {
  const minGx = Math.floor(centerGx - wTiles / 2);
  const minGy = Math.floor(centerGy - hTiles / 2);
  const tiles: string[] = new Array(wTiles * hTiles).fill('plains');

  // Muestrear el terreno real desde gbaMapPipeline.ts (idéntico al juego)
  const sectorCache = new Map<string, ReturnType<typeof generateGbaSectorBlueprint>['matrix']>();
  for (let ly = 0; ly < hTiles; ly++) {
    const gy = minGy + ly;
    const sy = Math.floor(gy / GRID_SIZE);
    const localY = gy - sy * GRID_SIZE;
    for (let lx = 0; lx < wTiles; lx++) {
      const gx = minGx + lx;
      const sx = Math.floor(gx / GRID_SIZE);
      const localX = gx - sx * GRID_SIZE;
      const key = `${sx}_${sy}`;
      let mat = sectorCache.get(key);
      if (!mat) {
        mat = generateGbaSectorBlueprint([sx, sy], GRID_SIZE, false).matrix;
        sectorCache.set(key, mat);
      }
      tiles[ly * wTiles + lx] = mat[localY][localX].type;
    }
  }

  const allSpecs = getAllUrbanAndSatSpecs(isLandAtCabimasPolygon);
  const maxGx = minGx + wTiles - 1;
  const maxGy = minGy + hTiles - 1;
  const cities: ExportScenePayload['cities'] = [];

  for (const spec of allSpecs) {
    const half = Math.floor(spec.canvasSizeTiles / 2);
    const ox = spec.anchorGlobalX - half;
    const oy = spec.anchorGlobalY - half;
    if (ox + spec.canvasSizeTiles < minGx || ox > maxGx || oy + spec.canvasSizeTiles < minGy || oy > maxGy) {
      continue;
    }
    const bp = getOrCompileCityBlueprint(spec, isLandAtCabimasPolygon);
    const lobeMask: number[] = new Array(bp.width * bp.height);
    for (let i = 0; i < lobeMask.length; i++) {
      lobeMask[i] = (bp.cellFlags[i] & URBAN_CELL_BIT_LOBE) !== 0 ? 1 : 0;
    }
    const expansionMask: number[] = bp.expansionZoneMask
      ? Array.from(bp.expansionZoneMask)
      : [];

    cities.push({
      id: spec.cityId,
      name: spec.name,
      scale: spec.engineScale,
      isSat: Boolean(spec.isProceduralSat),
      fillRatio: bp.metrics.buildingCount / Math.max(1, bp.metrics.dryAreaTiles),
      circleIoU: bp.metrics.circleIoU ?? 0,
      buildingCount: bp.metrics.buildingCount,
      originX: bp.originGlobalX - minGx,
      originY: bp.originGlobalY - minGy,
      w: bp.width,
      h: bp.height,
      lobeMask,
      expansionMask,
      districtGrid: bp.districtGrid ? Array.from(bp.districtGrid) : [],
      districtLegend: (bp.districtLegend ?? []).map((d) => ({
        dIdx: d.dIdx,
        tag: d.tag,
        kind: d.kind,
        archetype: d.archetype,
      })),
      functionalDistricts: (bp.functionalDistricts ?? []).map((d) => ({
        archetype: d.archetype,
        orientation: d.orientation,
        bbox: d.bbox,
      })),
      residentialDistricts: (bp.residentialDistricts ?? []).map((r) => ({
        grain: r.grain,
        bbox: r.bbox,
      })),
      interchangeArrows: (bp.interchangeArrows ?? []).map((a) => ({
        gx: a.globalX - minGx,
        gy: a.globalY - minGy,
        dx: a.dx,
        dy: a.dy,
      })),
      futurePortPlots: (bp.futurePortPlots ?? []).map((fp) => ({
        gx: fp.coastGlobalX - minGx,
        gy: fp.coastGlobalY - minGy,
        bbox: [
          fp.dockBboxGlobal[0] - minGx,
          fp.dockBboxGlobal[1] - minGy,
          fp.dockBboxGlobal[2] - minGx,
          fp.dockBboxGlobal[3] - minGy,
        ] as const,
      })),
    });
  }

  const bridgeheads = getResolvedMacroBridges(isLandAtCabimasPolygon).map((br) => ({
    name: br.def.name,
    wx: br.westLandfall[0] - minGx,
    wy: br.westLandfall[1] - minGy,
    ex: br.eastLandfall[0] - minGx,
    ey: br.eastLandfall[1] - minGy,
  }));

  return { title, fileName, minGx, minGy, wTiles, hTiles, tiles, cities, bridgeheads };
}

async function main(): Promise<void> {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  // Hidratar cartografía real
  const zulia = JSON.parse(fs.readFileSync(path.resolve('public/map/zulia_municipalities.json'), 'utf-8'));
  const regions = JSON.parse(fs.readFileSync(path.resolve('public/map/theatre_regions.json'), 'utf-8'));
  const world = JSON.parse(fs.readFileSync(path.resolve('public/map/world_land.json'), 'utf-8'));
  registerLandPolygons(zulia, 'zulia_hd');
  registerLandPolygons(regions, 'theatre_regions');
  registerLandPolygons(world, 'world_land');
  clearGbaPipelineCache();
  resetUrbanBlueprintCache();
  registerYellowTrunkGeoJson(null, isLandAtCabimasPolygon);

  const allSpecs = getAllUrbanAndSatSpecs(isLandAtCabimasPolygon);
  const scenes: ExportScenePayload[] = [];
  const cityMetricsRows: Array<{
    idx: number;
    fileName: string;
    name: string;
    scale: string;
    population: number;
    buildings: number;
    fillRatio: number;
    circleIoU: number;
    districts: number;
    exits: number;
    hasWaterfront: boolean;
  }> = [];

  if (EXPORT_ALL) {
    const scaleRank: Record<string, number> = { x5: 5, x4: 4, x3: 3, x2: 2, x1: 1 };
    const windowByScale: Record<string, number> = { x5: 108, x4: 96, x3: 84, x2: 76, x1: 64 };
    const realCities = allSpecs
      .filter((s) => !s.isProceduralSat)
      .sort((a, b) => (scaleRank[b.engineScale] ?? 0) - (scaleRank[a.engineScale] ?? 0) || b.population - a.population);

    console.log(`🏙️  Generando planos v5 para las ${realCities.length} ciudades desplegadas...`);
    realCities.forEach((spec, idx) => {
      const bp = getOrCompileCityBlueprint(spec, isLandAtCabimasPolygon);
      const cx = bp.originGlobalX + Math.floor(bp.width / 2);
      const cy = bp.originGlobalY + Math.floor(bp.height / 2);
      const win = windowByScale[spec.engineScale] ?? 76;
      const slug = spec.name
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_|_$/g, '');
      const fileName = `${String(idx + 1).padStart(2, '0')}_${slug}_${spec.engineScale}.png`;
      scenes.push(
        collectScene(`${spec.name} (${spec.engineScale}) — Plan Urbano v5`, fileName, cx, cy, win, win)
      );
      cityMetricsRows.push({
        idx: idx + 1,
        fileName,
        name: spec.name,
        scale: spec.engineScale,
        population: spec.population,
        buildings: bp.metrics.buildingCount,
        fillRatio: bp.metrics.buildingCount / Math.max(1, bp.metrics.dryAreaTiles),
        circleIoU: bp.metrics.circleIoU ?? 0,
        districts: bp.districtLegend?.length ?? 0,
        exits: bp.interchangeArrows?.length ?? 0,
        hasWaterfront: (bp.functionalDistricts ?? []).some((d) => d.archetype === 'waterfront_port'),
      });
    });
  } else {
    const mcbo = allSpecs.find((s) => s.cityId === 'CITY_MARACAIBO')!;
    const cabimas = allSpecs.find((s) => s.cityId === 'CITY_CABIMAS')!;
    const sf = allSpecs.find((s) => s.cityId === 'CITY_SAN_FRANCISCO')!;
    const urdaneta = getResolvedMacroBridges(isLandAtCabimasPolygon)[0];
    scenes.push(
      collectScene('Maracaibo (x4) — Plan de Diseño Urbano v5', '01_maracaibo_v5.png', mcbo.anchorGlobalX, mcbo.anchorGlobalY, 92, 92),
      collectScene('Cabimas (x2) — Plan de Diseño Urbano v5', '02_cabimas_v5.png', cabimas.anchorGlobalX, cabimas.anchorGlobalY, 76, 76),
      collectScene('San Francisco (x3) + Cabecera Oeste Puente Urdaneta v5', '03_san_francisco_puente_v5.png', Math.round((sf.anchorGlobalX + urdaneta.westLandfall[0]) / 2), Math.round((sf.anchorGlobalY + urdaneta.westLandfall[1]) / 2), 96, 84)
    );
  }

  const sprites = buildSpriteAtlasMap();
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.addScriptTag({ content: 'window.__name = (fn) => fn;' });
  // Precargar los 43 sprites AWBW una sola vez en memoria del navegador
  await page.evaluate(async (spr) => {
    const imgs: Record<string, HTMLImageElement> = {};
    await Promise.all(
      Object.entries(spr).map(
        ([k, uri]) =>
          new Promise<void>((res) => {
            const img = new Image();
            img.onload = () => {
              imgs[k] = img;
              res();
            };
            img.onerror = () => res();
            img.src = uri;
          })
      )
    );
    (window as unknown as Record<string, unknown>).__AWBW_IMGS__ = imgs;
  }, sprites);

  for (const scene of scenes) {
    const pngBase64 = await page.evaluate(
      async ({ sc, tilePx }) => {
        const imgs = (window as unknown as Record<string, Record<string, HTMLImageElement>>).__AWBW_IMGS__;

        const W = sc.wTiles * tilePx;
        const H = sc.hTiles * tilePx;
        const canvas = document.createElement('canvas');
        canvas.width = W;
        canvas.height = H;
        const ctx = canvas.getContext('2d')!;
        ctx.imageSmoothingEnabled = false;

        const isRoadLike = (x: number, y: number): boolean => {
          if (x < 0 || x >= sc.wTiles || y < 0 || y >= sc.hTiles) return false;
          const t = sc.tiles[y * sc.wTiles + x];
          return t === 'road' || t === 'bridge';
        };

        const resolveRoadKey = (x: number, y: number): string => {
          const n = isRoadLike(x, y - 1);
          const e = isRoadLike(x + 1, y);
          const s = isRoadLike(x, y + 1);
          const w = isRoadLike(x - 1, y);
          const cnt = (n ? 1 : 0) + (e ? 1 : 0) + (s ? 1 : 0) + (w ? 1 : 0);
          if (cnt >= 4) return 'road_c';
          if (cnt === 3) {
            if (!w) return 'road_nes';
            if (!n) return 'road_esw';
            if (!e) return 'road_swn';
            return 'road_wne';
          }
          if (n && e) return 'road_ne';
          if (e && s) return 'road_es';
          if (s && w) return 'road_sw';
          if (w && n) return 'road_wn';
          if (n || s) return 'road_v';
          return 'road_h';
        };

        const isRiverLike = (x: number, y: number): boolean => {
          if (x < 0 || x >= sc.wTiles || y < 0 || y >= sc.hTiles) return false;
          const t = sc.tiles[y * sc.wTiles + x];
          return t === 'river' || t === 'sea' || t === 'shoal' || t === 'bridge';
        };

        const resolveRiverKey = (x: number, y: number): string => {
          const n = isRiverLike(x, y - 1);
          const e = isRiverLike(x + 1, y);
          const s = isRiverLike(x, y + 1);
          const w = isRiverLike(x - 1, y);
          const cnt = (n ? 1 : 0) + (e ? 1 : 0) + (s ? 1 : 0) + (w ? 1 : 0);
          if (cnt >= 4) return 'river_c';
          if (cnt === 3) {
            if (!w) return 'river_nes';
            if (!n) return 'river_esw';
            if (!e) return 'river_swn';
            return 'river_wne';
          }
          if (n && e) return 'river_ne';
          if (e && s) return 'river_es';
          if (s && w) return 'river_sw';
          if (w && n) return 'river_wn';
          if (n || s) return 'river_v';
          return 'river_h';
        };

        // 1. Pintar mapa base AWBW (100% sprites completos: mar, costa, ríos, carreteras, puentes, bosques, montañas)
        const bldgSet = new Set(['hq', 'city', 'factory', 'airport', 'port', 'commtower', 'lab', 'silo', 'usedSilo']);
        for (let y = 0; y < sc.hTiles; y++) {
          for (let x = 0; x < sc.wTiles; x++) {
            const t = sc.tiles[y * sc.wTiles + x];
            const px = x * tilePx;
            const py = y * tilePx;
            const baseKey = t === 'sea' || t === 'reef' || t === 'shoal' ? t : 'plains';
            if (imgs[baseKey]) ctx.drawImage(imgs[baseKey], px, py, tilePx, tilePx);
            if (t === 'river') {
              const rvk = resolveRiverKey(x, y);
              if (imgs[rvk]) ctx.drawImage(imgs[rvk], px, py, tilePx, tilePx);
            } else if (t === 'road') {
              const rk = resolveRoadKey(x, y);
              if (imgs[rk]) ctx.drawImage(imgs[rk], px, py, tilePx, tilePx);
            } else if (t === 'bridge') {
              if (imgs.sea) ctx.drawImage(imgs.sea, px, py, tilePx, tilePx);
              const bk = isRoadLike(x - 1, y) || isRoadLike(x + 1, y) ? 'bridge_h' : 'bridge_v';
              if (imgs[bk]) ctx.drawImage(imgs[bk], px, py, tilePx, tilePx);
            } else if (t === 'forest' && imgs.forest) {
              ctx.drawImage(imgs.forest, px, py - 4, tilePx, tilePx + 4);
            } else if (t === 'mountain' && imgs.mountain) {
              ctx.drawImage(imgs.mountain, px, py - 4, tilePx, tilePx + 4);
            }
          }
        }
        // Edificios ordenados top-to-bottom para overhang limpio
        for (let y = 0; y < sc.hTiles; y++) {
          for (let x = 0; x < sc.wTiles; x++) {
            const t = sc.tiles[y * sc.wTiles + x];
            if (!bldgSet.has(t) || !imgs[t]) continue;
            const img = imgs[t];
            const drawH = Math.round((img.height / img.width) * tilePx);
            ctx.drawImage(img, x * tilePx, y * tilePx + (tilePx - drawH), tilePx, drawH);
          }
        }

        // Atenuación suave estilo render_buildable_overlay para máximo contraste
        ctx.fillStyle = 'rgba(10, 15, 22, 0.22)';
        ctx.fillRect(0, 0, W, H);

        const traceMaskPerim = (mask: number[], mw: number, mh: number, ox: number, oy: number, color: string, lw: number) => {
          ctx.strokeStyle = color;
          ctx.lineWidth = lw;
          ctx.beginPath();
          for (let y = 0; y < mh; y++) {
            for (let x = 0; x < mw; x++) {
              if (!mask[y * mw + x]) continue;
              const px = (ox + x) * tilePx;
              const py = (oy + y) * tilePx;
              if (y === 0 || !mask[(y - 1) * mw + x]) { ctx.moveTo(px, py); ctx.lineTo(px + tilePx, py); }
              if (y === mh - 1 || !mask[(y + 1) * mw + x]) { ctx.moveTo(px, py + tilePx); ctx.lineTo(px + tilePx, py + tilePx); }
              if (x === 0 || !mask[y * mw + x - 1]) { ctx.moveTo(px, py); ctx.lineTo(px, py + tilePx); }
              if (x === mw - 1 || !mask[y * mw + x + 1]) { ctx.moveTo(px + tilePx, py); ctx.lineTo(px + tilePx, py + tilePx); }
            }
          }
          ctx.stroke();
        };

        const drawPill = (x: number, y: number, text: string, border: string, textColor = '#F8FAFC') => {
          ctx.font = 'bold 11px ui-monospace, Consolas, monospace';
          const tw = Math.ceil(ctx.measureText(text).width);
          const bw = tw + 10;
          const bh = 16;
          const bx = Math.max(2, Math.min(W - bw - 2, x));
          const by = Math.max(2, Math.min(H - bh - 2, y));
          ctx.fillStyle = 'rgba(15, 23, 42, 0.90)';
          ctx.fillRect(bx, by, bw, bh);
          ctx.strokeStyle = border;
          ctx.lineWidth = 1.2;
          ctx.strokeRect(bx, by, bw, bh);
          ctx.fillStyle = textColor;
          ctx.fillText(text, bx + 5, by + 12);
        };

        // 2. Zonas verdes de expansión (#2ECC71)
        for (const c of sc.cities) {
          if (c.expansionMask.length === c.w * c.h) {
            ctx.fillStyle = 'rgba(46, 204, 113, 0.36)';
            for (let y = 0; y < c.h; y++) {
              for (let x = 0; x < c.w; x++) {
                if (c.expansionMask[y * c.w + x]) {
                  ctx.fillRect((c.originX + x) * tilePx, (c.originY + y) * tilePx, tilePx, tilePx);
                }
              }
            }
            traceMaskPerim(c.expansionMask, c.w, c.h, c.originX, c.originY, 'rgba(46, 204, 113, 0.95)', 2);
          }
        }

        // 3. Contornos blancos (#FFFFFF) + distritos (#E2E8F0) + flechas amarillas (#FFD646) + puertos azules (#3B82F6)
        for (const c of sc.cities) {
          traceMaskPerim(c.lobeMask, c.w, c.h, c.originX, c.originY, c.isSat ? '#94A3B8' : '#FFFFFF', c.isSat ? 2 : 3);

          // Distritos exclusivos (districtGrid: 0 solapamiento, contornos orgánicos exactos)
          if (c.districtGrid.length === c.w * c.h && c.districtLegend.length > 0) {
            for (const entry of c.districtLegend) {
              const dMask = new Array<number>(c.w * c.h).fill(0);
              let minDy = c.h;
              let minDx = c.w;
              let cnt = 0;
              for (let y = 0; y < c.h; y++) {
                for (let x = 0; x < c.w; x++) {
                  const idx = y * c.w + x;
                  if (c.districtGrid[idx] === entry.dIdx) {
                    dMask[idx] = 1;
                    cnt++;
                    if (y < minDy || (y === minDy && x < minDx)) {
                      minDy = y;
                      minDx = x;
                    }
                  }
                }
              }
              if (cnt === 0) continue;
              const isFunc = entry.kind === 'functional';
              traceMaskPerim(
                dMask,
                c.w,
                c.h,
                c.originX,
                c.originY,
                isFunc ? 'rgba(226, 232, 240, 0.94)' : 'rgba(226, 232, 240, 0.58)',
                isFunc ? 2 : 1.5
              );
              drawPill(
                (c.originX + minDx) * tilePx,
                (c.originY + minDy) * tilePx - (isFunc ? 14 : 12),
                entry.tag,
                isFunc ? '#E2E8F0' : '#CBD5E1'
              );
            }
          } else {
            // Fallback legacy si districtGrid no está poblado
            for (const d of c.functionalDistricts) {
              const [x0, y0, x1, y1] = d.bbox;
              ctx.strokeStyle = 'rgba(226, 232, 240, 0.92)';
              ctx.lineWidth = 2;
              ctx.strokeRect((c.originX + x0) * tilePx, (c.originY + y0) * tilePx, (x1 - x0 + 1) * tilePx, (y1 - y0 + 1) * tilePx);
              drawPill((c.originX + x0) * tilePx, (c.originY + y0) * tilePx - 14, `${d.archetype.toUpperCase().slice(0, 9)} [${d.orientation.toLowerCase().slice(0, 6)}]`, '#E2E8F0');
            }
            for (const r of c.residentialDistricts) {
              const [x0, y0, x1, y1] = r.bbox;
              ctx.strokeStyle = 'rgba(226, 232, 240, 0.65)';
              ctx.lineWidth = 1.5;
              ctx.strokeRect((c.originX + x0) * tilePx, (c.originY + y0) * tilePx, (x1 - x0 + 1) * tilePx, (y1 - y0 + 1) * tilePx);
              drawPill((c.originX + x0) * tilePx, (c.originY + y0) * tilePx - 12, `RESIDENTI [${r.grain.slice(0, 6)}]`, '#CBD5E1');
            }
          }

          // Flechas amarillas de intercambio (#FFD646)
          for (const a of c.interchangeArrows) {
            const cxp = a.gx * tilePx + tilePx / 2;
            const cyp = a.gy * tilePx + tilePx / 2;
            const tipX = cxp + a.dx * 28;
            const tipY = cyp + a.dy * 28;
            const lx = -a.dy;
            const ly = a.dx;
            ctx.strokeStyle = '#FFD646';
            ctx.lineWidth = 4;
            ctx.beginPath();
            ctx.moveTo(cxp, cyp);
            ctx.lineTo(tipX, tipY);
            ctx.stroke();
            ctx.fillStyle = '#FFD646';
            ctx.beginPath();
            ctx.moveTo(tipX + a.dx * 6, tipY + a.dy * 6);
            ctx.lineTo(tipX - a.dx * 6 + lx * 8, tipY - a.dy * 6 + ly * 8);
            ctx.lineTo(tipX - a.dx * 6 - lx * 8, tipY - a.dy * 6 - ly * 8);
            ctx.closePath();
            ctx.fill();
            ctx.beginPath();
            ctx.moveTo(cxp, cyp - 5);
            ctx.lineTo(cxp + 5, cyp);
            ctx.lineTo(cxp, cyp + 5);
            ctx.lineTo(cxp - 5, cyp);
            ctx.closePath();
            ctx.fill();
          }

          // Lotes azules de puertos futuros (#3B82F6)
          for (const fp of c.futurePortPlots) {
            const [x0, y0, x1, y1] = fp.bbox;
            ctx.fillStyle = 'rgba(37, 99, 235, 0.30)';
            ctx.fillRect(x0 * tilePx, y0 * tilePx, (x1 - x0 + 1) * tilePx, (y1 - y0 + 1) * tilePx);
            ctx.strokeStyle = '#3B82F6';
            ctx.lineWidth = 3;
            ctx.strokeRect(x0 * tilePx, y0 * tilePx, (x1 - x0 + 1) * tilePx, (y1 - y0 + 1) * tilePx);
          }

          // Cabecera de ciudad / SAT
          let minLy = c.h;
          let minLx = c.w;
          for (let y = 0; y < c.h; y++) {
            for (let x = 0; x < c.w; x++) {
              if (c.lobeMask[y * c.w + x]) {
                if (y < minLy) { minLy = y; minLx = x; }
              }
            }
          }
          if (minLy < c.h) {
            const hdr = c.isSat
              ? c.name
              : `${c.name} [${c.scale} | fill=${c.fillRatio.toFixed(2)} | IoU=${c.circleIoU.toFixed(2)}]`;
            drawPill((c.originX + minLx) * tilePx, (c.originY + minLy) * tilePx - 22, hdr, c.isSat ? '#94A3B8' : '#FFFFFF');
          }
        }

        // 4. Pads cian de cabeceras de puente (#38BDF8): Macro-puentes + puentes fluviales automáticos
        ctx.strokeStyle = '#38BDF8';
        ctx.lineWidth = 3;
        for (const bh of sc.bridgeheads) {
          ctx.strokeRect((bh.wx - 1) * tilePx, (bh.wy - 1) * tilePx, 3 * tilePx, 3 * tilePx);
          ctx.strokeRect((bh.ex - 1) * tilePx, (bh.ey - 1) * tilePx, 3 * tilePx, 3 * tilePx);
        }
        // Detección de cruces fluviales (puentes adyacentes a río)
        const drawnRiverPads = new Set<string>();
        for (let y = 1; y < sc.hTiles - 1; y++) {
          for (let x = 1; x < sc.wTiles - 1; x++) {
            if (sc.tiles[y * sc.wTiles + x] !== 'bridge') continue;
            const nearRiver =
              sc.tiles[(y - 1) * sc.wTiles + x] === 'river' ||
              sc.tiles[(y + 1) * sc.wTiles + x] === 'river' ||
              sc.tiles[y * sc.wTiles + (x - 1)] === 'river' ||
              sc.tiles[y * sc.wTiles + (x + 1)] === 'river';
            if (!nearRiver) continue;
            const bucket = `${Math.floor(x / 4)}_${Math.floor(y / 4)}`;
            if (drawnRiverPads.has(bucket)) continue;
            drawnRiverPads.add(bucket);
            ctx.strokeRect((x - 1) * tilePx, (y - 1) * tilePx, 3 * tilePx, 3 * tilePx);
          }
        }

        // 5. Leyenda superior derecha (estilo SPRITE-FORGE-STUDIO)
        const legW = 280;
        const legH = 128;
        const legX = W - legW - 14;
        const legY = 14;
        ctx.fillStyle = 'rgba(15, 23, 42, 0.92)';
        ctx.fillRect(legX, legY, legW, legH);
        ctx.strokeStyle = '#64748B';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(legX, legY, legW, legH);
        ctx.font = 'bold 11px ui-monospace, Consolas, monospace';
        ctx.fillStyle = '#F8FAFC';
        ctx.fillText(sc.title.slice(0, 36), legX + 10, legY + 18);
        const legendItems: Array<[string, string]> = [
          ['#FFFFFF', 'Core City Contour (beltway_real)'],
          ['#E2E8F0', 'Functional & Residential Districts'],
          ['#2ECC71', 'Contiguous Expansion Zones (>=3x3)'],
          ['#FFD646', 'Multi-Directional Interchanges'],
          ['#38BDF8', 'Bridgehead Pads (Puente Urdaneta)'],
          ['#3B82F6', 'Future Port Plots / Maritime SATs'],
        ];
        legendItems.forEach(([col, lbl], idx) => {
          const iy = legY + 34 + idx * 15;
          ctx.fillStyle = col;
          ctx.fillRect(legX + 10, iy - 8, 10, 10);
          ctx.fillStyle = '#E2E8F0';
          ctx.font = '10px ui-monospace, Consolas, monospace';
          ctx.fillText(lbl, legX + 26, iy + 1);
        });

        return canvas.toDataURL('image/png').replace(/^data:image\/png;base64,/, '');
      },
      { sc: scene, tilePx: TILE_PX }
    );

    const outPath = path.join(OUT_DIR, scene.fileName);
    fs.writeFileSync(outPath, Buffer.from(pngBase64, 'base64'));
    console.log(`✅ Exportado: ${outPath} (${scene.wTiles}x${scene.hTiles} tiles)`);
  }

  if (EXPORT_ALL && cityMetricsRows.length > 0) {
    const cards = cityMetricsRows
      .map(
        (r) => `<div class="card">
  <a href="./${r.fileName}" target="_blank"><img src="./${r.fileName}" loading="lazy" alt="${r.name}"/></a>
  <div class="meta">
    <strong>${String(r.idx).padStart(2, '0')}. ${r.name} [${r.scale}]</strong>
    <span>Pob: ${r.population.toLocaleString('es-VE')} • ${r.buildings} edif • fill=${r.fillRatio.toFixed(2)} • IoU=${r.circleIoU.toFixed(2)} • ${r.districts} distritos • ${r.exits} salidas${r.hasWaterfront ? ' • ⚓ Puerto' : ''}</span>
  </div>
</div>`
      )
      .join('\n');
    const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"/><title>DRONEPUNK — Blueprints Urbanos v5 (${cityMetricsRows.length} Ciudades)</title>
<style>body{margin:0;padding:20px;background:#0b1120;color:#e2e8f0;font-family:ui-monospace,Consolas,monospace}h1{margin:0 0 16px;font-size:18px}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(420px,1fr));gap:16px}.card{background:#111827;border:1px solid #334155;border-radius:6px;overflow:hidden}.card img{width:100%;display:block;image-rendering:pixelated}.meta{padding:10px 12px;display:flex;flex-direction:column;gap:4px;font-size:12px}.meta span{color:#94a3b8;font-size:11px}</style>
</head><body><h1>DRONEPUNK — Blueprints de Diseño Urbano v5 (${cityMetricsRows.length} Ciudades Desplegadas)</h1><div class="grid">${cards}</div></body></html>`;
    const indexPath = path.join(OUT_DIR, 'index.html');
    fs.writeFileSync(indexPath, html, 'utf-8');
    console.log(`🖼️  Galería HTML generada: ${indexPath}`);
  }

  await browser.close();
  console.log('\n🎉 Todos los planos de diseño urbano exportados con éxito.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
