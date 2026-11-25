import type { Map as MapLibreMap } from 'maplibre-gl';
import {
  ZOOM_TACTICO,
  lngLatToGridCoords,
  tileFractionToLngLat,
} from '../../core/coordinates';
import { spatialDeploymentService } from '../../services/spatialDeploymentService';
import {
  TACTICAL_GRID_DIMENSION,
  type TacticalGeoJSONCollection,
  type TacticalGeoJSONFeature,
  type TacticalLineStringGeometry,
  type TacticalPolygonGeometry,
} from './tacticalMapStyle';
import {
  AWBW_SEA_OUTCOMES,
  GBA_BUILDING_FRAME_MAP,
  TERRAIN_FILL_COLORS,
  type AwbwDir8,
} from './tacticalTerrainSprites';
import { getYellowTrunkBridgeAxisAtGlobalCell } from '../../core/yellowTrunkBackboneIndex';

const TERRAIN_LAND = 1;
const TERRAIN_CUSTOM_SHOAL = 2;
const TERRAIN_SEA = 4;

export interface SectorCornerNeighbors {
  nw?: any[][] | null;
  ne?: any[][] | null;
  se?: any[][] | null;
  sw?: any[][] | null;
}

function resolveConnectedKey(
  prefix: 'road' | 'river',
  up: boolean,
  right: boolean,
  down: boolean,
  left: boolean
): string {
  if (up && down && left && right) return `tile_${prefix}-top-right-bottom-left`;
  if (up && right && down) return `tile_${prefix}-top-right-bottom`;
  if (up && down && left) return `tile_${prefix}-top-bottom-left`;
  if (up && right && left) return `tile_${prefix}-top-right-left`;
  if (right && down && left) return `tile_${prefix}-right-bottom-left`;
  if (up && right) return `tile_${prefix}-top-right`;
  if (up && left) return `tile_${prefix}-top-left`;
  if (down && right) return `tile_${prefix}-right-bottom`;
  if (down && left) return `tile_${prefix}-bottom-left`;
  if (up || down) return `tile_${prefix}-top-bottom`;
  return `tile_${prefix}-right-left`;
}

const sectorGeoJsonCache = new Map<string, GeoJSON.Feature[]>();
let cachedTerrainRevision = -1;

export function resolveFastTileSpriteKey(
  sx: number,
  sy: number,
  x: number,
  y: number,
  center: any[][],
  north: any[][] | null,
  east: any[][] | null,
  south: any[][] | null,
  west: any[][] | null,
  corners?: SectorCornerNeighbors
): string {
  const D = TACTICAL_GRID_DIMENSION;
  const tile = center[y][x];
  const type: string = tile.type;
  const getN = (nx: number, ny: number): string => {
    if (ny < 0) {
      if (nx < 0) return corners?.nw ? corners.nw[D - 1][D - 1].type : type;
      if (nx >= D) return corners?.ne ? corners.ne[D - 1][0].type : type;
      return north ? north[D - 1][nx].type : 'plains';
    }
    if (ny >= D) {
      if (nx < 0) return corners?.sw ? corners.sw[0][D - 1].type : type;
      if (nx >= D) return corners?.se ? corners.se[0][0].type : type;
      return south ? south[0][nx].type : 'plains';
    }
    if (nx < 0) return west ? west[ny][D - 1].type : 'plains';
    if (nx >= D) return east ? east[ny][0].type : 'plains';
    return center[ny][nx].type;
  };

  const resolveBridgeAxis = (bx: number, by: number): 1 | 2 => {
    const cachedAxis = getYellowTrunkBridgeAxisAtGlobalCell(sx * D + bx, sy * D + by);
    if (cachedAxis === 1 || cachedAxis === 2) return cachedAxis;
    const isAxisConn = (t: string) => t === 'road' || t === 'bridge' || t in GBA_BUILDING_FRAME_MAP;
    const hScore = (isAxisConn(getN(bx - 1, by)) ? 1 : 0) + (isAxisConn(getN(bx + 1, by)) ? 1 : 0);
    const vScore = (isAxisConn(getN(bx, by - 1)) ? 1 : 0) + (isAxisConn(getN(bx, by + 1)) ? 1 : 0);
    return hScore >= vScore ? 1 : 2;
  };

  if (type === 'road') {
    const isRoadConn = (t: string) => t === 'road' || t === 'bridge';
    return resolveConnectedKey(
      'road',
      isRoadConn(getN(x, y - 1)),
      isRoadConn(getN(x + 1, y)),
      isRoadConn(getN(x, y + 1)),
      isRoadConn(getN(x - 1, y))
    );
  }
  if (type === 'river') {
    const isRiverConn = (t: string) => t === 'river' || t === 'bridge' || t === 'sea' || t === 'shoal';
    return resolveConnectedKey(
      'river',
      isRiverConn(getN(x, y - 1)),
      isRiverConn(getN(x + 1, y)),
      isRiverConn(getN(x, y + 1)),
      isRiverConn(getN(x - 1, y))
    );
  }
  if (type === 'bridge') {
    return resolveBridgeAxis(x, y) === 1 ? 'tile_bridge_h' : 'tile_bridge_v';
  }
  if (type === 'pipe') {
    const isPipeConn = (t: string) => t === 'pipe' || t === 'pipeSeam';
    const u = isPipeConn(getN(x, y - 1));
    const r = isPipeConn(getN(x + 1, y));
    const d = isPipeConn(getN(x, y + 1));
    const l = isPipeConn(getN(x - 1, y));
    if (u && d) return 'tile_pipe-top-bottom';
    if (l && r) return 'tile_pipe-right-left';
    if (u && r) return 'tile_pipe-top-right';
    if (u && l) return 'tile_pipe-top-left';
    if (r && d) return 'tile_pipe-right-bottom';
    if (d && l) return 'tile_pipe-bottom-left';
    if (u) return 'tile_pipe-bottom';
    if (r) return 'tile_pipe-left';
    if (d) return 'tile_pipe-top';
    if (l) return 'tile_pipe-right';
    return 'tile_pipe_h';
  }
  if (type === 'pipeSeam') {
    const u = getN(x, y - 1);
    const d = getN(x, y + 1);
    return u === 'pipe' || d === 'pipe' ? 'tile_pipeSeam_v' : 'tile_pipeSeam_h';
  }
  if (type === 'rubble') {
    const l = getN(x - 1, y);
    const r = getN(x + 1, y);
    return l === 'pipe' || r === 'pipe' || l === 'pipeSeam' || r === 'pipeSeam'
      ? 'tile_rubble_h'
      : 'tile_rubble_v';
  }
  if (type in GBA_BUILDING_FRAME_MAP) {
    const ownerId = tile.ownerId;
    const factionKey =
      ownerId === 'p1' || ownerId === 'p2' || ownerId === 'p3' || ownerId === 'p4' || ownerId === 'p5'
        ? ownerId
        : 'neutral';
    // Variedad dual-skin gris neutral (AW2 + AW1) para manzanas city en metrópolis
    if (factionKey === 'neutral' && type === 'city' && ((sx * 7 + x * 13 + y * 5) & 1) === 1) {
      return 'tile_neutral_city_aw1';
    }
    return `tile_${factionKey}_${type}`;
  }
  if (type === 'forest') return ((sx * 31 + x * 17 + y * 13) & 3) === 0 ? 'tile_wood' : 'tile_forest';
  if (type === 'mountain') return 'tile_mountain';
  if (type === 'sea' || type === 'shoal') {
    const classifyNeighbor = (nx: number, ny: number, relDir: AwbwDir8): number => {
      const nt = getN(nx, ny);
      if (nt === 'bridge') {
        const br = resolveBridgeAxis(nx, ny);
        if (
          br === 1 &&
          (relDir === 'NW' || relDir === 'N' || relDir === 'NE' || relDir === 'SW' || relDir === 'S' || relDir === 'SE')
        ) {
          return TERRAIN_CUSTOM_SHOAL;
        }
        if (
          br === 2 &&
          (relDir === 'NE' || relDir === 'E' || relDir === 'SE' || relDir === 'NW' || relDir === 'W' || relDir === 'SW')
        ) {
          return TERRAIN_CUSTOM_SHOAL;
        }
        return TERRAIN_LAND;
      }
      if (nt in GBA_BUILDING_FRAME_MAP || nt === 'silo' || nt === 'usedSilo') {
        return TERRAIN_LAND;
      }
      if (nt === 'river' || nt === 'shoal') return TERRAIN_CUSTOM_SHOAL;
      if (nt === 'sea' || nt === 'reef') return TERRAIN_SEA;
      return TERRAIN_LAND;
    };

    const nearby: Record<AwbwDir8, number> = {
      NW: classifyNeighbor(x - 1, y - 1, 'NW'),
      N: classifyNeighbor(x, y - 1, 'N'),
      NE: classifyNeighbor(x + 1, y - 1, 'NE'),
      W: classifyNeighbor(x - 1, y, 'W'),
      E: classifyNeighbor(x + 1, y, 'E'),
      SW: classifyNeighbor(x - 1, y + 1, 'SW'),
      S: classifyNeighbor(x, y + 1, 'S'),
      SE: classifyNeighbor(x + 1, y + 1, 'SE'),
    };

    if (type === 'sea') {
      for (let i = 0; i < AWBW_SEA_OUTCOMES.length; i++) {
        const [reqDirs, stem] = AWBW_SEA_OUTCOMES[i];
        let matched = true;
        for (let j = 0; j < reqDirs.length; j++) {
          if (nearby[reqDirs[j]] !== TERRAIN_LAND) {
            matched = false;
            break;
          }
        }
        if (matched) return `tile_sea_${stem}`;
      }
      return 'tile_sea_Sea';
    }

    // Shoal: 81 stems oficiales AWBW
    const parts: string[] = [];
    for (const d of ['N', 'E', 'S', 'W'] as const) {
      const cls = nearby[d];
      if (cls === TERRAIN_LAND) parts.push(d);
      else if (cls !== TERRAIN_CUSTOM_SHOAL) parts.push(`A${d}`);
    }
    return `tile_shoal_${parts.length > 0 ? parts.join('-') : 'C'}`;
  }
  if (type === 'reef') return 'tile_reef';
  if (type === 'silo') return 'tile_silo';
  if (type === 'usedSilo') return 'tile_usedSilo';
  return ((sx * 29 + x * 11 + y * 7) & 3) === 0 ? 'tile_plain_alt' : 'tile_plains';
}

export function buildViewportTerrainGeoJSON(range: {
  minSX: number;
  maxSX: number;
  minSY: number;
  maxSY: number;
}): GeoJSON.FeatureCollection {
  const rev = spatialDeploymentService.getTerrainRevision();
  if (rev !== cachedTerrainRevision) {
    sectorGeoJsonCache.clear();
    cachedTerrainRevision = rev;
  }

  const features: GeoJSON.Feature[] = [];

  for (let sy = range.minSY; sy <= range.maxSY; sy++) {
    for (let sx = range.minSX; sx <= range.maxSX; sx++) {
      const key = `${sx}_${sy}`;
      let sectorFeatures = sectorGeoJsonCache.get(key);
      if (!sectorFeatures) {
        sectorFeatures = [];
        const center = spatialDeploymentService.getSectorTerrainMatrix([sx, sy], TACTICAL_GRID_DIMENSION);

        let waterCount = 0;
        const totalTiles = TACTICAL_GRID_DIMENSION * TACTICAL_GRID_DIMENSION;
        for (let ty = 0; ty < TACTICAL_GRID_DIMENSION; ty++) {
          for (let tx = 0; tx < TACTICAL_GRID_DIMENSION; tx++) {
            const t = center[ty][tx].type;
            if (t === 'sea' || t === 'reef' || t === 'shoal') waterCount++;
          }
        }
        const sectorFillColor = waterCount > totalTiles * 0.5 ? TERRAIN_FILL_COLORS.sea : '#5B7A2C';

        const snw = tileFractionToLngLat(sx, sy, ZOOM_TACTICO);
        const sne = tileFractionToLngLat(sx + 1, sy, ZOOM_TACTICO);
        const sse = tileFractionToLngLat(sx + 1, sy + 1, ZOOM_TACTICO);
        const ssw = tileFractionToLngLat(sx, sy + 1, ZOOM_TACTICO);
        sectorFeatures.push({
          type: 'Feature',
          geometry: {
            type: 'Polygon',
            coordinates: [[snw, sne, sse, ssw, snw]],
          },
          properties: {
            kind: 'fill',
            fillColor: sectorFillColor,
          },
        });
        if (sectorGeoJsonCache.size >= 64) {
          const oldest = sectorGeoJsonCache.keys().next().value;
          if (oldest) sectorGeoJsonCache.delete(oldest);
        }
        sectorGeoJsonCache.set(key, sectorFeatures);
      }
      for (let i = 0; i < sectorFeatures.length; i++) {
        features.push(sectorFeatures[i]);
      }
    }
  }

  return { type: 'FeatureCollection', features };
}

export function computeViewportSectorRange(
  map: MapLibreMap,
  maxSpan: number = 14
): {
  minSX: number;
  maxSX: number;
  minSY: number;
  maxSY: number;
} {
  const bounds = map.getBounds();
  const nw = lngLatToGridCoords(
    [bounds.getWest(), bounds.getNorth()],
    TACTICAL_GRID_DIMENSION,
    ZOOM_TACTICO
  );
  const se = lngLatToGridCoords(
    [bounds.getEast(), bounds.getSouth()],
    TACTICAL_GRID_DIMENSION,
    ZOOM_TACTICO
  );

  let minSX = Math.min(nw.sector[0], se.sector[0]) - 1;
  let maxSX = Math.max(nw.sector[0], se.sector[0]) + 1;
  let minSY = Math.min(nw.sector[1], se.sector[1]) - 1;
  let maxSY = Math.max(nw.sector[1], se.sector[1]) + 1;

  if (maxSX - minSX > maxSpan) {
    const centerSX = Math.floor((minSX + maxSX) / 2);
    const half = Math.floor(maxSpan / 2);
    minSX = centerSX - half;
    maxSX = minSX + maxSpan;
  }
  if (maxSY - minSY > maxSpan) {
    const centerSY = Math.floor((minSY + maxSY) / 2);
    const half = Math.floor(maxSpan / 2);
    minSY = centerSY - half;
    maxSY = minSY + maxSpan;
  }

  const maxTileIndex = Math.pow(2, ZOOM_TACTICO) - 1;
  minSX = Math.max(0, minSX);
  maxSX = Math.min(maxTileIndex, maxSX);
  minSY = Math.max(0, minSY);
  maxSY = Math.min(maxTileIndex, maxSY);

  return { minSX, maxSX, minSY, maxSY };
}

export function computeFixedMacroBlockRange(map: MapLibreMap): {
  minSX: number;
  maxSX: number;
  minSY: number;
  maxSY: number;
} {
  const center = map.getCenter();
  const c = lngLatToGridCoords([center.lng, center.lat], TACTICAL_GRID_DIMENSION, ZOOM_TACTICO);
  const blockX = Math.floor(c.sector[0] / 64) * 64;
  const blockY = Math.floor(c.sector[1] / 64) * 64;
  const maxTileIndex = Math.pow(2, ZOOM_TACTICO) - 1;
  return {
    minSX: Math.max(0, blockX - 64),
    maxSX: Math.min(maxTileIndex, blockX + 128),
    minSY: Math.max(0, blockY - 64),
    maxSY: Math.min(maxTileIndex, blockY + 128),
  };
}

export function buildViewportGridGeoJSON(
  map: MapLibreMap,
  range?: { minSX: number; maxSX: number; minSY: number; maxSY: number }
): TacticalGeoJSONCollection<TacticalLineStringGeometry, { isSectorBorder: boolean }> {
  const z = map.getZoom();
  if (z < 10.0) {
    return { type: 'FeatureCollection', features: [] };
  }

  const isMacroMode = z < ZOOM_TACTICO - 1.0;
  const effectiveRange = range ?? (isMacroMode ? computeFixedMacroBlockRange(map) : computeViewportSectorRange(map, 14));
  const { minSX, maxSX, minSY, maxSY } = effectiveRange;

  const minTileX = minSX;
  const maxTileX = maxSX + 1;
  const minTileY = minSY;
  const maxTileY = maxSY + 1;

  const features: TacticalGeoJSONFeature<TacticalLineStringGeometry, { isSectorBorder: boolean }>[] = [];

  if (isMacroMode) {
    for (let sx = minTileX; sx <= maxTileX; sx++) {
      features.push({
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: [
            tileFractionToLngLat(sx, minTileY, ZOOM_TACTICO),
            tileFractionToLngLat(sx, maxTileY, ZOOM_TACTICO),
          ],
        },
        properties: { isSectorBorder: true },
      });
    }
    for (let sy = minTileY; sy <= maxTileY; sy++) {
      features.push({
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: [
            tileFractionToLngLat(minTileX, sy, ZOOM_TACTICO),
            tileFractionToLngLat(maxTileX, sy, ZOOM_TACTICO),
          ],
        },
        properties: { isSectorBorder: true },
      });
    }
    return { type: 'FeatureCollection', features };
  }

  const startCol = minSX * TACTICAL_GRID_DIMENSION;
  const endCol = (maxSX + 1) * TACTICAL_GRID_DIMENSION;
  const startRow = minSY * TACTICAL_GRID_DIMENSION;
  const endRow = (maxSY + 1) * TACTICAL_GRID_DIMENSION;

  for (let col = startCol; col <= endCol; col++) {
    const tileX = col / TACTICAL_GRID_DIMENSION;
    features.push({
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: [
          tileFractionToLngLat(tileX, minTileY, ZOOM_TACTICO),
          tileFractionToLngLat(tileX, maxTileY, ZOOM_TACTICO),
        ],
      },
      properties: {
        isSectorBorder: col % TACTICAL_GRID_DIMENSION === 0,
      },
    });
  }

  for (let row = startRow; row <= endRow; row++) {
    const tileY = row / TACTICAL_GRID_DIMENSION;
    features.push({
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: [
          tileFractionToLngLat(minTileX, tileY, ZOOM_TACTICO),
          tileFractionToLngLat(maxTileX, tileY, ZOOM_TACTICO),
        ],
      },
      properties: {
        isSectorBorder: row % TACTICAL_GRID_DIMENSION === 0,
      },
    });
  }

  return { type: 'FeatureCollection', features };
}

export function buildCellPolygonFeature(
  sector: [number, number],
  cell: [number, number],
  kind: 'hover' | 'selected'
): TacticalGeoJSONFeature<TacticalPolygonGeometry, { kind: 'hover' | 'selected' }> {
  const x0 = sector[0] + cell[0] / TACTICAL_GRID_DIMENSION;
  const x1 = sector[0] + (cell[0] + 1) / TACTICAL_GRID_DIMENSION;
  const y0 = sector[1] + cell[1] / TACTICAL_GRID_DIMENSION;
  const y1 = sector[1] + (cell[1] + 1) / TACTICAL_GRID_DIMENSION;

  const nw = tileFractionToLngLat(x0, y0, ZOOM_TACTICO);
  const ne = tileFractionToLngLat(x1, y0, ZOOM_TACTICO);
  const se = tileFractionToLngLat(x1, y1, ZOOM_TACTICO);
  const sw = tileFractionToLngLat(x0, y1, ZOOM_TACTICO);

  return {
    type: 'Feature',
    geometry: {
      type: 'Polygon',
      coordinates: [[nw, ne, se, sw, nw]],
    },
    properties: { kind },
  };
}
