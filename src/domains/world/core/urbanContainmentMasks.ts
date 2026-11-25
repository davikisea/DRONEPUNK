/**
 * ==============================================================================
 * MÁSCARAS DE CONTENCIÓN POLIGONAL Y PRECEDENCIA CARTOGRÁFICA (@domains/world)
 * ==============================================================================
 * Garantías G1..G4 (Equipo Alpha A3 + convergencia Beta B3):
 * - G1: Precedencia estricta municipal_hd > world_macro dentro del bbox del Zulia
 *       (erradica las 509 muestras de tierra fantasma de world_land.json en el Lago).
 * - G2: Separación formal entre M_dry_mun(c) (tejido urbano intra-ciudad) y
 *       M_dry_global (arterias troncales y alimentadores intermunicipales).
 * - G3: resolveInlandSafeCityAnchor con atracción suave hacia la línea amarilla.
 * - G4: M_port_coast(c) para emplazamiento costero válido de puertos neutrales.
 * ==============================================================================
 */

import { globalTacticalCellToLngLat, ZOOM_TACTICO } from './coordinates';
import { isGlobalRiverAtCell } from './globalHydrologyPredicate';

export interface MunicipalityIndexedPolygon {
  readonly id: string;
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
  readonly rings: number[][][];
}

/** Envolvente hidrográfica del Estado Zulia (donde mandan los 21 polígonos HD) */
export const ZULIA_HYDRO_ENVELOPE = {
  minLng: -73.4,
  maxLng: -70.65,
  minLat: 8.35,
  maxLat: 11.9,
} as const;

export function isInsideZuliaHydroEnvelope(lng: number, lat: number): boolean {
  return (
    lng >= ZULIA_HYDRO_ENVELOPE.minLng &&
    lng <= ZULIA_HYDRO_ENVELOPE.maxLng &&
    lat >= ZULIA_HYDRO_ENVELOPE.minLat &&
    lat <= ZULIA_HYDRO_ENVELOPE.maxLat
  );
}

function pointInRingStrict(lng: number, lat: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const intersect =
      yi > lat !== yj > lat &&
      lng < ((xj - xi) * (lat - yi)) / (yj - yi + 1e-15) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function pointInMunicipalityPoly(
  lng: number,
  lat: number,
  poly: MunicipalityIndexedPolygon
): boolean {
  if (lng < poly.minX || lng > poly.maxX || lat < poly.minY || lat > poly.maxY) {
    return false;
  }
  if (!pointInRingStrict(lng, lat, poly.rings[0])) return false;
  for (let h = 1; h < poly.rings.length; h++) {
    if (pointInRingStrict(lng, lat, poly.rings[h])) return false;
  }
  return true;
}

const municipalityPolygonsById = new Map<string, MunicipalityIndexedPolygon[]>();
let municipalityIndexLoaded = false;
let municipalityNodeLoadAttempted = false;

export function registerMunicipalityContainmentPolygons(geojson: unknown): number {
  const features =
    geojson && typeof geojson === 'object' && Array.isArray((geojson as { features?: unknown[] }).features)
      ? (geojson as { features: Array<{ properties?: Record<string, unknown>; geometry?: { type?: string; coordinates?: unknown } }> }).features
      : [];

  const grouped = new Map<string, MunicipalityIndexedPolygon[]>();
  let count = 0;
  for (const feat of features) {
    const id = typeof feat.properties?.id === 'string' ? feat.properties.id : null;
    // Invariante I3: filtrar estrictamente polígonos municipales HD (MUN_ZULIA_*)
    if (!id || !id.startsWith('MUN_ZULIA_') || !feat.geometry) continue;
    const rawPolys: number[][][][] =
      feat.geometry.type === 'Polygon' && Array.isArray(feat.geometry.coordinates)
        ? [feat.geometry.coordinates as number[][][]]
        : feat.geometry.type === 'MultiPolygon' && Array.isArray(feat.geometry.coordinates)
        ? (feat.geometry.coordinates as number[][][][])
        : [];

    for (const rings of rawPolys) {
      const outer = rings[0];
      if (!outer || outer.length < 3) continue;
      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;
      for (const pt of outer) {
        if (pt[0] < minX) minX = pt[0];
        if (pt[0] > maxX) maxX = pt[0];
        if (pt[1] < minY) minY = pt[1];
        if (pt[1] > maxY) maxY = pt[1];
      }
      const list = grouped.get(id) ?? [];
      list.push({ id, minX, maxX, minY, maxY, rings });
      grouped.set(id, list);
      count++;
    }
  }
  if (count > 0) {
    // Reemplazo idempotente por id (seguro ante React StrictMode / doble hidratación)
    for (const [id, list] of grouped.entries()) {
      municipalityPolygonsById.set(id, list);
    }
    municipalityIndexLoaded = true;
  }
  return count;
}

function ensureMunicipalityPolygonsLoadedInNode(): void {
  if (municipalityIndexLoaded || municipalityNodeLoadAttempted) return;
  municipalityNodeLoadAttempted = true;
  try {
    if (typeof window !== 'undefined' || typeof process === 'undefined' || !process.versions?.node) {
      return;
    }
    const getBuiltin = (process as unknown as { getBuiltinModule?: (m: string) => Record<string, unknown> }).getBuiltinModule;
    const loadMod = (m: string) =>
      getBuiltin ? getBuiltin(m) : (Function('mod', 'return require(mod)') as (mod: string) => Record<string, unknown>)(m);
    const fsMod = loadMod('fs') as { existsSync: (p: string) => boolean; readFileSync: (p: string, enc: string) => string };
    const pathMod = loadMod('path') as { resolve: (...p: string[]) => string };
    const filePath = pathMod.resolve(process.cwd(), 'public', 'map', 'zulia_municipalities.json');
    if (fsMod.existsSync(filePath)) {
      const parsed = JSON.parse(fsMod.readFileSync(filePath, 'utf-8'));
      registerMunicipalityContainmentPolygons(parsed);
    }
  } catch {
    // Fallback silencioso en entornos sin FS
  }
}

export function isPointInMunicipality(lng: number, lat: number, municipalityId: string): boolean {
  ensureMunicipalityPolygonsLoadedInNode();
  const polys = municipalityPolygonsById.get(municipalityId);
  if (!polys || polys.length === 0) return true;
  for (let i = 0; i < polys.length; i++) {
    if (pointInMunicipalityPoly(lng, lat, polys[i])) return true;
  }
  return false;
}

export interface UrbanContainmentMasks {
  readonly width: number;
  readonly height: number;
  /** M_dry_mun(c): Tierra firme seca dentro del municipio (excluye mar y ríos) */
  readonly dryMunicipalityMask: Uint8Array;
  /** M_land_global: Tierra firme global (para detectar costa abierta vs frontera seca) */
  readonly dryGlobalMask: Uint8Array;
  /** M_port_coast(c): Celdas costeras válidas para puertos (tierra municipal tocando agua abierta >= 2 tiles) */
  readonly portCoastMask: Uint8Array;
  /** M_river(c): Cauces fluviales 4-conectados (compartidos con Etapa 2 de gbaMapPipeline) */
  readonly riverMask: Uint8Array;
}

export function buildUrbanContainmentMasks(
  originGlobalX: number,
  originGlobalY: number,
  width: number,
  height: number,
  municipalityId: string | null,
  landPredicate: (lng: number, lat: number) => boolean,
  gridSize: number = 20
): UrbanContainmentMasks {
  ensureMunicipalityPolygonsLoadedInNode();
  const dryMunicipalityMask = new Uint8Array(width * height);
  const dryGlobalMask = new Uint8Array(width * height);
  const portCoastMask = new Uint8Array(width * height);
  const riverMask = new Uint8Array(width * height);

  const hasMunPolys = municipalityId !== null && municipalityPolygonsById.has(municipalityId);

  for (let ly = 0; ly < height; ly++) {
    for (let lx = 0; lx < width; lx++) {
      const idx = ly * width + lx;
      const gx = originGlobalX + lx;
      const gy = originGlobalY + ly;
      const [lng, lat] = globalTacticalCellToLngLat(gx, gy, gridSize, ZOOM_TACTICO);
      const isGlobalLand = landPredicate(lng, lat);
      if (isGlobalLand) {
        dryGlobalMask[idx] = 1;
        const isRiver = isGlobalRiverAtCell(gx, gy);
        if (isRiver) {
          riverMask[idx] = 1;
        }
        if (
          !isRiver &&
          (!hasMunPolys || (municipalityId !== null && isPointInMunicipality(lng, lat, municipalityId)))
        ) {
          dryMunicipalityMask[idx] = 1;
        }
      }
    }
  }

  // M_port_coast(c): celda seca del municipio adyacente a agua con calado libre (>= 2 tiles de agua)
  const dirs: ReadonlyArray<readonly [number, number]> = [
    [0, -1],
    [1, 0],
    [0, 1],
    [-1, 0],
  ];
  for (let ly = 1; ly < height - 1; ly++) {
    for (let lx = 1; lx < width - 1; lx++) {
      const idx = ly * width + lx;
      if (dryMunicipalityMask[idx] !== 1) continue;
      let validWaterfront = false;
      for (let d = 0; d < 4; d++) {
        const [dx, dy] = dirs[d];
        const nx1 = lx + dx;
        const ny1 = ly + dy;
        const nx2 = lx + dx * 2;
        const ny2 = ly + dy * 2;
        if (
          nx1 >= 0 && nx1 < width && ny1 >= 0 && ny1 < height &&
          dryGlobalMask[ny1 * width + nx1] === 0 &&
          nx2 >= 0 && nx2 < width && ny2 >= 0 && ny2 < height &&
          dryGlobalMask[ny2 * width + nx2] === 0
        ) {
          validWaterfront = true;
          break;
        }
      }
      if (validWaterfront) {
        portCoastMask[idx] = 1;
      }
    }
  }

  return { width, height, dryMunicipalityMask, dryGlobalMask, portCoastMask, riverMask };
}

/**
 * G3: Reubica suavemente el centroide de ciudades costeras o fronterizas (ej. El Moján, El Toro)
 * hacia el interior seco de M_dry_mun(c) ponderando atracción hacia la troncal amarilla más cercana.
 */
export function resolveInlandSafeCityAnchor(
  masks: UrbanContainmentMasks,
  nominalLocalX: number,
  nominalLocalY: number,
  maxShiftTiles: number = 10,
  nearestTrunkLocal?: readonly [number, number] | null
): [number, number] {
  const { width, height, dryMunicipalityMask } = masks;
  const distToForbidden = new Int16Array(width * height);
  distToForbidden.fill(-1);

  const queueX = new Int16Array(width * height);
  const queueY = new Int16Array(width * height);
  let head = 0;
  let tail = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (dryMunicipalityMask[idx] === 0 || x === 0 || x === width - 1 || y === 0 || y === height - 1) {
        distToForbidden[idx] = 0;
        queueX[tail] = x;
        queueY[tail] = y;
        tail++;
      }
    }
  }

  const dirs = [
    [0, -1],
    [1, 0],
    [0, 1],
    [-1, 0],
  ];
  while (head < tail) {
    const cx = queueX[head];
    const cy = queueY[head];
    head++;
    const cd = distToForbidden[cy * width + cx];
    for (let d = 0; d < 4; d++) {
      const nx = cx + dirs[d][0];
      const ny = cy + dirs[d][1];
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
      const nIdx = ny * width + nx;
      if (distToForbidden[nIdx] === -1) {
        distToForbidden[nIdx] = cd + 1;
        queueX[tail] = nx;
        queueY[tail] = ny;
        tail++;
      }
    }
  }

  const clampedNomX = Math.max(1, Math.min(width - 2, Math.round(nominalLocalX)));
  const clampedNomY = Math.max(1, Math.min(height - 2, Math.round(nominalLocalY)));
  const nomDist = distToForbidden[clampedNomY * width + clampedNomX];
  if (dryMunicipalityMask[clampedNomY * width + clampedNomX] === 1 && nomDist >= 4) {
    return [clampedNomX, clampedNomY];
  }

  let bestX = clampedNomX;
  let bestY = clampedNomY;
  let bestScore = -Infinity;

  const minY = Math.max(1, clampedNomY - maxShiftTiles);
  const maxY = Math.min(height - 2, clampedNomY + maxShiftTiles);
  const minX = Math.max(1, clampedNomX - maxShiftTiles);
  const maxX = Math.min(width - 2, clampedNomX + maxShiftTiles);

  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const idx = y * width + x;
      if (dryMunicipalityMask[idx] !== 1) continue;
      const dShift = Math.hypot(x - clampedNomX, y - clampedNomY);
      if (dShift > maxShiftTiles) continue;
      const trunkPenalty = nearestTrunkLocal
        ? 0.08 * Math.hypot(x - nearestTrunkLocal[0], y - nearestTrunkLocal[1])
        : 0;
      const score = distToForbidden[idx] * 2.0 - dShift * 0.45 - trunkPenalty;
      if (score > bestScore) {
        bestScore = score;
        bestX = x;
        bestY = y;
      }
    }
  }

  return [bestX, bestY];
}

/**
 * Ancla suavemente ciudades costeras (waterfrontDir !== 'none') para que su silueta
 * abrace la orilla navegable real (portCoastMask) y pueda desplegar WATERFRON [steppe].
 */
export function snapCoastalCityAnchorToShore(
  masks: UrbanContainmentMasks,
  safeCenterX: number,
  safeCenterY: number,
  waterfrontDir: 'N' | 'E' | 'S' | 'W' | 'none',
  radiusTiles: number
): [number, number] {
  if (waterfrontDir === 'none') return [safeCenterX, safeCenterY];
  const { width, height, dryMunicipalityMask, portCoastMask } = masks;

  // Verificar cuántos tiles costeros ya quedan dentro de radiusTiles
  let nearCoast = 0;
  let nearestCoastX = -1;
  let nearestCoastY = -1;
  let nearestDist = Infinity;

  for (let y = 2; y < height - 2; y++) {
    for (let x = 2; x < width - 2; x++) {
      if (!portCoastMask[y * width + x]) continue;
      const d = Math.hypot(x - safeCenterX, y - safeCenterY);
      if (d <= radiusTiles + 1) nearCoast++;
      if (d < nearestDist) {
        nearestDist = d;
        nearestCoastX = x;
        nearestCoastY = y;
      }
    }
  }
  if (nearCoast >= 4 || nearestCoastX < 0 || nearestDist > radiusTiles + 16) {
    return [safeCenterX, safeCenterY];
  }

  // Desplazar suavemente hacia la orilla manteniendo el centroide en tierra firme a >= 5 tiles
  const dirX = nearestCoastX - safeCenterX;
  const dirY = nearestCoastY - safeCenterY;
  const len = Math.max(1, Math.hypot(dirX, dirY));
  const shift = Math.max(0, nearestDist - Math.max(5, radiusTiles - 4));
  const candX = Math.max(4, Math.min(width - 5, Math.round(safeCenterX + (dirX / len) * shift)));
  const candY = Math.max(4, Math.min(height - 5, Math.round(safeCenterY + (dirY / len) * shift)));

  if (dryMunicipalityMask[candY * width + candX]) {
    return [candX, candY];
  }
  return [safeCenterX, safeCenterY];
}
