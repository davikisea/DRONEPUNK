/**
 * ==============================================================================
 * 9 GRAMÁTICAS MICRO-GRAIN, FASE 7 (MAX_EMPTY_SQUARE <= 3) Y K-CORE TOPOLÓGICO
 * ==============================================================================
 * Port 100 % fiel de 09_city_world_engine.py (v6.0.0-awbw, L3687-4165):
 * - 9 gramáticas micro_grain acotadas a [qx0..qx1, qy0..qy1] por sector
 * - Reconexión de componentes desconectadas (trace4ConnNo2x2)
 * - Cierre de bucles (closeLoopFromDeg1, max_len=8) en vez de poda ciega
 * - Fase 7a (cuota por cuadrante + ~12.5% parques), Fase 7b (min_fill),
 *   Fase 7c (maxEmptySquareSide(plainInt) <= 3)
 * - K-Core final en ventana completa: 0 dead-ends, 0 blobs 2x2, 100% edificios
 *   conectados y 100% GRISES NEUTRALES (ownerId: null)
 * - Corona de árboles periurbana (URBAN_CELL_BIT_TREE_CROWN)
 * ==============================================================================
 */

import {
  AWBW_BUILDING_OVERHANG_PX,
  URBAN_CELL_BIT_BELTWAY,
  URBAN_CELL_BIT_BRIDGE,
  URBAN_CELL_BIT_PARK,
  URBAN_CELL_BIT_ROAD,
  URBAN_CELL_BIT_TREE_CROWN,
  URBAN_CELL_BIT_YELLOW_TRUNK,
  type CityScaleSpec,
  type DistrictLegendEntry,
  type FuturePortPlotRecord,
  type InitialNeutralBuildingType,
  type InterchangeArrowRecord,
  type ResidentialSectorRecord,
  type UrbanBuildingPlacement,
  type WaterfrontDirection,
} from '../types/urbanMorphologyTypes';
import type { UrbanContainmentMasks } from './urbanContainmentMasks';
import type {
  ArterialSkeletonResult,
  SynthesizedSilhouetteResult,
} from './urbanSilhouetteAndSkeleton';
import type { FunctionalDistrictsPlanResult } from './urbanDistrictPlanner';
import {
  bfsDistance,
  CARDINAL_DIRS,
  closeLoopFromDeg1,
  connectedComponents4,
  count2x2Blobs,
  detHashInt,
  extractThinRing,
  keepOnly3x3Blocks,
  maxEmptySquareSide,
  orthoDegree,
  peel2x2,
  trace4ConnNo2x2,
  wouldMake2x2,
} from './urbanMorphologyPrimitives';

export interface GrainAndInfillResult {
  readonly tallOverhangViolations: number;
  readonly remainingDeadEnds: number;
  readonly maxEmptySquareSideValue: number;
  readonly distinctMicroGrainsCount: number;
  readonly residentialDistricts: ResidentialSectorRecord[];
  readonly districtGrid: Int32Array;
  readonly districtLegend: DistrictLegendEntry[];
  readonly expansionZoneMask: Uint8Array;
  readonly validatedInterchangeArrows: InterchangeArrowRecord[];
  readonly futurePortPlots: FuturePortPlotRecord[];
}

/**
 * Ejecuta Etapa 6 (9 micro-grains acotados por sector), Etapa 7 (relleno residencial
 * + parques + max_empty_square_side <= 3), Etapa 8 (k-core topológico y rescate
 * de edificios) y corona periurbana de árboles.
 */
export function populateMicroGrainsInfillAndKCore(
  spec: CityScaleSpec,
  sil: SynthesizedSilhouetteResult,
  skel: ArterialSkeletonResult,
  plan: FunctionalDistrictsPlanResult,
  masks: UrbanContainmentMasks,
  originGlobalX: number,
  originGlobalY: number,
  cellFlags: Uint8Array
): GrainAndInfillResult {
  const { width, height, dryMunicipalityMask } = masks;
  const { inlandMask, rbtCenterX, rbtCenterY } = sil;
  const { roadMask, beltwayMask, rbtProtectedMask, approachProtectedMask, mainHubPt, pMerge } = skel;
  const {
    partition,
    buildingsByLocalIdx,
    buildingsMask,
    blockedDistMask,
    runwayClearMask,
    usedMask,
  } = plan;

  const seed = detHashInt(originGlobalX, originGlobalY, 1337);
  const paintPark = (px: number, py: number): boolean => {
    if (px < 1 || px >= width - 1 || py < 1 || py >= height - 1) return false;
    const idx = py * width + px;
    if (!inlandMask[idx] || roadMask[idx] || buildingsMask[idx]) return false;
    cellFlags[idx] |= URBAN_CELL_BIT_PARK;
    usedMask[idx] = 1;
    return true;
  };

  // ---------------------------------------------------------------------------
  // 6. 9 GRAMÁTICAS MICRO-GRAIN POR SECTOR (L3687-3855)
  // ---------------------------------------------------------------------------
  const usedGrains = new Set<string>();
  const { sectorIdGrid, sectorDefs } = partition;

  for (let sIdx = 0; sIdx < sectorDefs.length; sIdx++) {
    const { grain } = sectorDefs[sIdx];
    const qMask = new Uint8Array(width * height);
    const qAllowed = new Uint8Array(width * height);
    let qx0 = width;
    let qx1 = -1;
    let qy0 = height;
    let qy1 = -1;
    let allowedCnt = 0;

    for (let y = 2; y < height - 2; y++) {
      const r = y * width;
      for (let x = 2; x < width - 2; x++) {
        const idx = r + x;
        if (sectorIdGrid[idx] !== sIdx || !inlandMask[idx]) continue;
        qMask[idx] = 1;
        if (
          !blockedDistMask[idx] &&
          !rbtProtectedMask[idx] &&
          !approachProtectedMask[idx] &&
          !buildingsMask[idx]
        ) {
          qAllowed[idx] = 1;
          allowedCnt++;
          if (x < qx0) qx0 = x;
          if (x > qx1) qx1 = x;
          if (y < qy0) qy0 = y;
          if (y > qy1) qy1 = y;
        }
      }
    }

    if (allowedCnt < 6 || qx1 < qx0 || qy1 < qy0) continue;
    usedGrains.add(grain);

    const candPts: Array<[number, number]> = [];
    if (grain === 'curved_arc') {
      for (const rArc of [6.5, 10.0, 13.5, 17.0, 20.5, 24.0]) {
        const side = new Uint8Array(width * height);
        for (let y = qy0; y <= qy1; y++) {
          for (let x = qx0; x <= qx1; x++) {
            const idx = y * width + x;
            if (qMask[idx] && Math.hypot((x - rbtCenterX) * 0.9, (y - rbtCenterY) * 1.1) <= rArc) {
              side[idx] = 1;
            }
          }
        }
        const arc = extractThinRing(side, width, height);
        for (let y = qy0; y <= qy1; y++) {
          for (let x = qx0; x <= qx1; x++) {
            if (arc[y * width + x] && qAllowed[y * width + x]) candPts.push([x, y]);
          }
        }
      }
      for (let col = qx0 + 2; col < qx1; col += 5) {
        for (let row = qy0; row <= qy1; row++) candPts.push([col, row]);
      }
    } else if (grain === 'diagonal_terrace') {
      for (let off = -36; off < 40; off += 5) {
        for (let row = qy0; row <= qy1; row++) {
          const col = qx0 + (row - qy0) + off;
          candPts.push([col, row], [col + 1, row]);
        }
      }
      for (let row = qy0 + 2; row < qy1; row += 5) {
        for (let col = qx0; col <= qx1; col++) candPts.push([col, row]);
      }
    } else if (grain === 'ns_bars') {
      for (let col = qx0 + 2; col < qx1; col += 2) {
        for (let row = qy0; row <= qy1; row++) candPts.push([col, row]);
      }
    } else if (grain === 'ew_bars') {
      for (let row = qy0 + 2; row < qy1; row += 2) {
        for (let col = qx0; col <= qx1; col++) candPts.push([col, row]);
      }
    } else if (grain === 'superblock_central_park') {
      for (let row = qy0 + 2; row < qy1; row += 5) {
        for (let col = qx0; col <= qx1; col++) candPts.push([col, row]);
      }
      for (let col = qx0 + 2; col < qx1; col += 5) {
        for (let row = qy0; row <= qy1; row++) candPts.push([col, row]);
      }
      for (let row = qy0 + 4; row < qy1; row += 5) {
        for (let col = qx0 + 4; col < qx1; col += 5) {
          if (qAllowed[row * width + col]) paintPark(col, row);
        }
      }
    } else if (grain === 'courtyard_cloisters') {
      for (let row = qy0 + 2; row < qy1; row += 4) {
        for (let col = qx0; col <= qx1; col++) candPts.push([col, row]);
      }
      for (let col = qx0 + 2; col < qx1; col += 4) {
        for (let row = qy0; row <= qy1; row++) candPts.push([col, row]);
      }
      for (let row = qy0 + 3; row < qy1; row += 4) {
        for (let col = qx0 + 3; col < qx1; col += 4) {
          if (qAllowed[row * width + col]) paintPark(col, row);
        }
      }
    } else if (grain === 'comb_piers') {
      for (let row = qy0 + 2; row < qy1; row += 3) {
        for (let col = qx0; col <= qx1; col++) candPts.push([col, row]);
      }
      const midC = Math.floor((qx0 + qx1) / 2);
      for (let row = qy0; row <= qy1; row++) candPts.push([midC, row]);
    } else if (grain === 'organic_loops') {
      let idxR = 0;
      for (let row = qy0 + 2; row < qy1; row += 3, idxR++) {
        for (let col = qx0 + (idxR % 2); col <= qx1; col++) candPts.push([col, row]);
      }
      let idxC = 0;
      for (let col = qx0 + 2; col < qx1; col += 4, idxC++) {
        for (let row = qy0 + (idxC % 2); row <= qy1; row++) candPts.push([col, row]);
      }
    } else {
      // divided_borough
      for (let row = qy0 + 2; row < qy1; row += 3) {
        for (let col = qx0 + 2; col <= qx1; col++) candPts.push([col, row]);
      }
      for (let col = qx0 + 2; col < qx1; col += 4) {
        for (let row = qy0 + 2; row <= qy1; row++) candPts.push([col, row]);
      }
    }

    for (let i = 0; i < candPts.length; i++) {
      const [rx, ry] = candPts[i];
      if (rx < 2 || rx >= width - 2 || ry < 2 || ry >= height - 2) continue;
      const idx = ry * width + rx;
      if (!qAllowed[idx] || roadMask[idx]) continue;
      if (!wouldMake2x2(roadMask, width, height, rx, ry)) {
        roadMask[idx] = 1;
        cellFlags[idx] |= URBAN_CELL_BIT_ROAD;
        cellFlags[idx] &= ~URBAN_CELL_BIT_PARK;
      }
    }

    // Reconexión de componentes desconectadas dentro del cuadrante (4 pasadas, L3806-3831)
    const allowConn = new Uint8Array(width * height);
    for (let i = 0; i < allowConn.length; i++) {
      if (inlandMask[i] && !blockedDistMask[i] && !rbtProtectedMask[i]) allowConn[i] = 1;
    }
    for (let pass = 0; pass < 4; pass++) {
      const { labels } = connectedComponents4(roadMask, width, height);
      const mainCid = labels[mainHubPt[1] * width + mainHubPt[0]];
      if (mainCid <= 0) break;
      const mainMask = new Uint8Array(width * height);
      for (let i = 0; i < mainMask.length; i++) if (labels[i] === mainCid) mainMask[i] = 1;

      const localCids = new Map<number, [number, number]>();
      for (let y = qy0; y <= qy1; y++) {
        for (let x = qx0; x <= qx1; x++) {
          const idx = y * width + x;
          if (!qMask[idx]) continue;
          const l = labels[idx];
          if (l > 0 && l !== mainCid && !localCids.has(l)) {
            localCids.set(l, [x, y]);
          }
        }
      }
      if (localCids.size === 0) break;
      for (const [, pt] of localCids.entries()) {
        const pts = trace4ConnNo2x2(
          roadMask,
          width,
          height,
          pt,
          [rbtCenterX, rbtCenterY],
          allowConn,
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

    // Cierre de puntas deg <= 1 dentro del sector antes de podar (8 pasadas, L3833-3855)
    const blockedUnion = new Uint8Array(width * height);
    for (let i = 0; i < blockedUnion.length; i++) {
      if (blockedDistMask[i] || rbtProtectedMask[i]) blockedUnion[i] = 1;
    }
    for (let pass = 0; pass < 8; pass++) {
      let changedQ = false;
      for (let ry = Math.max(2, qy0); ry <= Math.min(height - 3, qy1); ry++) {
        for (let rx = Math.max(2, qx0); rx <= Math.min(width - 3, qx1); rx++) {
          const idx = ry * width + rx;
          if (!roadMask[idx] || !qAllowed[idx] || beltwayMask[idx]) continue;
          if ((cellFlags[idx] & (URBAN_CELL_BIT_YELLOW_TRUNK | URBAN_CELL_BIT_BRIDGE)) !== 0) continue;
          if (orthoDegree(roadMask, width, height, rx, ry) <= 1) {
            let avoid: [number, number] | null = null;
            for (let d = 0; d < 4; d++) {
              const nx = rx + CARDINAL_DIRS[d][0];
              const ny = ry + CARDINAL_DIRS[d][1];
              if (roadMask[ny * width + nx]) {
                avoid = [nx, ny];
                break;
              }
            }
            const closed = closeLoopFromDeg1(
              roadMask,
              buildingsMask,
              inlandMask,
              approachProtectedMask,
              width,
              height,
              [rx, ry],
              avoid,
              8,
              [qx0 - 2, qy0 - 2, qx1 + 2, qy1 + 2],
              blockedUnion
            );
            if (!closed) {
              roadMask[idx] = 0;
              cellFlags[idx] &= ~URBAN_CELL_BIT_ROAD;
            } else {
              // Sincronizar nuevos roadMask en cellFlags
              for (let yy = Math.max(1, qy0 - 2); yy <= Math.min(height - 2, qy1 + 2); yy++) {
                for (let xx = Math.max(1, qx0 - 2); xx <= Math.min(width - 2, qx1 + 2); xx++) {
                  if (roadMask[yy * width + xx]) cellFlags[yy * width + xx] |= URBAN_CELL_BIT_ROAD;
                }
              }
            }
            changedQ = true;
          }
        }
      }
      if (!changedQ) break;
    }
  }

  // ---------------------------------------------------------------------------
  // 7. PRE-SPLIT 4x4 + FASES 7a / 7b / 7c (L3857-3989)
  // ---------------------------------------------------------------------------
  const safePlaceResidential = (
    bx: number,
    by: number,
    bt: InitialNeutralBuildingType,
    districtId: string
  ): boolean => {
    if (bx < 2 || bx >= width - 2 || by < 2 || by >= height - 2) return false;
    const idx = by * width + bx;
    if (!dryMunicipalityMask[idx] || buildingsMask[idx] || roadMask[idx]) return false;
    if (AWBW_BUILDING_OVERHANG_PX[bt] >= 8 && buildingsMask[(by - 1) * width + bx]) return false;
    const southB = buildingsByLocalIdx.get((by + 1) * width + bx);
    if (southB && southB.overhangPx >= 8) return false;

    const variant: 0 | 1 =
      (spec.tierId === 'T5_METROPOLIS_X3' || spec.tierId === 'T4_CONURBATION_X2') &&
      bt === 'city' &&
      (detHashInt(bx, by, seed) & 1) === 1
        ? 1
        : 0;
    buildingsByLocalIdx.set(idx, {
      localX: bx,
      localY: by,
      globalX: originGlobalX + bx,
      globalY: originGlobalY + by,
      type: bt,
      ownerId: null,
      overhangPx: AWBW_BUILDING_OVERHANG_PX[bt],
      neutralSkinVariant: variant,
      districtId,
    });
    buildingsMask[idx] = 1;
    usedMask[idx] = 1;
    cellFlags[idx] &= ~URBAN_CELL_BIT_PARK;
    return true;
  };

  // Pre-split de cualquier parche >= 4x4 antes del relleno
  for (let pass = 0; pass < 8; pass++) {
    const plainInt = new Uint8Array(width * height);
    for (let i = 0; i < plainInt.length; i++) {
      if (
        inlandMask[i] &&
        !roadMask[i] &&
        !blockedDistMask[i] &&
        !rbtProtectedMask[i] &&
        !approachProtectedMask[i] &&
        !buildingsMask[i] &&
        (cellFlags[i] & URBAN_CELL_BIT_PARK) === 0
      ) {
        plainInt[i] = 1;
      }
    }
    if (maxEmptySquareSide(plainInt, width, height) <= 3) break;
    let splitDone = false;
    for (let y = 1; y < height - 4 && !splitDone; y++) {
      for (let x = 1; x < width - 4 && !splitDone; x++) {
        let all4 = true;
        for (let dy = 0; dy < 4 && all4; dy++) {
          for (let dx = 0; dx < 4; dx++) {
            if (!plainInt[(y + dy) * width + (x + dx)]) {
              all4 = false;
              break;
            }
          }
        }
        if (all4) {
          paintPark(x + 1, y + 1);
          paintPark(x + 2, y + 2);
          splitDone = true;
        }
      }
    }
    if (!splitDone) break;
  }

  // Recolectar lotes elegibles adyacentes a carretera por cuadrante
  const quadBldgCounts = new Int32Array(sectorDefs.length);
  for (const b of buildingsByLocalIdx.values()) {
    const sid = sectorIdGrid[b.localY * width + b.localX];
    if (sid >= 0 && sid < quadBldgCounts.length) quadBldgCounts[sid]++;
  }

  const eligibleLots: Array<Array<[number, number]>> = Array.from(
    { length: sectorDefs.length },
    () => []
  );
  for (let y = 2; y < height - 2; y++) {
    for (let x = 2; x < width - 2; x++) {
      const idx = y * width + x;
      if (!inlandMask[idx] || roadMask[idx] || blockedDistMask[idx] || rbtProtectedMask[idx] || approachProtectedMask[idx]) {
        continue;
      }
      if (buildingsMask[idx] || usedMask[idx]) continue;
      let adjRoad = false;
      for (let d = 0; d < 4; d++) {
        if (roadMask[(y + CARDINAL_DIRS[d][1]) * width + (x + CARDINAL_DIRS[d][0])]) {
          adjRoad = true;
          break;
        }
      }
      if (!adjRoad) continue;
      const sid = Math.max(0, Math.min(sectorDefs.length - 1, sectorIdGrid[idx]));
      eligibleLots[sid].push([x, y]);
    }
  }

  const targetTotal = spec.neutralBuildings.total;
  const maxTotal = Math.round(targetTotal * 1.25);
  const minQuadB =
    spec.engineScale === 'x5'
      ? 24
      : spec.engineScale === 'x4'
      ? 20
      : spec.engineScale === 'x3'
      ? 16
      : spec.engineScale === 'x2'
      ? 14
      : 10;
  const minAllQ = minQuadB + 2;

  // Fase 7a: cuota por cuadrante + ~12.5% parques
  const remBudget = Math.max(0, targetTotal - buildingsByLocalIdx.size);
  const perQAddCap = Math.max(minAllQ, Math.floor(remBudget / Math.max(1, sectorDefs.length)) + 2);
  for (let sid = 0; sid < sectorDefs.length; sid++) {
    let added = 0;
    for (const [lx, ly] of eligibleLots[sid]) {
      if (buildingsByLocalIdx.size >= maxTotal - 2) break;
      if (quadBldgCounts[sid] >= minAllQ && (buildingsByLocalIdx.size >= targetTotal || added >= perQAddCap)) {
        break;
      }
      if (quadBldgCounts[sid] >= minAllQ && detHashInt(lx, ly, seed + 811) % 8 === 0) {
        paintPark(lx, ly);
        continue;
      }
      if (safePlaceResidential(lx, ly, 'city', `residential_s${sid}`)) {
        quadBldgCounts[sid]++;
        added++;
      }
    }
  }

  // Fase 7b: top-up si por debajo de targetFill
  const minFill =
    spec.engineScale === 'x5' || spec.engineScale === 'x4' || spec.engineScale === 'x3'
      ? 0.25
      : spec.engineScale === 'x2'
      ? 0.22
      : 0.17;
  const neededMinB = Math.max(Math.floor(targetTotal * 0.78), Math.ceil(minFill * sil.dryAreaTiles));
  const targetFillB = Math.max(neededMinB + 2, Math.min(maxTotal, targetTotal));
  if (buildingsByLocalIdx.size < targetFillB) {
    for (let sid = 0; sid < sectorDefs.length; sid++) {
      for (const [lx, ly] of eligibleLots[sid]) {
        if (buildingsByLocalIdx.size >= targetFillB) break;
        const idx = ly * width + lx;
        if (!buildingsMask[idx] && (cellFlags[idx] & URBAN_CELL_BIT_PARK) === 0) {
          if (safePlaceResidential(lx, ly, 'city', `residential_s${sid}`)) {
            quadBldgCounts[sid]++;
          }
        }
      }
    }
  }

  // Asegurar 1 HQ neutral si civic_core no cupo en un municipio muy recortado
  let hasHq = false;
  for (const b of buildingsByLocalIdx.values()) {
    if (b.type === 'hq') {
      hasHq = true;
      break;
    }
  }
  if (!hasHq) {
    for (let sid = 0; sid < sectorDefs.length && !hasHq; sid++) {
      for (const [lx, ly] of eligibleLots[sid]) {
        if (safePlaceResidential(lx, ly, 'hq', 'civic_core_fallback')) {
          hasHq = true;
          break;
        }
      }
    }
  }

  // Fase 7c: eliminar CUALQUIER cuadrado vacío >= 4x4 dentro de inlandMask (L3954-3989)
  const buildPlainInt = (): Uint8Array => {
    const p = new Uint8Array(width * height);
    for (let i = 0; i < p.length; i++) {
      if (
        inlandMask[i] &&
        !roadMask[i] &&
        !runwayClearMask[i] &&
        !buildingsMask[i] &&
        (cellFlags[i] & URBAN_CELL_BIT_PARK) === 0
      ) {
        p[i] = 1;
      }
    }
    // Excluir 1-tile north setback de edificios altos
    for (const b of buildingsByLocalIdx.values()) {
      if (b.overhangPx >= 8 && b.localY > 0) {
        p[(b.localY - 1) * width + b.localX] = 0;
      }
    }
    return p;
  };

  for (let pass = 0; pass < 24; pass++) {
    const plainInt = buildPlainInt();
    if (maxEmptySquareSide(plainInt, width, height) <= 3) break;
    let fixed = false;
    for (let y = 1; y < height - 4 && !fixed; y++) {
      for (let x = 1; x < width - 4 && !fixed; x++) {
        let all4 = true;
        for (let dy = 0; dy < 4 && all4; dy++) {
          for (let dx = 0; dx < 4; dx++) {
            if (!plainInt[(y + dy) * width + (x + dx)]) {
              all4 = false;
              break;
            }
          }
        }
        if (all4) {
          const cx = x + 1;
          const cy = y + 1;
          const adjR = CARDINAL_DIRS.some(([dx, dy]) => roadMask[(cy + dy) * width + (cx + dx)]);
          if (buildingsByLocalIdx.size < maxTotal && adjR && safePlaceResidential(cx, cy, 'city', 'infill_7c')) {
            fixed = true;
          } else if (paintPark(cx, cy)) {
            fixed = true;
          }
        }
      }
    }
    if (!fixed) break;
  }

  // ---------------------------------------------------------------------------
  // 8. K-CORE FINAL Y RESCATE DE EDIFICIOS EN VENTANA COMPLETA (L4082-4165)
  // ---------------------------------------------------------------------------
  const isProtectedRoad = (idx: number): boolean =>
    (cellFlags[idx] & (URBAN_CELL_BIT_YELLOW_TRUNK | URBAN_CELL_BIT_BRIDGE)) !== 0 ||
    (beltwayMask[idx] !== 0 && !plan.portBeltwayNearMask[idx]);

  for (let kPass = 0; kPass < 4; kPass++) {
    // Podar puntas deg < 2 (no protegidas)
    for (let iter = 0; iter < width; iter++) {
      let anyTip = false;
      for (let y = 1; y < height - 1; y++) {
        for (let x = 1; x < width - 1; x++) {
          const idx = y * width + x;
          if (!roadMask[idx] || isProtectedRoad(idx)) continue;
          if (x === pMerge[0] && y === pMerge[1]) continue;
          if (orthoDegree(roadMask, width, height, x, y) < 2) {
            roadMask[idx] = 0;
            cellFlags[idx] &= ~URBAN_CELL_BIT_ROAD;
            anyTip = true;
          }
        }
      }
      if (!anyTip) break;
    }

    const { labels } = connectedComponents4(roadMask, width, height);
    const mainCid = labels[mainHubPt[1] * width + mainHubPt[0]];
    if (mainCid <= 0) break;
    const survMain = new Uint8Array(width * height);
    for (let i = 0; i < survMain.length; i++) if (labels[i] === mainCid && roadMask[i]) survMain[i] = 1;

    let repairedAny = false;
    const allowRescue = new Uint8Array(width * height);
    for (let i = 0; i < allowRescue.length; i++) {
      if ((inlandMask[i] && !approachProtectedMask[i] && !buildingsMask[i]) || survMain[i]) {
        allowRescue[i] = 1;
      }
    }

    for (const b of buildingsByLocalIdx.values()) {
      const bx = b.localX;
      const by = b.localY;
      const touchesMain = CARDINAL_DIRS.some(([dx, dy]) => {
        const nx = bx + dx;
        const ny = by + dy;
        return nx >= 0 && nx < width && ny >= 0 && ny < height && survMain[ny * width + nx] !== 0;
      });
      if (touchesMain) continue;

      for (const [dx, dy] of CARDINAL_DIRS) {
        const nx = bx + dx;
        const ny = by + dy;
        if (nx < 2 || nx >= width - 2 || ny < 2 || ny >= height - 2) continue;
        const nIdx = ny * width + nx;
        if (!allowRescue[nIdx]) continue;
        if (roadMask[nIdx] || !wouldMake2x2(roadMask, width, height, nx, ny)) {
          const leg1 = trace4ConnNo2x2(
            roadMask,
            width,
            height,
            [nx, ny],
            [rbtCenterX, rbtCenterY],
            allowRescue,
            null,
            survMain
          );
          if (leg1) {
            for (const [px, py] of leg1) {
              const pIdx = py * width + px;
              if (!roadMask[pIdx] && !wouldMake2x2(roadMask, width, height, px, py)) {
                roadMask[pIdx] = 1;
                cellFlags[pIdx] |= URBAN_CELL_BIT_ROAD;
              }
            }
            if (orthoDegree(roadMask, width, height, nx, ny) <= 1) {
              const tLoop = new Uint8Array(width * height);
              for (let yy = 0; yy < height; yy++) {
                for (let xx = 0; xx < width; xx++) {
                  const tIdx = yy * width + xx;
                  if (survMain[tIdx] && Math.abs(xx - nx) + Math.abs(yy - ny) >= 3) {
                    tLoop[tIdx] = 1;
                  }
                }
              }
              const leg2 = trace4ConnNo2x2(
                roadMask,
                width,
                height,
                [nx, ny],
                [rbtCenterX, rbtCenterY],
                allowRescue,
                null,
                tLoop
              );
              if (leg2) {
                for (const [px, py] of leg2) {
                  const pIdx = py * width + px;
                  if (!roadMask[pIdx] && !wouldMake2x2(roadMask, width, height, px, py)) {
                    roadMask[pIdx] = 1;
                    cellFlags[pIdx] |= URBAN_CELL_BIT_ROAD;
                  }
                }
              }
            }
            repairedAny = true;
            break;
          }
        }
      }
    }
    if (!repairedAny) break;
  }

  // Peel 2x2 final protegiendo línea amarilla
  if (count2x2Blobs(roadMask, width, height) > 0) {
    const protY = new Uint8Array(width * height);
    for (let i = 0; i < protY.length; i++) {
      if ((cellFlags[i] & (URBAN_CELL_BIT_YELLOW_TRUNK | URBAN_CELL_BIT_BRIDGE)) !== 0) protY[i] = 1;
    }
    const peeled = peel2x2(roadMask, width, height, protY);
    for (let i = 0; i < peeled.length; i++) {
      if (roadMask[i] && !peeled[i]) {
        roadMask[i] = 0;
        cellFlags[i] &= ~(URBAN_CELL_BIT_ROAD | URBAN_CELL_BIT_BELTWAY);
      }
    }
  }

  // Último barrido k-core para garantizar 0 dead-ends interiores (cierra o poda puntas incluso en bordes de muesca)
  const isHardProtected = (idx: number): boolean =>
    (cellFlags[idx] & (URBAN_CELL_BIT_YELLOW_TRUNK | URBAN_CELL_BIT_BRIDGE)) !== 0;

  for (let iter = 0; iter < 32; iter++) {
    let pruned = false;
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const idx = y * width + x;
        if (!roadMask[idx] || isHardProtected(idx)) continue;
        if (x === pMerge[0] && y === pMerge[1]) continue;
        if (orthoDegree(roadMask, width, height, x, y) <= 1) {
          const closed = closeLoopFromDeg1(
            roadMask,
            buildingsMask,
            inlandMask,
            approachProtectedMask,
            width,
            height,
            [x, y],
            null,
            8
          );
          if (closed) {
            for (let k = 0; k < roadMask.length; k++) {
              if (roadMask[k]) cellFlags[k] |= URBAN_CELL_BIT_ROAD;
            }
          } else {
            roadMask[idx] = 0;
            cellFlags[idx] &= ~(URBAN_CELL_BIT_ROAD | URBAN_CELL_BIT_BELTWAY);
          }
          pruned = true;
        }
      }
    }
    if (!pruned) break;
  }

  // Degradar a parque cualquier edificio residencial 'city' desconectado
  const { labels: finalLabels } = connectedComponents4(roadMask, width, height);
  const finalMainCid =
    roadMask[pMerge[1] * width + pMerge[0]]
      ? finalLabels[pMerge[1] * width + pMerge[0]]
      : finalLabels[mainHubPt[1] * width + mainHubPt[0]];
  if (finalMainCid > 0) {
    for (const [idx, b] of Array.from(buildingsByLocalIdx.entries())) {
      const ok = CARDINAL_DIRS.some(([dx, dy]) => {
        const nx = b.localX + dx;
        const ny = b.localY + dy;
        return (
          nx >= 0 &&
          nx < width &&
          ny >= 0 &&
          ny < height &&
          roadMask[ny * width + nx] !== 0 &&
          finalLabels[ny * width + nx] === finalMainCid
        );
      });
      if (!ok && b.type === 'city') {
        buildingsByLocalIdx.delete(idx);
        buildingsMask[idx] = 0;
        cellFlags[idx] |= URBAN_CELL_BIT_PARK;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // 9. CORONA PERIURBANA DE ÁRBOLES (1-3 tiles fuera de beltway_real)
  // ---------------------------------------------------------------------------
  const targetCrowns = spec.engineScale === 'x3' ? 42 : spec.engineScale === 'x2' ? 30 : 18;
  let placedCrowns = 0;
  for (let y = 1; y < height - 1 && placedCrowns < targetCrowns; y++) {
    for (let x = 1; x < width - 1 && placedCrowns < targetCrowns; x++) {
      const idx = y * width + x;
      if (inlandMask[idx] || !dryMunicipalityMask[idx] || roadMask[idx] || buildingsMask[idx]) continue;
      let nearBelt = false;
      for (let dy = -2; dy <= 2 && !nearBelt; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx >= 0 && nx < width && ny >= 0 && ny < height && beltwayMask[ny * width + nx]) {
            nearBelt = true;
            break;
          }
        }
      }
      if (nearBelt && detHashInt(x, y, seed + 503) % 3 === 0) {
        cellFlags[idx] |= URBAN_CELL_BIT_TREE_CROWN;
        placedCrowns++;
      }
    }
  }

  // Métricas finales verificables
  let tallOverhangViolations = 0;
  for (const b of buildingsByLocalIdx.values()) {
    if (b.overhangPx >= 8 && b.localY > 0 && buildingsMask[(b.localY - 1) * width + b.localX]) {
      tallOverhangViolations++;
    }
  }

  let remainingDeadEnds = 0;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x;
      if (!roadMask[idx]) continue;
      if ((cellFlags[idx] & (URBAN_CELL_BIT_YELLOW_TRUNK | URBAN_CELL_BIT_BRIDGE)) !== 0) continue;
      if (x === pMerge[0] && y === pMerge[1]) continue;
      if (orthoDegree(roadMask, width, height, x, y) <= 1) remainingDeadEnds++;
    }
  }

  const finalMaxEmptySq = maxEmptySquareSide(buildPlainInt(), width, height);

  // ---------------------------------------------------------------------------
  // 10. MATRIZ EXCLUSIVA districtGrid (0 SOLAPES), PARCELAS DE EXPANSIÓN <= 64
  //     (_finalize_buildable_zones L6171-6304) E INTERCAMBIOS VALIDADOS
  // ---------------------------------------------------------------------------
  const { districtGrid, districtLegend } = plan;
  const residentialDistricts: ResidentialSectorRecord[] = [];
  for (let sIdx = 0; sIdx < sectorDefs.length; sIdx++) {
    const { id, grain } = sectorDefs[sIdx];
    const dIdx = districtLegend.length + 1;
    let minX = width;
    let maxX = -1;
    let minY = height;
    let maxY = -1;
    let bCnt = 0;
    let painted = 0;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        if (inlandMask[idx] && sectorIdGrid[idx] === sIdx && districtGrid[idx] === 0) {
          districtGrid[idx] = dIdx;
          painted++;
        }
      }
    }

    for (const b of buildingsByLocalIdx.values()) {
      if (!b.districtId.startsWith('residential_')) continue;
      const idx = b.localY * width + b.localX;
      if (sectorIdGrid[idx] !== sIdx) continue;
      bCnt++;
      if (b.localX < minX) minX = b.localX;
      if (b.localX > maxX) maxX = b.localX;
      if (b.localY < minY) minY = b.localY;
      if (b.localY > maxY) maxY = b.localY;
    }

    if (painted > 0) {
      districtLegend.push({
        dIdx,
        tag: `RESIDENTI [${grain.slice(0, 6)}]`,
        kind: 'residential',
        archetype: `residential_${id.toLowerCase()}`,
      });
    }
    if (bCnt > 0 && maxX >= minX && maxY >= minY) {
      residentialDistricts.push({
        id: `residential_${id.toLowerCase()}`,
        grain,
        bbox: [minX, minY, maxX, maxY],
        buildingCount: bCnt,
      });
    }
  }

  // Zonas verdes contiguas de expansión periurbana + particionado recursivo <= 64 tiles (L6171-6304)
  const dFromCity = bfsDistance(inlandMask, width, height);
  const bandW =
    spec.engineScale === 'x5' || spec.engineScale === 'x4'
      ? 11
      : spec.engineScale === 'x3'
      ? 10
      : 8;
  const rawAnnulus = new Uint8Array(width * height);
  let eLandCount = 0;
  for (let i = 0; i < rawAnnulus.length; i++) {
    const d = dFromCity[i];
    if (
      d >= 1 &&
      d <= bandW &&
      dryMunicipalityMask[i] &&
      !inlandMask[i] &&
      !roadMask[i] &&
      !buildingsMask[i] &&
      !plan.flightCorridorExclMask[i] &&
      (cellFlags[i] & URBAN_CELL_BIT_TREE_CROWN) === 0
    ) {
      rawAnnulus[i] = 1;
      eLandCount++;
    }
  }
  let expansionZoneMask = keepOnly3x3Blocks(rawAnnulus, width, height);

  // Cap superior <= 0.57 recortando tiles más lejanos
  const countOnes = (m: Uint8Array): number => {
    let c = 0;
    for (let i = 0; i < m.length; i++) if (m[i]) c++;
    return c;
  };
  if (eLandCount > 0 && countOnes(expansionZoneMask) / eLandCount > 0.60) {
    const targetMax = Math.floor(eLandCount * 0.57);
    const farIndices: Array<[number, number]> = [];
    for (let i = 0; i < expansionZoneMask.length; i++) {
      if (expansionZoneMask[i]) farIndices.push([dFromCity[i], i]);
    }
    farIndices.sort((a, b) => b[0] - a[0]);
    let curCnt = farIndices.length;
    for (let k = 0; k < farIndices.length && curCnt > targetMax; k++) {
      expansionZoneMask[farIndices[k][1]] = 0;
      curCnt--;
    }
    expansionZoneMask = keepOnly3x3Blocks(expansionZoneMask, width, height);
  }

  // Particionado recursivo de componentes > 64 tiles en parcelas discretas (L6237-6304)
  for (let splitIter = 0; splitIter < 24; splitIter++) {
    const { labels, sizes } = connectedComponents4(expansionZoneMask, width, height);
    let biggestCid = 0;
    let biggestSz = 0;
    for (const [cid, sz] of sizes.entries()) {
      if (sz > biggestSz) {
        biggestSz = sz;
        biggestCid = cid;
      }
    }
    if (biggestSz <= 64 || biggestCid === 0) break;

    let bx0 = width;
    let bx1 = -1;
    let by0 = height;
    let by1 = -1;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (labels[y * width + x] === biggestCid) {
          if (x < bx0) bx0 = x;
          if (x > bx1) bx1 = x;
          if (y < by0) by0 = y;
          if (y > by1) by1 = y;
        }
      }
    }
    const bw = bx1 - bx0 + 1;
    const bh = by1 - by0 + 1;
    if (Math.max(bw, bh) < 7) break;

    const splitVert = bw >= bh;
    const mid = splitVert ? Math.floor((bx0 + bx1) / 2) : Math.floor((by0 + by1) / 2);
    const nextMask = new Uint8Array(expansionZoneMask);
    if (splitVert) {
      for (let y = by0; y <= by1; y++) {
        if (labels[y * width + mid] === biggestCid) nextMask[y * width + mid] = 0;
      }
    } else {
      for (let x = bx0; x <= bx1; x++) {
        if (labels[mid * width + x] === biggestCid) nextMask[mid * width + x] = 0;
      }
    }
    const cleaned = keepOnly3x3Blocks(nextMask, width, height);
    if (countOnes(cleaned) < Math.floor(eLandCount * 0.35)) break;
    expansionZoneMask = cleaned;
  }

  // Validación estricta de flechas amarillas de intercambio (_is_valid_interchange L6309-6388):
  // solo emitir si el origen es carretera deg>=2 y los 2 tiles frontales caen en expansionZoneMask
  const validatedInterchangeArrows: InterchangeArrowRecord[] = [];
  const tryAddArrow = (lx: number, ly: number, dx: number, dy: number): boolean => {
    if (lx < 2 || lx >= width - 2 || ly < 2 || ly >= height - 2) return false;
    if (!roadMask[ly * width + lx] || orthoDegree(roadMask, width, height, lx, ly) < 2) return false;
    const fx1 = lx + dx;
    const fy1 = ly + dy;
    const fx2 = lx + dx * 2;
    const fy2 = ly + dy * 2;
    if (fx2 < 1 || fx2 >= width - 1 || fy2 < 1 || fy2 >= height - 1) return false;
    if (!expansionZoneMask[fy1 * width + fx1] || !expansionZoneMask[fy2 * width + fx2]) return false;
    const gx = originGlobalX + lx;
    const gy = originGlobalY + ly;
    if (validatedInterchangeArrows.some((a) => Math.abs(a.globalX - gx) + Math.abs(a.globalY - gy) < 8)) {
      return false;
    }
    validatedInterchangeArrows.push({ globalX: gx, globalY: gy, dx, dy });
    return true;
  };

  for (const [gx, gy] of skel.perimeterPortalsGlobal) {
    const lx = gx - originGlobalX;
    const ly = gy - originGlobalY;
    for (const [dx, dy] of CARDINAL_DIRS) {
      if (tryAddArrow(lx, ly, dx, dy)) break;
    }
  }
  const targetIx = spec.targetExitsCount ?? 4;
  if (validatedInterchangeArrows.length < targetIx) {
    for (let y = 2; y < height - 2 && validatedInterchangeArrows.length < targetIx; y++) {
      for (let x = 2; x < width - 2 && validatedInterchangeArrows.length < targetIx; x++) {
        if (!beltwayMask[y * width + x]) continue;
        for (const [dx, dy] of CARDINAL_DIRS) {
          if (tryAddArrow(x, y, dx, dy)) break;
        }
      }
    }
  }

  // Lotes costeros reservados para futuros puertos (hasta 2 por ciudad costera)
  const futurePortPlots: FuturePortPlotRecord[] = [];
  if (spec.waterfrontDir !== 'none') {
    const existingPorts: Array<[number, number]> = [];
    for (const b of buildingsByLocalIdx.values()) {
      if (b.type === 'port') existingPorts.push([b.localX, b.localY]);
    }
    const dirNames: readonly WaterfrontDirection[] = ['N', 'E', 'S', 'W'];
    for (let y = 3; y < height - 3 && futurePortPlots.length < 2; y++) {
      for (let x = 3; x < width - 3 && futurePortPlots.length < 2; x++) {
        const idx = y * width + x;
        if (!masks.portCoastMask[idx] || buildingsMask[idx] || roadMask[idx]) continue;
        if (existingPorts.some(([px, py]) => Math.hypot(x - px, y - py) < 8)) continue;
        if (
          futurePortPlots.some(
            (fp) => Math.hypot(originGlobalX + x - fp.coastGlobalX, originGlobalY + y - fp.coastGlobalY) < 10
          )
        ) {
          continue;
        }
        let wf: WaterfrontDirection = spec.waterfrontDir;
        for (let d = 0; d < 4; d++) {
          const nx = x + CARDINAL_DIRS[d][0];
          const ny = y + CARDINAL_DIRS[d][1];
          if (nx >= 0 && nx < width && ny >= 0 && ny < height && !masks.dryGlobalMask[ny * width + nx]) {
            wf = dirNames[d];
            break;
          }
        }
        futurePortPlots.push({
          coastGlobalX: originGlobalX + x,
          coastGlobalY: originGlobalY + y,
          waterFacing: wf,
          dockBboxGlobal: [
            originGlobalX + x - 1,
            originGlobalY + y - 1,
            originGlobalX + x + 1,
            originGlobalY + y + 1,
          ],
        });
      }
    }
  }

  return {
    tallOverhangViolations,
    remainingDeadEnds,
    maxEmptySquareSideValue: finalMaxEmptySq,
    distinctMicroGrainsCount: usedGrains.size,
    residentialDistricts,
    districtGrid,
    districtLegend,
    expansionZoneMask,
    validatedInterchangeArrows,
    futurePortPlots,
  };
}
