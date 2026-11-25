/**
 * ==============================================================================
 * PARTICIÓN POLIMÓRFICA DE SECTORES (4 MÉTODOS) Y 5 DISTRITOS FUNCIONALES
 * ==============================================================================
 * Port 100 % fiel de 09_city_world_engine.py (v6.0.0-awbw, L3089-3686):
 * - 4 métodos de partición:
 *   1. coast_parallel_bands (BFS al agua + cuantiles)
 *   2. elevation_terraces (proyección rotada + cuantiles)
 *   3. voronoi_geodesic (BFS multi-fuente sobre inland_real)
 *   4. non_orthogonal_angular (cuantiles angulares rotados con jitter)
 * - 5 distritos funcionales no-cuadrados en orden estricto:
 *   waterfront_port -> air_hub -> civic_core -> industrial_logistics_park -> science_campus
 * - 100 % edificios neutrales grises (ownerId: null), North Setback >= 8px, 0 tuberías
 * ==============================================================================
 */

import {
  AWBW_BUILDING_OVERHANG_PX,
  URBAN_CELL_BIT_BELTWAY,
  URBAN_CELL_BIT_PARK,
  URBAN_CELL_BIT_PORT_WATER,
  URBAN_CELL_BIT_ROAD,
  type CityDnaProfile,
  type CityScaleSpec,
  type DistrictLegendEntry,
  type DistrictOrientationId,
  type FunctionalDistrictArchetypeId,
  type FunctionalDistrictRecord,
  type InitialNeutralBuildingType,
  type MicroGrainGrammarId,
  type UrbanBuildingPlacement,
} from '../types/urbanMorphologyTypes';
import type { UrbanContainmentMasks } from './urbanContainmentMasks';
import type {
  ArterialSkeletonResult,
  SynthesizedSilhouetteResult,
} from './urbanSilhouetteAndSkeleton';
import {
  bfsDistance,
  CARDINAL_DIRS,
  connectedComponents4,
  detHashInt,
  trace4ConnNo2x2,
  wouldMake2x2,
} from './urbanMorphologyPrimitives';

export interface SectorPartitionResult {
  readonly sectorIdGrid: Int32Array;
  readonly sectorDefs: Array<{ id: string; grain: MicroGrainGrammarId }>;
  readonly nsBarsMask: Uint8Array;
}

export interface FunctionalDistrictsPlanResult {
  readonly partition: SectorPartitionResult;
  readonly buildingsByLocalIdx: Map<number, UrbanBuildingPlacement>;
  readonly buildingsMask: Uint8Array;
  readonly blockedDistMask: Uint8Array;
  readonly runwayClearMask: Uint8Array;
  readonly flightCorridorExclMask: Uint8Array;
  readonly portBeltwayNearMask: Uint8Array;
  readonly usedMask: Uint8Array;
  readonly districtGrid: Int32Array;
  readonly districtLegend: DistrictLegendEntry[];
  readonly districts: FunctionalDistrictRecord[];
}

function computeQuantiles(sortedVals: number[], k: number): number[] {
  const qs: number[] = [];
  const n = sortedVals.length;
  for (let i = 1; i < k; i++) {
    const idx = Math.min(n - 1, Math.max(0, Math.floor((i * n) / k)));
    qs.push(sortedVals[idx]);
  }
  return qs;
}

function bucketForValue(val: number, cutoffs: number[]): number {
  let sid = 0;
  while (sid < cutoffs.length && val > cutoffs[sid]) sid++;
  return sid;
}

/**
 * Particiona inlandMask en K sectores polimórficos (L3089-3163).
 */
export function partitionUrbanSectors(
  spec: CityScaleSpec,
  dna: CityDnaProfile,
  sil: SynthesizedSilhouetteResult,
  masks: UrbanContainmentMasks
): SectorPartitionResult {
  const { width, height, dryGlobalMask, riverMask } = masks;
  const { inlandMask, rbtCenterX, rbtCenterY } = sil;
  const kSec = Math.max(
    2,
    Math.min(
      dna.microGrains.length,
      spec.engineScale === 'x1' ? Math.min(dna.sectorCount, 3) : dna.sectorCount
    )
  );
  const sectorDefs = Array.from({ length: kSec }, (_, i) => ({
    id: `S${i}`,
    grain: dna.microGrains[i % dna.microGrains.length],
  }));

  const sectorIdGrid = new Int32Array(width * height);
  sectorIdGrid.fill(-1);

  const inlandPts: Array<[number, number]> = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (inlandMask[y * width + x]) inlandPts.push([x, y]);
    }
  }
  if (inlandPts.length === 0) {
    return { sectorIdGrid, sectorDefs, nsBarsMask: new Uint8Array(width * height) };
  }

  const waterGrid = new Uint8Array(width * height);
  let hasWater = false;
  for (let i = 0; i < waterGrid.length; i++) {
    if (!dryGlobalMask[i] || riverMask[i]) {
      waterGrid[i] = 1;
      hasWater = true;
    }
  }

  if (dna.partitionMethod === 'coast_parallel_bands' && hasWater) {
    const dCoast = bfsDistance(waterGrid, width, height);
    const vals = inlandPts.map(([x, y]) => dCoast[y * width + x]).sort((a, b) => a - b);
    const cutoffs = computeQuantiles(vals, kSec);
    for (const [x, y] of inlandPts) {
      sectorIdGrid[y * width + x] = bucketForValue(dCoast[y * width + x], cutoffs);
    }
  } else if (dna.partitionMethod === 'elevation_terraces') {
    const angT = dna.angleRad + dna.angularJitterRad;
    const sA = Math.sin(angT);
    const cA = Math.cos(angT);
    const vals = inlandPts
      .map(([x, y]) => (x - rbtCenterX) * sA + (y - rbtCenterY) * cA)
      .sort((a, b) => a - b);
    const cutoffs = computeQuantiles(vals, kSec);
    for (const [x, y] of inlandPts) {
      const v = (x - rbtCenterX) * sA + (y - rbtCenterY) * cA;
      sectorIdGrid[y * width + x] = bucketForValue(v, cutoffs);
    }
  } else if (dna.partitionMethod === 'voronoi_geodesic') {
    const baseAng = dna.angleRad + dna.angularJitterRad;
    const queue: Array<[number, number, number]> = [];
    for (let s = 0; s < kSec; s++) {
      const thS = baseAng + (2 * Math.PI * s) / kSec;
      const cT = Math.cos(thS);
      const sT = Math.sin(thS);
      let bestPt = inlandPts[0];
      let bestScore = -Infinity;
      for (const pt of inlandPts) {
        const sc = (pt[0] - rbtCenterX) * cT + (pt[1] - rbtCenterY) * sT;
        if (sc > bestScore) {
          bestScore = sc;
          bestPt = pt;
        }
      }
      let sx = Math.floor((bestPt[0] + rbtCenterX) * 0.5);
      let sy = Math.floor((bestPt[1] + rbtCenterY) * 0.5);
      if (!inlandMask[sy * width + sx]) {
        sx = bestPt[0];
        sy = bestPt[1];
      }
      if (sectorIdGrid[sy * width + sx] < 0) {
        sectorIdGrid[sy * width + sx] = s;
        queue.push([sx, sy, s]);
      }
    }
    let head = 0;
    while (head < queue.length) {
      const [vx, vy, sid] = queue[head++];
      for (let d = 0; d < 4; d++) {
        const nx = vx + CARDINAL_DIRS[d][0];
        const ny = vy + CARDINAL_DIRS[d][1];
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
        const nIdx = ny * width + nx;
        if (inlandMask[nIdx] && sectorIdGrid[nIdx] < 0) {
          sectorIdGrid[nIdx] = sid;
          queue.push([nx, ny, sid]);
        }
      }
    }
    // Asegurar que toda celda interior tenga sector asignado
    for (const [x, y] of inlandPts) {
      if (sectorIdGrid[y * width + x] < 0) sectorIdGrid[y * width + x] = 0;
    }
  } else {
    // non_orthogonal_angular
    const angOff = dna.angleRad + dna.angularJitterRad;
    const twoPi = Math.PI * 2;
    const rawTh = inlandPts.map(([x, y]) => {
      const a = (Math.atan2(y - rbtCenterY, x - rbtCenterX) - angOff) % twoPi;
      return a < 0 ? a + twoPi : a;
    });
    const sorted = [...rawTh].sort((a, b) => a - b);
    const cutoffs = computeQuantiles(sorted, kSec);
    for (let i = 0; i < inlandPts.length; i++) {
      const [x, y] = inlandPts[i];
      sectorIdGrid[y * width + x] = bucketForValue(rawTh[i], cutoffs);
    }
  }

  const nsBarsMask = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const sid = sectorIdGrid[i];
    if (sid >= 0 && sid < sectorDefs.length && sectorDefs[sid].grain === 'ns_bars') {
      nsBarsMask[i] = 1;
    }
  }

  return { sectorIdGrid, sectorDefs, nsBarsMask };
}

/**
 * Planifica e inserta los 5 distritos funcionales no-cuadrados en orden estricto
 * (port exacto de 09_city_world_engine.py L3172-3686).
 */
export function planFunctionalDistricts(
  spec: CityScaleSpec,
  dna: CityDnaProfile,
  sil: SynthesizedSilhouetteResult,
  skel: ArterialSkeletonResult,
  masks: UrbanContainmentMasks,
  originGlobalX: number,
  originGlobalY: number,
  cellFlags: Uint8Array
): FunctionalDistrictsPlanResult {
  const { width, height, dryMunicipalityMask, portCoastMask } = masks;
  const { inlandMask, rbtCenterX, rbtCenterY, rbtRadius } = sil;
  const { roadMask, beltwayMask, rbtProtectedMask, approachProtectedMask, mainHubPt } = skel;

  const partition = partitionUrbanSectors(spec, dna, sil, masks);
  const buildingsByLocalIdx = new Map<number, UrbanBuildingPlacement>();
  const buildingsMask = new Uint8Array(width * height);
  const blockedDistMask = new Uint8Array(width * height);
  const runwayClearMask = new Uint8Array(width * height);
  const flightCorridorExclMask = new Uint8Array(width * height);
  const portBeltwayNearMask = new Uint8Array(width * height);
  const usedMask = new Uint8Array(width * height);
  const districtGrid = new Int32Array(width * height);
  const districtLegend: DistrictLegendEntry[] = [];

  const registerRectInDistrictGrid = (
    archetype: string,
    tag: string,
    x0: number,
    y0: number,
    x1: number,
    y1: number
  ): void => {
    const dIdx = districtLegend.length + 1;
    let painted = 0;
    for (let yy = Math.max(0, y0); yy <= Math.min(height - 1, y1); yy++) {
      for (let xx = Math.max(0, x0); xx <= Math.min(width - 1, x1); xx++) {
        const idx = yy * width + xx;
        if (districtGrid[idx] === 0 && (inlandMask[idx] || buildingsMask[idx])) {
          districtGrid[idx] = dIdx;
          painted++;
        }
      }
    }
    if (painted > 0) {
      districtLegend.push({ dIdx, tag, kind: 'functional', archetype });
    }
  };

  for (let i = 0; i < width * height; i++) {
    if (rbtProtectedMask[i]) {
      usedMask[i] = 1;
      blockedDistMask[i] = 1;
    }
    if (approachProtectedMask[i]) {
      blockedDistMask[i] = 1;
    }
  }

  const districts: FunctionalDistrictRecord[] = [];
  const seed = detHashInt(originGlobalX, originGlobalY, 901);

  const safePlaceNeutralBuilding = (
    bx: number,
    by: number,
    rawType: InitialNeutralBuildingType,
    districtId: string,
    allowDowngrade: boolean = true
  ): UrbanBuildingPlacement | null => {
    if (bx < 2 || bx >= width - 2 || by < 2 || by >= height - 2) return null;
    const idx = by * width + bx;
    if (!dryMunicipalityMask[idx] || buildingsMask[idx]) return null;

    let bt = rawType;
    if (AWBW_BUILDING_OVERHANG_PX[bt] >= 8) {
      const northIdx = (by - 1) * width + bx;
      if (buildingsMask[northIdx]) {
        if (allowDowngrade) bt = 'city';
        else return null;
      }
    }
    const southB = buildingsByLocalIdx.get((by + 1) * width + bx);
    if (southB && southB.overhangPx >= 8) return null;

    const variant: 0 | 1 =
      (spec.tierId === 'T5_METROPOLIS_X3' || spec.tierId === 'T4_CONURBATION_X2') &&
      bt === 'city' &&
      (detHashInt(bx, by, seed) & 1) === 1
        ? 1
        : 0;

    const placement: UrbanBuildingPlacement = {
      localX: bx,
      localY: by,
      globalX: originGlobalX + bx,
      globalY: originGlobalY + by,
      type: bt,
      ownerId: null,
      overhangPx: AWBW_BUILDING_OVERHANG_PX[bt],
      neutralSkinVariant: variant,
      districtId,
    };
    buildingsByLocalIdx.set(idx, placement);
    buildingsMask[idx] = 1;
    usedMask[idx] = 1;
    cellFlags[idx] &= ~URBAN_CELL_BIT_PARK;
    return placement;
  };

  const paintPark = (px: number, py: number): boolean => {
    if (px < 1 || px >= width - 1 || py < 1 || py >= height - 1) return false;
    const idx = py * width + px;
    if (!inlandMask[idx] || roadMask[idx] || buildingsMask[idx]) return false;
    cellFlags[idx] |= URBAN_CELL_BIT_PARK;
    usedMask[idx] = 1;
    return true;
  };

  const canPlaceRectStrip = (
    rx0: number,
    ry0: number,
    rw: number,
    rh: number,
    allowCoastBorder: boolean = false
  ): boolean => {
    for (let yy = ry0 - 1; yy <= ry0 + rh; yy++) {
      for (let xx = rx0 - 1; xx <= rx0 + rw; xx++) {
        if (xx < 2 || xx >= width - 2 || yy < 2 || yy >= height - 2) return false;
        const idx = yy * width + xx;
        const inCore = xx >= rx0 && xx < rx0 + rw && yy >= ry0 && yy < ry0 + rh;
        if (inCore) {
          if (!inlandMask[idx] || blockedDistMask[idx]) return false;
          if (buildingsMask[idx] || roadMask[idx] || usedMask[idx]) return false;
        } else {
          if (buildingsMask[idx]) return false;
          if (!allowCoastBorder && !inlandMask[idx]) return false;
          // Prevenir bloques 2x2 paralelos al borde de la tira
          if (roadMask[idx]) {
            if ((yy === ry0 - 1 || yy === ry0 + rh) && xx >= rx0 && xx < rx0 + rw) {
              if (xx + 1 < rx0 + rw && roadMask[yy * width + xx + 1]) return false;
            }
            if ((xx === rx0 - 1 || xx === rx0 + rw) && yy >= ry0 && yy < ry0 + rh) {
              if (yy + 1 < ry0 + rh && roadMask[(yy + 1) * width + xx]) return false;
            }
          }
        }
      }
    }
    return true;
  };

  let minInX = width;
  let maxInX = 0;
  let minInY = height;
  let maxInY = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (inlandMask[y * width + x]) {
        if (x < minInX) minInX = x;
        if (x > maxInX) maxInX = x;
        if (y < minInY) minInY = y;
        if (y > maxInY) maxInY = y;
      }
    }
  }

  const findStripSlot = (
    rw: number,
    rh: number,
    targetX: number,
    targetY: number,
    allowEdge: boolean = false,
    allowNsOverlap: boolean = true
  ): [number, number] | null => {
    let bestScore = Infinity;
    let best: [number, number] | null = null;
    const yStart = Math.max(3, minInY + 1);
    const yEnd = Math.min(height - rh - 3, maxInY - rh + 1);
    const xStart = Math.max(3, minInX + 1);
    const xEnd = Math.min(width - rw - 3, maxInX - rw + 1);

    for (let y0 = yStart; y0 <= yEnd; y0++) {
      for (let x0 = xStart; x0 <= xEnd; x0++) {
        if (!canPlaceRectStrip(x0, y0, rw, rh, allowEdge)) continue;
        let nsOv = 0;
        for (let yy = y0; yy < y0 + rh; yy++) {
          for (let xx = x0; xx < x0 + rw; xx++) {
            if (partition.nsBarsMask[yy * width + xx]) nsOv++;
          }
        }
        if (!allowNsOverlap && nsOv > 0) continue;
        const sc = Math.hypot(x0 + rw * 0.5 - targetX, y0 + rh * 0.5 - targetY) + nsOv * 12.0;
        if (sc < bestScore) {
          bestScore = sc;
          best = [x0, y0];
        }
      }
    }
    return best;
  };

  const stampRectRoadRing = (rx0: number, ry0: number, rw: number, rh: number): void => {
    for (let yy = ry0; yy < ry0 + rh; yy++) {
      for (let xx = rx0; xx < rx0 + rw; xx++) {
        const idx = yy * width + xx;
        usedMask[idx] = 1;
        blockedDistMask[idx] = 1;
        if (yy === ry0 || yy === ry0 + rh - 1 || xx === rx0 || xx === rx0 + rw - 1) {
          if (!roadMask[idx] && !wouldMake2x2(roadMask, width, height, xx, yy)) {
            roadMask[idx] = 1;
            cellFlags[idx] |= URBAN_CELL_BIT_ROAD;
          }
        }
      }
    }
    // Conectar 2 esquinas opuestas al grafo principal
    const corners: Array<[number, number]> = [
      [rx0, ry0],
      [rx0 + rw - 1, ry0 + rh - 1],
    ];
    for (const anchor of corners) {
      const { labels } = connectedComponents4(roadMask, width, height);
      const mainCid = labels[mainHubPt[1] * width + mainHubPt[0]];
      if (mainCid > 0 && labels[anchor[1] * width + anchor[0]] !== mainCid) {
        const mainMask = new Uint8Array(width * height);
        for (let i = 0; i < mainMask.length; i++) if (labels[i] === mainCid) mainMask[i] = 1;
        const pts = trace4ConnNo2x2(
          roadMask,
          width,
          height,
          anchor,
          [rbtCenterX, rbtCenterY],
          inlandMask,
          approachProtectedMask,
          mainMask
        );
        if (pts) {
          for (const [px, py] of pts) {
            const pIdx = py * width + px;
            if (!roadMask[pIdx] && !wouldMake2x2(roadMask, width, height, px, py)) {
              roadMask[pIdx] = 1;
              cellFlags[pIdx] |= URBAN_CELL_BIT_ROAD;
            }
          }
        }
      }
    }
  };

  const distOri = (name: FunctionalDistrictArchetypeId): DistrictOrientationId =>
    dna.perDistrictOrientation[name] ?? dna.defaultOrientation;

  // ---------------------------------------------------------------------------
  // 5a. WATERFRONT PORT (L3286-3395) — acepta celdas costeras tocando inlandMask a distancia <= 1
  // ---------------------------------------------------------------------------
  const targetPorts = spec.neutralBuildings.port;
  if (spec.waterfrontDir !== 'none' && targetPorts > 0) {
    const portCands: Array<[number, number]> = [];
    for (let y = 2; y < height - 2; y++) {
      for (let x = 2; x < width - 2; x++) {
        const idx = y * width + x;
        if (!portCoastMask[idx] || usedMask[idx] || approachProtectedMask[idx]) continue;
        const nearInland =
          inlandMask[idx] ||
          CARDINAL_DIRS.some(([dx, dy]) => inlandMask[(y + dy) * width + (x + dx)] !== 0);
        if (nearInland) portCands.push([x, y]);
      }
    }
    const chosen: Array<[number, number]> = [];
    const minSep = targetPorts >= 4 ? 4 : 2;
    for (const pt of portCands) {
      if (chosen.length >= targetPorts) break;
      if (chosen.every((c) => Math.hypot(c[0] - pt[0], c[1] - pt[1]) >= minSep)) {
        chosen.push(pt);
      }
    }
    let portCount = 0;
    let wfMinX = width;
    let wfMaxX = -1;
    let wfMinY = height;
    let wfMaxY = -1;
    const inDx = spec.waterfrontDir === 'W' ? 1 : spec.waterfrontDir === 'E' ? -1 : 0;
    const inDy = spec.waterfrontDir === 'N' ? 1 : spec.waterfrontDir === 'S' ? -1 : 0;
    for (const [lx, py] of chosen) {
      const idx = py * width + lx;
      roadMask[idx] = 0;
      beltwayMask[idx] = 0;
      cellFlags[idx] &= ~(URBAN_CELL_BIT_ROAD | URBAN_CELL_BIT_BELTWAY);
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const nx = lx + dx;
          const ny = py + dy;
          if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
            portBeltwayNearMask[ny * width + nx] = 1;
          }
        }
      }
      // Paseo interior adyacente
      for (let step = -1; step <= 1; step++) {
        const pxp = lx + inDx + (inDx === 0 ? step : 0);
        const pyp = py + inDy + (inDy === 0 ? step : 0);
        if (pxp >= 1 && pxp < width - 1 && pyp >= 1 && pyp < height - 1) {
          const pIdx = pyp * width + pxp;
          if (dryMunicipalityMask[pIdx] && !buildingsMask[pIdx] && !roadMask[pIdx] && !wouldMake2x2(roadMask, width, height, pxp, pyp)) {
            roadMask[pIdx] = 1;
            cellFlags[pIdx] |= URBAN_CELL_BIT_ROAD;
          }
          usedMask[pIdx] = 1;
        }
      }
      const bPort = safePlaceNeutralBuilding(lx, py, 'port', 'waterfront_port', false);
      if (bPort) {
        cellFlags[idx] |= URBAN_CELL_BIT_PORT_WATER;
        blockedDistMask[idx] = 1;
        portCount++;
        if (lx < wfMinX) wfMinX = lx;
        if (lx > wfMaxX) wfMaxX = lx;
        if (py < wfMinY) wfMinY = py;
        if (py > wfMaxY) wfMaxY = py;
      }
      // Almacén interior (pier_width >= 2)
      const wxL = lx + 2 * inDx;
      const wyL = py + 2 * inDy;
      if (wxL >= 2 && wxL < width - 2 && wyL >= 2 && wyL < height - 2) {
        const wIdx = wyL * width + wxL;
        if (inlandMask[wIdx] && !usedMask[wIdx] && !roadMask[wIdx] && !blockedDistMask[wIdx]) {
          const bWh = safePlaceNeutralBuilding(wxL, wyL, 'factory', 'waterfront_port', true);
          if (bWh) {
            blockedDistMask[wIdx] = 1;
            portCount++;
            if (wxL < wfMinX) wfMinX = wxL;
            if (wxL > wfMaxX) wfMaxX = wxL;
            if (wyL < wfMinY) wfMinY = wyL;
            if (wyL > wfMaxY) wfMaxY = wyL;
          }
        }
      }
    }
    if (portCount > 0 && wfMaxX >= wfMinX && wfMaxY >= wfMinY) {
      registerRectInDistrictGrid('waterfront_port', 'WATERFRON [steppe]', wfMinX - 1, wfMinY - 1, wfMaxX + 1, wfMaxY + 1);
      districts.push({
        id: `d_${spec.cityId}_waterfront_port`,
        archetype: 'waterfront_port',
        orientation: 'COASTAL_ARC',
        bbox: [Math.max(1, wfMinX - 1), Math.max(1, wfMinY - 1), Math.min(width - 2, wfMaxX + 1), Math.min(height - 2, wfMaxY + 1)],
        buildingCount: portCount,
        parkCount: 0,
      });
    }
  }

  // ---------------------------------------------------------------------------
  // 5b. AIR HUB (x2/x3/x4/x5, L3405-3496)
  // ---------------------------------------------------------------------------
  const isLargeCore =
    spec.engineScale === 'x5' ||
    spec.engineScale === 'x4' ||
    spec.engineScale === 'x3';
  if (isLargeCore || spec.engineScale === 'x2') {
    let airOri = distOri('air_hub');
    if (airOri === 'BLOCK_INTEGRATED') airOri = 'EW';
    const airLen = isLargeCore ? 12 : 10;
    const airOffX = spec.waterfrontDir === 'E' ? -12 : 12;
    let airSlot: [number, number] | null = null;
    let airW = airLen;
    let airH = 4;

    const tryDims: Array<[number, number, DistrictOrientationId]> =
      airOri === 'NS'
        ? [
            [4, airLen, 'NS'],
            [4, 9, 'NS'],
            [4, 8, 'NS'],
            [airLen, 4, 'EW'],
            [8, 4, 'EW'],
            [7, 4, 'EW'],
          ]
        : [
            [airLen, 4, 'EW'],
            [9, 4, 'EW'],
            [8, 4, 'EW'],
            [7, 4, 'EW'],
            [4, 8, 'NS'],
          ];

    for (const allowEdge of [false, true]) {
      if (airSlot) break;
      for (const [cw, ch, ori] of tryDims) {
        const cand = findStripSlot(cw, ch, rbtCenterX + airOffX, rbtCenterY, allowEdge);
        if (cand) {
          airSlot = cand;
          airW = cw;
          airH = ch;
          airOri = ori;
          break;
        }
      }
    }

    if (airSlot) {
      const [ax0, ay0] = airSlot;
      stampRectRoadRing(ax0, ay0, airW, airH);
      let airB = 0;
      if (airOri === 'NS') {
        for (let idxA = 0, yy = ay0 + 1; yy < ay0 + airH - 1; idxA++, yy++) {
          if (idxA === 0 || idxA === 4) {
            if (safePlaceNeutralBuilding(ax0 + 1, yy, 'airport', 'air_hub')) airB++;
          } else if (idxA === 2 || idxA === (airH <= 8 ? 3 : 6)) {
            if (safePlaceNeutralBuilding(ax0 + 1, yy, 'factory', 'air_hub')) airB++;
          } else if (idxA === airH - 3 && spec.engineScale === 'x3') {
            if (safePlaceNeutralBuilding(ax0 + 1, yy, 'city', 'air_hub')) airB++;
          }
          runwayClearMask[yy * width + (ax0 + 2)] = 1;
          blockedDistMask[yy * width + (ax0 + 2)] = 1;
        }
        // Corredor aéreo de 6 tiles delante y detrás de la pista NS (L3465-3467)
        for (let yy = Math.max(0, ay0 - 6); yy < Math.min(height, ay0 + airH + 6); yy++) {
          for (let xx = Math.max(0, ax0); xx < Math.min(width, ax0 + 4); xx++) {
            flightCorridorExclMask[yy * width + xx] = 1;
          }
        }
      } else {
        for (let idxA = 0, xx = ax0 + 1; xx < ax0 + airW - 1; idxA++, xx++) {
          if (idxA === 0 || idxA === 4) {
            if (safePlaceNeutralBuilding(xx, ay0 + 1, 'airport', 'air_hub')) airB++;
          } else if (idxA === 2 || idxA === (airW <= 8 ? 3 : 6)) {
            if (safePlaceNeutralBuilding(xx, ay0 + 1, 'factory', 'air_hub')) airB++;
          } else if (idxA === airW - 3 && isLargeCore) {
            if (safePlaceNeutralBuilding(xx, ay0 + 1, 'city', 'air_hub')) airB++;
          }
          runwayClearMask[(ay0 + 2) * width + xx] = 1;
          blockedDistMask[(ay0 + 2) * width + xx] = 1;
        }
        // Corredor aéreo de 6 tiles delante y detrás de la pista EW (L3489-3491)
        for (let yy = Math.max(0, ay0); yy < Math.min(height, ay0 + 4); yy++) {
          for (let xx = Math.max(0, ax0 - 6); xx < Math.min(width, ax0 + airW + 6); xx++) {
            flightCorridorExclMask[yy * width + xx] = 1;
          }
        }
      }
      registerRectInDistrictGrid(
        'air_hub',
        airOri === 'NS' ? 'AIR_HUB [ns_run]' : 'AIR_HUB [runway]',
        ax0,
        ay0,
        ax0 + airW - 1,
        ay0 + airH - 1
      );
      districts.push({
        id: `d_${spec.cityId}_air_hub`,
        archetype: 'air_hub',
        orientation: airOri,
        bbox: [ax0, ay0, ax0 + airW - 1, ay0 + airH - 1],
        buildingCount: airB,
        parkCount: 0,
      });
    }
  }

  // ---------------------------------------------------------------------------
  // 5c. CIVIC CORE (L3498-3565)
  // ---------------------------------------------------------------------------
  {
    let civOri = distOri('civic_core');
    const civLen = spec.engineScale === 'x3' ? 11 : 9;
    let civW = civOri === 'NS' ? 3 : civOri === 'L_SHAPED' ? (spec.engineScale === 'x3' ? 8 : 7) : civLen;
    let civH = civOri === 'NS' ? civLen : civOri === 'L_SHAPED' ? 4 : 3;
    const civTargetX = rbtCenterX - Math.floor(civW / 2);
    const civTargetY = rbtCenterY - rbtRadius - 4;
    let civSlot = findStripSlot(civW, civH, civTargetX, civTargetY, false);
    if (!civSlot) civSlot = findStripSlot(civW, civH, rbtCenterX, rbtCenterY - 4, false);
    if (!civSlot) {
      for (const [cw, ch, fOri] of [
        [9, 3, 'EW'],
        [7, 3, 'EW'],
        [5, 3, 'EW'],
        [3, 9, 'NS'],
        [3, 7, 'NS'],
        [3, 5, 'NS'],
      ] as const) {
        civSlot = findStripSlot(cw, ch, rbtCenterX, rbtCenterY, true);
        if (civSlot) {
          civW = cw;
          civH = ch;
          civOri = fOri;
          break;
        }
      }
    }
    if (civSlot) {
      const [cx0, cy0] = civSlot;
      stampRectRoadRing(cx0, cy0, civW, civH);
      let civB = 0;
      let civP = 0;
      if (civOri === 'NS') {
        for (let yy = cy0 + 1; yy < cy0 + civH - 1; yy++) {
          if (yy === cy0 + 1) {
            if (safePlaceNeutralBuilding(cx0 + 1, yy, 'hq', 'civic_core', false)) civB++;
          } else if (yy === cy0 + 2) {
            if (paintPark(cx0 + 1, yy)) civP++;
          } else if (safePlaceNeutralBuilding(cx0 + 1, yy, 'city', 'civic_core')) {
            civB++;
          }
        }
      } else {
        const midX = cx0 + Math.floor(civW / 2);
        for (let xx = cx0 + 1; xx < cx0 + civW - 1; xx++) {
          if (xx === midX) {
            if (safePlaceNeutralBuilding(xx, cy0 + 1, 'hq', 'civic_core', false)) civB++;
          } else if (Math.abs(xx - midX) === 1) {
            if (paintPark(xx, cy0 + 1)) civP++;
          } else if (safePlaceNeutralBuilding(xx, cy0 + 1, 'city', 'civic_core')) {
            civB++;
          }
          if (civH >= 4) {
            if (
              (xx === cx0 + 1 || xx === cx0 + civW - 2) &&
              !buildingsMask[(cy0 + 1) * width + xx]
            ) {
              if (safePlaceNeutralBuilding(xx, cy0 + 2, 'city', 'civic_core')) civB++;
            } else if (paintPark(xx, cy0 + 2)) {
              civP++;
            }
          }
        }
      }
      registerRectInDistrictGrid(
        'civic_core',
        civOri === 'NS' ? 'CIVIC_COR [ns_esp]' : 'CIVIC_COR [elonga]',
        cx0,
        cy0,
        cx0 + civW - 1,
        cy0 + civH - 1
      );
      districts.push({
        id: `d_${spec.cityId}_civic_core`,
        archetype: 'civic_core',
        orientation: civOri,
        bbox: [cx0, cy0, cx0 + civW - 1, cy0 + civH - 1],
        buildingCount: civB,
        parkCount: civP,
      });
    }
  }

  // ---------------------------------------------------------------------------
  // 5d. INDUSTRIAL LOGISTICS PARK (L3567-3648)
  // ---------------------------------------------------------------------------
  {
    const indOri = distOri('industrial_logistics_park');
    const indCands: Array<[number, number]> =
      indOri === 'NS'
        ? spec.engineScale === 'x3'
          ? [[4, 13], [4, 11], [3, 9], [9, 4], [7, 3]]
          : spec.engineScale === 'x2'
          ? [[4, 11], [3, 9], [9, 4], [7, 3]]
          : [[3, 7], [7, 3], [5, 3]]
        : spec.engineScale === 'x3'
        ? [[15, 4], [13, 4], [11, 4], [9, 4], [7, 3]]
        : spec.engineScale === 'x2'
        ? [[11, 4], [9, 4], [9, 3], [7, 3]]
        : [[7, 3], [5, 3]];

    let indSlot: [number, number] | null = null;
    let indW = indCands[0][0];
    let indH = indCands[0][1];
    for (const allowNs of [false, true]) {
      if (indSlot) break;
      for (const allowEdge of [false, true]) {
        if (indSlot) break;
        for (const [cw, ch] of indCands) {
          const cand = findStripSlot(cw, ch, rbtCenterX - 10, rbtCenterY - 10, allowEdge, allowNs);
          if (cand) {
            indSlot = cand;
            indW = cw;
            indH = ch;
            break;
          }
        }
      }
    }
    if (indSlot) {
      const [ix0, iy0] = indSlot;
      stampRectRoadRing(ix0, iy0, indW, indH);
      const roster: InitialNeutralBuildingType[] = [
        'factory',
        'factory',
        'silo',
        'factory',
        'usedSilo',
        'factory',
        'silo',
        'factory',
        'usedSilo',
        'factory',
      ];
      let slotI = 0;
      let indB = 0;
      let indP = 0;
      if (indH > indW) {
        for (let idxR = 0, yy = iy0 + 1; yy < iy0 + indH - 1; idxR++, yy++) {
          if (idxR % 2 === 0 && slotI < roster.length) {
            if (safePlaceNeutralBuilding(ix0 + 1, yy, roster[slotI++], 'industrial_logistics_park')) {
              indB++;
            }
          } else if (paintPark(ix0 + 1, yy)) {
            indP++;
          }
          if (indW >= 4) {
            if (yy === iy0 + Math.floor(indH / 2) && !wouldMake2x2(roadMask, width, height, ix0 + 2, yy)) {
              roadMask[yy * width + ix0 + 2] = 1;
              cellFlags[yy * width + ix0 + 2] |= URBAN_CELL_BIT_ROAD;
            } else if (paintPark(ix0 + 2, yy)) {
              indP++;
            }
          }
        }
      } else {
        for (let xx = ix0 + 1; xx < ix0 + indW - 1; xx++) {
          if (slotI < roster.length) {
            if (safePlaceNeutralBuilding(xx, iy0 + 1, roster[slotI++], 'industrial_logistics_park')) {
              indB++;
            }
          } else if (indH >= 4 && paintPark(xx, iy0 + 1)) {
            indP++;
          }
          if (indH >= 4) {
            if (xx === ix0 + Math.floor(indW / 2) && !wouldMake2x2(roadMask, width, height, xx, iy0 + 2)) {
              roadMask[(iy0 + 2) * width + xx] = 1;
              cellFlags[(iy0 + 2) * width + xx] |= URBAN_CELL_BIT_ROAD;
            } else if (paintPark(xx, iy0 + 2)) {
              indP++;
            }
          }
        }
      }
      registerRectInDistrictGrid(
        'industrial_logistics_park',
        indH > indW ? 'INDUSTRIA [ns_frg]' : 'INDUSTRIA [freigh]',
        ix0,
        iy0,
        ix0 + indW - 1,
        iy0 + indH - 1
      );
      districts.push({
        id: `d_${spec.cityId}_industrial_logistics_park`,
        archetype: 'industrial_logistics_park',
        orientation: indH > indW ? 'NS' : 'EW',
        bbox: [ix0, iy0, ix0 + indW - 1, iy0 + indH - 1],
        buildingCount: indB,
        parkCount: indP,
      });
    }
  }

  // ---------------------------------------------------------------------------
  // 5e. SCIENCE CAMPUS (x2/x3/x4/x5, L3650-3682)
  // ---------------------------------------------------------------------------
  if (isLargeCore || spec.engineScale === 'x2') {
    let sciW = isLargeCore ? 9 : 7;
    let sciSlot = findStripSlot(sciW, 4, rbtCenterX + 10, rbtCenterY - 12, false);
    if (!sciSlot) {
      sciSlot = findStripSlot(sciW, 4, rbtCenterX + 8, rbtCenterY + 8, true);
    }
    if (!sciSlot) {
      sciW = 5;
      sciSlot = findStripSlot(5, 4, rbtCenterX, rbtCenterY, true);
    }
    if (sciSlot) {
      const [sx0, sy0] = sciSlot;
      stampRectRoadRing(sx0, sy0, sciW, 4);
      const row1: InitialNeutralBuildingType[] = ['lab', 'commtower', 'city', 'lab', 'commtower', 'city', 'lab'];
      let sciB = 0;
      let sciP = 0;
      for (let idxS = 0, xx = sx0 + 1; xx < sx0 + sciW - 1; idxS++, xx++) {
        const bt = row1[idxS % row1.length];
        if ((idxS === 2 || idxS === 4) && bt === 'city' && spec.engineScale === 'x2') {
          if (paintPark(xx, sy0 + 1)) sciP++;
        } else if (safePlaceNeutralBuilding(xx, sy0 + 1, bt, 'science_campus')) {
          sciB++;
        }
        if ((idxS === 0 || idxS === sciW - 3) && !buildingsMask[(sy0 + 1) * width + xx]) {
          if (safePlaceNeutralBuilding(xx, sy0 + 2, 'city', 'science_campus')) sciB++;
        } else if (paintPark(xx, sy0 + 2)) {
          sciP++;
        }
      }
      registerRectInDistrictGrid('science_campus', 'SCIENCE_C [u_cour]', sx0, sy0, sx0 + sciW - 1, sy0 + 3);
      districts.push({
        id: `d_${spec.cityId}_science_campus`,
        archetype: 'science_campus',
        orientation: 'BLOCK_INTEGRATED',
        bbox: [sx0, sy0, sx0 + sciW - 1, sy0 + 3],
        buildingCount: sciB,
        parkCount: sciP,
      });
    }
  }

  return {
    partition,
    buildingsByLocalIdx,
    buildingsMask,
    blockedDistMask,
    runwayClearMask,
    flightCorridorExclMask,
    portBeltwayNearMask,
    usedMask,
    districtGrid,
    districtLegend,
    districts,
  };
}
