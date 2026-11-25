/**
 * ==============================================================================
 * GENERADOR GEOJSON ZERO-RASTER DEL PLAN DE DISEÑO URBANO (SPRITE-FORGE OVERLAY)
 * ==============================================================================
 * Replica al 100 % render_buildable_overlay (09_city_world_engine.py L6978-7138)
 * en WebGL MapLibre GL v6 sin style.glyphs ni tiles raster externos:
 * - Zonas verdes contiguas de expansión (#2ECC71, fill + contorno)
 * - Contorno blanco de silueta urbana (#FFFFFF, 3px) + cabecera ciudad
 * - Cajas de distritos funcionales y residenciales (#E2E8F0) + badges HiDPI Canvas2D
 *   (CIVIC_COR, AIR_HUB, WATERFRON, INDUSTRIA, SCIENCE_C, RESIDENTI [grain], SAT)
 * - Flechas amarillas de intercambio multi-direccional (#FFD646)
 * - Pads cian de cabeceras de puente (#38BDF8) y lotes azules de puertos futuros (#3B82F6)
 * ==============================================================================
 */

import type { Map as MapLibreMap } from 'maplibre-gl';
import {
  tileFractionToLngLat,
  ZOOM_TACTICO,
} from '../../core/coordinates';
import { getResolvedMacroBridges } from '../../core/macroBridgeCorridors';
import {
  getAllUrbanAndSatSpecs,
  getOrCompileCityBlueprint,
} from '../../core/urbanSectorBridge';
import {
  URBAN_CELL_BIT_LOBE,
  type UrbanCityBlueprint,
} from '../../types/urbanMorphologyTypes';

const GRID_SIZE = 20;

export const URBAN_BLUEPRINT_MIN_ZOOM = 11.5;
export const URBAN_BLUEPRINT_SOURCE_ID = 'urban-blueprint-overlay';
export const URBAN_BLUEPRINT_LAYER_IDS = [
  'urban-blueprint-expansion-fill',
  'urban-blueprint-expansion-line',
  'urban-blueprint-district-fill',
  'urban-blueprint-district-line',
  'urban-blueprint-silhouette-line',
  'urban-blueprint-bridgehead-fill',
  'urban-blueprint-bridgehead-line',
  'urban-blueprint-arrow-shaft',
  'urban-blueprint-arrow-head',
  'urban-blueprint-future-port-fill',
  'urban-blueprint-future-port-line',
  'urban-blueprint-labels',
] as const;

const DISTRICT_COLORS: Readonly<Record<string, { border: string; fill: string }>> = {
  civic_core: { border: '#F59E0B', fill: '#F59E0B' },
  air_hub: { border: '#38BDF8', fill: '#38BDF8' },
  waterfront_port: { border: '#06B6D4', fill: '#06B6D4' },
  industrial_logistics_park: { border: '#FB923C', fill: '#FB923C' },
  science_campus: { border: '#A78BFA', fill: '#A78BFA' },
  residential: { border: '#E2E8F0', fill: '#E2E8F0' },
  sat: { border: '#94A3B8', fill: '#94A3B8' },
};

function cellCornerLngLat(gx: number, gy: number): [number, number] {
  return tileFractionToLngLat(gx / GRID_SIZE, gy / GRID_SIZE, ZOOM_TACTICO);
}

function rectPolygonCoords(gx0: number, gy0: number, gx1Excl: number, gy1Excl: number): [number, number][][] {
  const tl = cellCornerLngLat(gx0, gy0);
  const tr = cellCornerLngLat(gx1Excl, gy0);
  const br = cellCornerLngLat(gx1Excl, gy1Excl);
  const bl = cellCornerLngLat(gx0, gy1Excl);
  return [[tl, tr, br, bl, tl]];
}

/**
 * Extrae las aristas ortogonales del perímetro de una máscara binaria
 * como segmentos MultiLineString (equivalente exacto a _trace_mask_perimeter L6978-7009).
 */
function traceMaskPerimeterSegments(
  mask: Uint8Array,
  w: number,
  h: number,
  originGx: number,
  originGy: number
): Array<[[number, number], [number, number]]> {
  const segs: Array<[[number, number], [number, number]]> = [];
  for (let y = 0; y < h; y++) {
    const r = y * w;
    for (let x = 0; x < w; x++) {
      if (!mask[r + x]) continue;
      const gx = originGx + x;
      const gy = originGy + y;
      // Top edge
      if (y === 0 || !mask[(y - 1) * w + x]) {
        segs.push([cellCornerLngLat(gx, gy), cellCornerLngLat(gx + 1, gy)]);
      }
      // Bottom edge
      if (y === h - 1 || !mask[(y + 1) * w + x]) {
        segs.push([cellCornerLngLat(gx, gy + 1), cellCornerLngLat(gx + 1, gy + 1)]);
      }
      // Left edge
      if (x === 0 || !mask[r + x - 1]) {
        segs.push([cellCornerLngLat(gx, gy), cellCornerLngLat(gx, gy + 1)]);
      }
      // Right edge
      if (x === w - 1 || !mask[r + x + 1]) {
        segs.push([cellCornerLngLat(gx + 1, gy), cellCornerLngLat(gx + 1, gy + 1)]);
      }
    }
  }
  return segs;
}

/**
 * Convierte una máscara de expansión en polígonos rectangulares horizontales (run-length)
 * para render WebGL ultra-rápido sin cientos de tiles sueltos.
 */
function maskToRunLengthPolygons(
  mask: Uint8Array,
  w: number,
  h: number,
  originGx: number,
  originGy: number
): [number, number][][][] {
  const polys: [number, number][][][] = [];
  for (let y = 0; y < h; y++) {
    const r = y * w;
    let x = 0;
    while (x < w) {
      if (!mask[r + x]) {
        x++;
        continue;
      }
      const x0 = x;
      while (x < w && mask[r + x]) x++;
      polys.push(rectPolygonCoords(originGx + x0, originGy + y, originGx + x, originGy + y + 1));
    }
  }
  return polys;
}

/**
 * Registra un badge de etiqueta HiDPI (Canvas2D -> map.addImage) 100% Zero-Raster / Zero-HTTP.
 */
export function ensureBlueprintBadgeSprite(
  map: MapLibreMap,
  registeredSet: Set<string>,
  spriteId: string,
  text: string,
  borderColor: string,
  textColor: string = '#F8FAFC'
): void {
  if (registeredSet.has(spriteId) || map.hasImage(spriteId)) {
    registeredSet.add(spriteId);
    return;
  }
  if (typeof document === 'undefined') return;
  const scale = 2;
  const fontSize = 11;
  const padX = 7;
  const height = 20;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  ctx.font = `700 ${fontSize}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
  const textW = Math.ceil(ctx.measureText(text).width);
  const width = Math.max(44, textW + padX * 2);

  canvas.width = width * scale;
  canvas.height = height * scale;
  ctx.scale(scale, scale);

  // Fondo oscuro #0F172A (igual a 09_city_world_engine.py)
  ctx.fillStyle = 'rgba(15, 23, 42, 0.90)';
  ctx.strokeStyle = borderColor;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(0.75, 0.75, width - 1.5, height - 1.5, 3);
  ctx.fill();
  ctx.stroke();

  ctx.font = `700 ${fontSize}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
  ctx.fillStyle = textColor;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  ctx.fillText(text, width / 2, height / 2 + 0.5);

  const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  try {
    map.addImage(spriteId, {
      width: canvas.width,
      height: canvas.height,
      data: imgData.data,
    }, { pixelRatio: scale });
    registeredSet.add(spriteId);
  } catch {
    // Evitar colisiones si se registró en paralelo
  }
}

interface PendingBadge {
  readonly spriteId: string;
  readonly text: string;
  readonly borderColor: string;
  readonly textColor: string;
}

const perCityFeatureCache = new Map<string, { features: GeoJSON.Feature[]; badges: PendingBadge[] }>();

export function clearUrbanBlueprintFeatureCache(): void {
  perCityFeatureCache.clear();
}

function buildFeaturesForBlueprint(bp: UrbanCityBlueprint): {
  features: GeoJSON.Feature[];
  badges: PendingBadge[];
} {
  const features: GeoJSON.Feature[] = [];
  const badges: PendingBadge[] = [];
  const { width, height, originGlobalX, originGlobalY, spec } = bp;
  const isSat = Boolean(spec.isProceduralSat);

  // 1. Zonas verdes contiguas de expansión periurbana (#2ECC71)
  if (bp.expansionZoneMask) {
    const expPolys = maskToRunLengthPolygons(bp.expansionZoneMask, width, height, originGlobalX, originGlobalY);
    if (expPolys.length > 0) {
      features.push({
        type: 'Feature',
        properties: { kind: 'expansion_zone', cityId: spec.cityId },
        geometry: { type: 'MultiPolygon', coordinates: expPolys },
      });
    }
    const expSegs = traceMaskPerimeterSegments(bp.expansionZoneMask, width, height, originGlobalX, originGlobalY);
    if (expSegs.length > 0) {
      features.push({
        type: 'Feature',
        properties: { kind: 'expansion_zone_line', cityId: spec.cityId },
        geometry: { type: 'MultiLineString', coordinates: expSegs },
      });
    }
  }

  // 2. Contorno blanco de silueta urbana (#FFFFFF) o slate (#94A3B8) para SAT
  const lobeMask = new Uint8Array(width * height);
  let minLx = width;
  let maxLx = -1;
  let minLy = height;
  let maxLy = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if ((bp.cellFlags[y * width + x] & URBAN_CELL_BIT_LOBE) !== 0) {
        lobeMask[y * width + x] = 1;
        if (x < minLx) minLx = x;
        if (x > maxLx) maxLx = x;
        if (y < minLy) minLy = y;
        if (y > maxLy) maxLy = y;
      }
    }
  }
  const silSegs = traceMaskPerimeterSegments(lobeMask, width, height, originGlobalX, originGlobalY);
  if (silSegs.length > 0) {
    features.push({
      type: 'Feature',
      properties: {
        kind: 'city_silhouette',
        cityId: spec.cityId,
        strokeColor: isSat ? '#94A3B8' : '#FFFFFF',
        strokeWidth: isSat ? 2.0 : 2.8,
      },
      geometry: { type: 'MultiLineString', coordinates: silSegs },
    });
  }

  // Badge de cabecera de ciudad o SAT
  if (maxLx >= minLx && maxLy >= minLy) {
    const fillRatio = (bp.metrics.buildingCount / Math.max(1, bp.metrics.dryAreaTiles)).toFixed(2);
    const headerText = isSat
      ? `${spec.name}`
      : `${spec.name} [${spec.engineScale} | fill=${fillRatio} | ${bp.metrics.buildingCount} edif]`;
    const spriteId = `bp_hdr_${spec.cityId}`;
    badges.push({
      spriteId,
      text: headerText,
      borderColor: isSat ? '#94A3B8' : '#FFFFFF',
      textColor: isSat ? '#E2E8F0' : '#FFFFFF',
    });
    features.push({
      type: 'Feature',
      properties: { kind: 'blueprint_label', badgeSpriteId: spriteId, priority: isSat ? 2 : 1 },
      geometry: {
        type: 'Point',
        coordinates: cellCornerLngLat(originGlobalX + (minLx + maxLx) * 0.5, originGlobalY + minLy - 0.8),
      },
    });
  }

  // 3. Distritos Funcionales (CIVIC_COR, AIR_HUB, WATERFRON, INDUSTRIA, SCIENCE_C)
  if (bp.functionalDistricts) {
    for (const d of bp.functionalDistricts) {
      const [x0, y0, x1, y1] = d.bbox;
      const pal = DISTRICT_COLORS[d.archetype] ?? DISTRICT_COLORS.residential;
      features.push({
        type: 'Feature',
        properties: {
          kind: 'district_box',
          cityId: spec.cityId,
          borderColor: pal.border,
          fillColor: pal.fill,
        },
        geometry: {
          type: 'Polygon',
          coordinates: rectPolygonCoords(originGlobalX + x0, originGlobalY + y0, originGlobalX + x1 + 1, originGlobalY + y1 + 1),
        },
      });
      const tag = `${d.archetype.toUpperCase().slice(0, 9)} [${d.orientation.toLowerCase().slice(0, 6)}]`;
      const spriteId = `bp_d_${d.id}`;
      badges.push({ spriteId, text: tag, borderColor: pal.border, textColor: '#F8FAFC' });
      features.push({
        type: 'Feature',
        properties: { kind: 'blueprint_label', badgeSpriteId: spriteId, priority: 3 },
        geometry: {
          type: 'Point',
          coordinates: cellCornerLngLat(originGlobalX + (x0 + x1 + 1) * 0.5, originGlobalY + y0),
        },
      });
    }
  }

  // 4. Distritos Residenciales Polimórficos (RESIDENTI [ns_bar], [curved], [superb], etc.)
  if (bp.residentialDistricts) {
    for (const rd of bp.residentialDistricts) {
      const [x0, y0, x1, y1] = rd.bbox;
      const pal = DISTRICT_COLORS.residential;
      features.push({
        type: 'Feature',
        properties: {
          kind: 'district_box',
          cityId: spec.cityId,
          borderColor: pal.border,
          fillColor: pal.fill,
        },
        geometry: {
          type: 'Polygon',
          coordinates: rectPolygonCoords(originGlobalX + x0, originGlobalY + y0, originGlobalX + x1 + 1, originGlobalY + y1 + 1),
        },
      });
      const tag = `RESIDENTI [${rd.grain.slice(0, 6)}]`;
      const spriteId = `bp_r_${spec.cityId}_${rd.id}`;
      badges.push({ spriteId, text: tag, borderColor: '#E2E8F0', textColor: '#F8FAFC' });
      features.push({
        type: 'Feature',
        properties: { kind: 'blueprint_label', badgeSpriteId: spriteId, priority: 4 },
        geometry: {
          type: 'Point',
          coordinates: cellCornerLngLat(originGlobalX + (x0 + x1 + 1) * 0.5, originGlobalY + y0),
        },
      });
    }
  }

  // 5. Flechas amarillas de intercambio multi-direccional (#FFD646)
  if (bp.interchangeArrows) {
    for (const arr of bp.interchangeArrows) {
      const cx = arr.globalX + 0.5;
      const cy = arr.globalY + 0.5;
      const tipX = cx + arr.dx * 2.2;
      const tipY = cy + arr.dy * 2.2;
      const lx = -arr.dy;
      const ly = arr.dx;
      features.push({
        type: 'Feature',
        properties: { kind: 'interchange_arrow_shaft', cityId: spec.cityId },
        geometry: {
          type: 'LineString',
          coordinates: [cellCornerLngLat(cx, cy), cellCornerLngLat(tipX, tipY)],
        },
      });
      const pTip = cellCornerLngLat(tipX + arr.dx * 0.55, tipY + arr.dy * 0.55);
      const pL = cellCornerLngLat(tipX - arr.dx * 0.35 + lx * 0.55, tipY - arr.dy * 0.35 + ly * 0.55);
      const pR = cellCornerLngLat(tipX - arr.dx * 0.35 - lx * 0.55, tipY - arr.dy * 0.35 - ly * 0.55);
      features.push({
        type: 'Feature',
        properties: { kind: 'interchange_arrow_head', cityId: spec.cityId },
        geometry: { type: 'Polygon', coordinates: [[pTip, pL, pR, pTip]] },
      });
    }
  }

  // 6. Lotes azules de puertos futuros (#3B82F6)
  if (bp.futurePortPlots) {
    for (const fp of bp.futurePortPlots) {
      const [gx0, gy0, gx1, gy1] = fp.dockBboxGlobal;
      features.push({
        type: 'Feature',
        properties: { kind: 'future_port_box', cityId: spec.cityId },
        geometry: {
          type: 'Polygon',
          coordinates: rectPolygonCoords(gx0, gy0, gx1 + 1, gy1 + 1),
        },
      });
    }
  }

  return { features, badges };
}

/**
 * Construye el GeoJSON completo del Plan de Diseño Urbano (SPRITE-FORGE)
 * para todas las ciudades, SATs y macro-puentes visibles en el viewport.
 */
export function buildViewportUrbanBlueprintGeoJSON(
  map: MapLibreMap,
  registeredBadges: Set<string>,
  landPredicate: (lng: number, lat: number) => boolean,
  terrainRevision: number
): { key: string; geojson: GeoJSON.FeatureCollection } {
  const bounds = map.getBounds();
  const pad = 0.06;
  const minLng = bounds.getWest() - pad;
  const maxLng = bounds.getEast() + pad;
  const minLat = bounds.getSouth() - pad;
  const maxLat = bounds.getNorth() + pad;

  const allSpecs = getAllUrbanAndSatSpecs(landPredicate);
  const visibleSpecs = allSpecs.filter(
    (s) =>
      s.anchorLngLat[0] >= minLng &&
      s.anchorLngLat[0] <= maxLng &&
      s.anchorLngLat[1] >= minLat &&
      s.anchorLngLat[1] <= maxLat
  );

  const key = `${visibleSpecs.map((s) => s.cityId).join(',')}:rev${terrainRevision}`;
  const allFeatures: GeoJSON.Feature[] = [];

  for (const spec of visibleSpecs) {
    const cacheKey = `${spec.cityId}:rev${terrainRevision}`;
    let cached = perCityFeatureCache.get(cacheKey);
    if (!cached) {
      const bp = getOrCompileCityBlueprint(spec, landPredicate);
      cached = buildFeaturesForBlueprint(bp);
      perCityFeatureCache.set(cacheKey, cached);
    }
    for (const badge of cached.badges) {
      ensureBlueprintBadgeSprite(map, registeredBadges, badge.spriteId, badge.text, badge.borderColor, badge.textColor);
    }
    for (let i = 0; i < cached.features.length; i++) {
      allFeatures.push(cached.features[i]);
    }
  }

  // Pads cian de cabeceras de Macro-Puentes (#38BDF8)
  const bridges = getResolvedMacroBridges(landPredicate);
  for (const br of bridges) {
    const [wx, wy] = br.westLandfall;
    const [ex, ey] = br.eastLandfall;
    allFeatures.push({
      type: 'Feature',
      properties: { kind: 'bridgehead_box', bridgeId: br.def.id },
      geometry: { type: 'Polygon', coordinates: rectPolygonCoords(wx - 1, wy - 1, wx + 2, wy + 2) },
    });
    allFeatures.push({
      type: 'Feature',
      properties: { kind: 'bridgehead_box', bridgeId: br.def.id },
      geometry: { type: 'Polygon', coordinates: rectPolygonCoords(ex - 1, ey - 1, ex + 2, ey + 2) },
    });
    const brSprite = `bp_br_${br.def.id}`;
    ensureBlueprintBadgeSprite(map, registeredBadges, brSprite, `PUENTE: ${br.def.name}`, '#38BDF8', '#E0F2FE');
    allFeatures.push({
      type: 'Feature',
      properties: { kind: 'blueprint_label', badgeSpriteId: brSprite, priority: 1 },
      geometry: { type: 'Point', coordinates: cellCornerLngLat((wx + ex) * 0.5, wy - 1.5) },
    });
  }

  return {
    key,
    geojson: { type: 'FeatureCollection', features: allFeatures },
  };
}
