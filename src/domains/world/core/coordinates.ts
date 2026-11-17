/**
 * ==============================================================================
 * MOTOR DE COORDENADAS Y PICKING ANALÍTICO O(1) - OPENPLACE BRIDGE
 * ==============================================================================
 * Especificación Canónica: docs/00_GEOTACTICS_ONLINE_MASTER_SPEC.md §3.3
 * Conversión WGS84 (Lng/Lat) <-> Sectores Planetarios <-> Cuadrícula Táctica (20x20).
 * Soporta LOD Semántico y Trazado de Suministros Bresenham.
 * ==============================================================================
 */

import { TACTICAL_SPRITE_MAX_ZOOM } from '@shared';

export const ZOOM_GLOBAL = 3.5;       // Nivel 1: Macro-Geopolítica (Continentes y Países - z < 10)
export const ZOOM_OPERACIONAL = 10.0; // Nivel 2: Red Urbana, Ciudades, Avenidas y Unidades (z = 10 a < 15)
export const ZOOM_TACTICO = 15.0;     // Nivel 3: Microjuego, Asignación Espacial y Construcción (z >= 15)
export { TACTICAL_SPRITE_MAX_ZOOM };

/**
 * Calcula el tamaño exacto en píxeles CSS de una celda (20x20) al zoom dado.
 * A z = TACTICAL_SPRITE_MAX_ZOOM (~15.9069), el tamaño coincide 1:1 con 48px.
 */
export function getTacticalCellPixelSizeAtZoom(
  zoom: number,
  gridSize: number = 20,
  mapLibreTileSize: number = 512
): number {
  const sectorPx = mapLibreTileSize * Math.pow(2, zoom - ZOOM_TACTICO);
  return sectorPx / gridSize;
}

export const TILE_SIZE = 1000;        // Resolución canónica en píxeles de cada TileCanvas (1000x1000 px)
export const EARTH_RADIUS_M = 6_371_000;
export const MUNICIPAL_GRID_COLS = 25;
export const MUNICIPAL_GRID_ROWS = 20;
export const MUNICIPAL_TOTAL_MICRO_CELLS = 500;
export const MICRO_CELL_SIZE_METERS = 100;

export type LngLat = [number, number];
export type QuadLngLatBounds = [LngLat, LngLat, LngLat, LngLat];

export interface TacticalGridCoords {
  sector: [number, number];
  cell: [number, number];
  pixel: [number, number];
}

/**
 * Picking analítico O(1): Convierte cualquier coordenada geográfica (Lng, Lat)
 * al Sector Tile (Web Mercator a nivel de zoom dado) y su celda táctica interna.
 */
export function lngLatToGridCoords(
  lngLat: LngLat,
  gridSize: number = 20,
  zoom: number = ZOOM_TACTICO
): TacticalGridCoords {
  const [lng, lat] = lngLat;
  const clampedLat = Math.max(-85.05112878, Math.min(85.05112878, lat));
  const n = Math.pow(2, zoom);

  const tileXFloat = ((lng + 180) / 360) * n;
  const latRad = (clampedLat * Math.PI) / 180;
  const tileYFloat =
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;

  const sectorX = Math.floor(tileXFloat);
  const sectorY = Math.floor(tileYFloat);

  const fracX = tileXFloat - sectorX;
  const fracY = tileYFloat - sectorY;

  const cellX = Math.max(0, Math.min(gridSize - 1, Math.floor(fracX * gridSize)));
  const cellY = Math.max(0, Math.min(gridSize - 1, Math.floor(fracY * gridSize)));

  const pixelX = Math.max(0, Math.min(TILE_SIZE - 1, Math.floor(fracX * TILE_SIZE)));
  const pixelY = Math.max(0, Math.min(TILE_SIZE - 1, Math.floor(fracY * TILE_SIZE)));

  return {
    sector: [sectorX, sectorY],
    cell: [cellX, cellY],
    pixel: [pixelX, pixelY],
  };
}

/**
 * Convierte un par fraccionario de sector Web Mercator a coordenadas geográficas (Lng, Lat).
 */
export function tileFractionToLngLat(
  tileXFloat: number,
  tileYFloat: number,
  zoom: number = ZOOM_TACTICO
): LngLat {
  const n = Math.pow(2, zoom);
  const lng = (tileXFloat / n) * 360 - 180;
  const latRad = Math.atan(Math.sinh(Math.PI * (1 - (2 * tileYFloat) / n)));
  const lat = (latRad * 180) / Math.PI;
  return [lng, lat];
}

/**
 * Convierte un Sector y Celda táctica dada a la coordenada geográfica central (Lng, Lat) de la loseta.
 */
export function gridCoordsToLngLat(
  sector: [number, number],
  cell: [number, number],
  gridSize: number = 20,
  zoom: number = ZOOM_TACTICO
): LngLat {
  const [sectorX, sectorY] = sector;
  const [cellX, cellY] = cell;
  const tileXFloat = sectorX + (cellX + 0.5) / gridSize;
  const tileYFloat = sectorY + (cellY + 0.5) / gridSize;
  return tileFractionToLngLat(tileXFloat, tileYFloat, zoom);
}

/**
 * Obtiene los 4 vértices geográficos [Top-Left, Top-Right, Bottom-Right, Bottom-Left]
 * requeridos por MapLibre GL para anclar un CanvasSource.
 */
export function getTileBounds(
  sectorX: number,
  sectorY: number,
  zoom: number = ZOOM_TACTICO
): QuadLngLatBounds {
  return [
    tileFractionToLngLat(sectorX, sectorY, zoom),
    tileFractionToLngLat(sectorX + 1, sectorY, zoom),
    tileFractionToLngLat(sectorX + 1, sectorY + 1, zoom),
    tileFractionToLngLat(sectorX, sectorY + 1, zoom),
  ];
}

/**
 * Traza la línea continua de suministro logístico entre dos nodos geográficos
 * o provinciales mediante el algoritmo raster clásico de Bresenham.
 */
export function traceSupplyLine(
  from: [number, number],
  to: [number, number]
): [number, number][] {
  const points: [number, number][] = [];
  let [x0, y0] = [Math.floor(from[0]), Math.floor(from[1])];
  const [x1, y1] = [Math.floor(to[0]), Math.floor(to[1])];

  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;

  while (true) {
    points.push([x0, y0]);
    if (x0 === x1 && y0 === y1) break;
    const e2 = err * 2;
    if (e2 > -dy) {
      err -= dy;
      x0 += sx;
    }
    if (e2 < dx) {
      err += dx;
      y0 += sy;
    }
  }
  return points;
}

/**
 * Proyección analítica O(1) de una coordenada WGS84 sobre la malla municipal
 * de 500 micro-celdas de 100x100m (25x20) centrada en el municipio a ZOOM_TACTICO = 15.0.
 */
export function lngLatToMunicipalMicroCell(
  lngLat: LngLat,
  municipalityCenter: LngLat
): {
  x: number;
  y: number;
  cellIndex: number;
  cellCenterLngLat: LngLat;
} {
  const [lng, lat] = lngLat;
  const [centerLng, centerLat] = municipalityCenter;
  const centerLatRad = (centerLat * Math.PI) / 180;
  const metersPerDegLng = 111_320 * Math.max(0.1, Math.cos(centerLatRad));
  const metersPerDegLat = 110_574;

  const deltaMetersX = (lng - centerLng) * metersPerDegLng;
  const deltaMetersY = (centerLat - lat) * metersPerDegLat;

  const rawX = Math.floor(deltaMetersX / MICRO_CELL_SIZE_METERS + MUNICIPAL_GRID_COLS / 2);
  const rawY = Math.floor(deltaMetersY / MICRO_CELL_SIZE_METERS + MUNICIPAL_GRID_ROWS / 2);

  const x = Math.max(0, Math.min(MUNICIPAL_GRID_COLS - 1, rawX));
  const y = Math.max(0, Math.min(MUNICIPAL_GRID_ROWS - 1, rawY));
  const cellIndex = y * MUNICIPAL_GRID_COLS + x;

  const offsetMetersX = (x + 0.5 - MUNICIPAL_GRID_COLS / 2) * MICRO_CELL_SIZE_METERS;
  const offsetMetersY = (MUNICIPAL_GRID_ROWS / 2 - (y + 0.5)) * MICRO_CELL_SIZE_METERS;

  const cellCenterLngLat: LngLat = [
    Number((centerLng + offsetMetersX / metersPerDegLng).toFixed(6)),
    Number((centerLat + offsetMetersY / metersPerDegLat).toFixed(6)),
  ];

  return {
    x,
    y,
    cellIndex,
    cellCenterLngLat,
  };
}

// ==============================================================================
// INDEXACIÓN HEXAGONAL H3 RESOLUCIÓN 9 (~174m) Y RESOLUCIÓN 4 (AGRUPACIÓN REGIONAL)
// ==============================================================================

export const H3_RES9_EDGE_METERS = 174;
const H3_RES9_PREFIX = 0x0890000000000000n;
const H3_RES4_PREFIX = 0x0840000000000000n;
const H3_AXIAL_BIAS = 8_388_608n;
const H3_AXIAL_MASK = 0xFFFFFFn;
const H3_MERCATOR_R = 6_378_137;

function packH3Axial(prefix: bigint, q: number, r: number): bigint {
  const pq = (BigInt(q) + H3_AXIAL_BIAS) & H3_AXIAL_MASK;
  const pr = (BigInt(r) + H3_AXIAL_BIAS) & H3_AXIAL_MASK;
  return prefix | (pq << 24n) | pr;
}

function unpackH3Axial(h3Index: bigint): { q: number; r: number } {
  const q = Number(((h3Index >> 24n) & H3_AXIAL_MASK) - H3_AXIAL_BIAS);
  const r = Number((h3Index & H3_AXIAL_MASK) - H3_AXIAL_BIAS);
  return { q, r };
}

function axialRound(qf: number, rf: number): { q: number; r: number } {
  const sf = -qf - rf;
  let q = Math.round(qf);
  let r = Math.round(rf);
  const s = Math.round(sf);
  const qDiff = Math.abs(q - qf);
  const rDiff = Math.abs(r - rf);
  const sDiff = Math.abs(s - sf);

  if (qDiff > rDiff && qDiff > sDiff) {
    q = -r - s;
  } else if (rDiff > sDiff) {
    r = -q - s;
  }
  return { q, r };
}

export function latLngToH3Res9(lat: number, lng: number): bigint {
  const clampedLat = Math.max(-85.05112878, Math.min(85.05112878, lat));
  const xM = ((lng * Math.PI) / 180) * H3_MERCATOR_R;
  const yM =
    Math.log(Math.tan(Math.PI / 4 + (clampedLat * Math.PI) / 360)) * H3_MERCATOR_R;

  const qf = ((Math.sqrt(3) / 3) * xM - (1 / 3) * yM) / H3_RES9_EDGE_METERS;
  const rf = ((2 / 3) * yM) / H3_RES9_EDGE_METERS;
  const { q, r } = axialRound(qf, rf);
  return packH3Axial(H3_RES9_PREFIX, q, r);
}

export function h3Res9ToLatLng(h3Index: bigint): [number, number] {
  const { q, r } = unpackH3Axial(h3Index);
  const xM = H3_RES9_EDGE_METERS * Math.sqrt(3) * (q + r / 2);
  const yM = H3_RES9_EDGE_METERS * 1.5 * r;
  const lng = (xM / H3_MERCATOR_R) * (180 / Math.PI);
  const lat = (2 * Math.atan(Math.exp(yM / H3_MERCATOR_R)) - Math.PI / 2) * (180 / Math.PI);
  return [Number(lat.toFixed(6)), Number(lng.toFixed(6))];
}

export function h3Res9ToParentRes4(h3Index: bigint): bigint {
  const { q, r } = unpackH3Axial(h3Index);
  return packH3Axial(H3_RES4_PREFIX, Math.floor(q / 32), Math.floor(r / 32));
}

export function h3GridDistance(h3A: bigint, h3B: bigint): number {
  const a = unpackH3Axial(h3A);
  const b = unpackH3Axial(h3B);
  const dq = a.q - b.q;
  const dr = a.r - b.r;
  return Math.round((Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2);
}

export function h3GridDisk(originH3: bigint, radiusRings: number): bigint[] {
  const k = Math.max(0, Math.floor(radiusRings));
  const { q, r } = unpackH3Axial(originH3);
  const result: bigint[] = [];
  for (let dq = -k; dq <= k; dq++) {
    const rMin = Math.max(-k, -dq - k);
    const rMax = Math.min(k, -dq + k);
    for (let dr = rMin; dr <= rMax; dr++) {
      result.push(packH3Axial(H3_RES9_PREFIX, q + dq, r + dr));
    }
  }
  return result;
}

export function h3GridPathCells(startH3: bigint, endH3: bigint): bigint[] {
  const dist = h3GridDistance(startH3, endH3);
  if (dist === 0) return [startH3];
  const a = unpackH3Axial(startH3);
  const b = unpackH3Axial(endH3);
  const path: bigint[] = [];
  for (let i = 0; i <= dist; i++) {
    const t = i / dist;
    const qf = a.q + (b.q - a.q) * t + 1e-6;
    const rf = a.r + (b.r - a.r) * t + 1e-6;
    const { q, r } = axialRound(qf, rf);
    const cell = packH3Axial(H3_RES9_PREFIX, q, r);
    if (path.length === 0 || path[path.length - 1] !== cell) {
      path.push(cell);
    }
  }
  return path;
}
