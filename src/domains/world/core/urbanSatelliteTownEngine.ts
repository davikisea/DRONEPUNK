/**
 * ==============================================================================
 * MOTOR DE 5 FAMILIAS ORGÁNICAS PARA PUEBLOS SATÉLITE (T1 / T2)
 * ==============================================================================
 * Port 100 % fiel de _synthesize_organic_sat_layout (09_city_world_engine.py L4430-4530):
 * 1. highway_roundabout_hub (rotonda 5x5 + y_flare, 19 edificios neutrales)
 * 2. harbor_promenade_cove (creciente costero + quay_promenade, 16 edificios)
 * 3. ridge_terrace_citadel (cuña escalonada + rotonda 3x3 bypass, 17 edificios)
 * 4. riverbend_mill_hamlet (bi-lóbulo asimétrico + rotonda 3x3 y_entry, 17 edificios)
 * 5. industrial_freight_crescent (cuña de carga + y_junction_bypass, 17 edificios)
 *
 * Todos los edificios nacen 100 % GRISES NEUTRALES (ownerId: null), 0 blobs 2x2,
 * 0 dead-ends interiores y empalme limpio con la Línea Amarilla Base.
 * ==============================================================================
 */

import {
  AWBW_BUILDING_OVERHANG_PX,
  URBAN_CELL_BIT_BELTWAY,
  URBAN_CELL_BIT_BRIDGE,
  URBAN_CELL_BIT_LOBE,
  URBAN_CELL_BIT_PARK,
  URBAN_CELL_BIT_PORT_WATER,
  URBAN_CELL_BIT_ROAD,
  URBAN_CELL_BIT_TREE_CROWN,
  URBAN_CELL_BIT_YELLOW_TRUNK,
  type CityScaleSpec,
  type InitialNeutralBuildingType,
  type RoundaboutRecord,
  type SatelliteFamilyId,
  type UrbanBuildingPlacement,
  type UrbanCityBlueprint,
  type YellowTrunkCityInteractionMode,
} from '../types/urbanMorphologyTypes';
import type { UrbanContainmentMasks } from './urbanContainmentMasks';
import {
  getYellowTrunkBridgeAxisAtGlobalCell,
  isYellowTrunkAtGlobalCell,
} from './yellowTrunkBackboneIndex';
import {
  CARDINAL_DIRS,
  chaikinSmooth,
  cleanLobeMask,
  closeLoopFromDeg1,
  connectedComponents4,
  count2x2Blobs,
  detHash32,
  detHashInt,
  extractThinRing,
  maxEmptySquareSide,
  orthoDegree,
  peel2x2,
  rasterizePolygon,
  trace4ConnNo2x2,
  wouldMake2x2,
} from './urbanMorphologyPrimitives';
import { stampChamferedRoundabout } from './urbanSilhouetteAndSkeleton';
import { computeTopoSignature9D } from './urbanVariabilityEngine';

interface SatFamilySpec {
  readonly poly: ReadonlyArray<readonly [number, number]>;
  readonly rbtR: 1 | 2;
  readonly rbtCyOff: number;
  readonly hasRbt: boolean;
  readonly hasYFlare: boolean;
  readonly bldgBudget: number;
  readonly specialRoster: readonly InitialNeutralBuildingType[];
}

const SAT_FAMILY_SPECS: Readonly<Record<SatelliteFamilyId, SatFamilySpec>> = {
  highway_roundabout_hub: {
    poly: [
      [9.8, -2.5], [9.5, 5.8], [3.2, 6.2], [-3.2, 6.2], [-9.5, 5.8],
      [-10.2, -1.5], [-6.8, -6.5], [2.8, -6.8], [7.8, -5.2],
    ],
    rbtR: 2,
    rbtCyOff: 0,
    hasRbt: true,
    hasYFlare: true,
    bldgBudget: 19,
    specialRoster: ['hq', 'factory', 'commtower', 'silo'],
  },
  harbor_promenade_cove: {
    poly: [
      [10.4, -2.0], [9.6, 5.2], [4.5, 5.6], [0.0, 2.8], [-4.5, 5.6],
      [-9.6, 5.0], [-10.4, -2.2], [-5.0, -5.6], [4.8, -5.4],
    ],
    rbtR: 1,
    rbtCyOff: 1,
    hasRbt: false,
    hasYFlare: false,
    bldgBudget: 16,
    specialRoster: ['hq', 'port', 'factory'],
  },
  ridge_terrace_citadel: {
    poly: [
      [8.6, -4.2], [8.2, 3.8], [2.2, 5.4], [-3.8, 4.4], [-8.8, 3.2],
      [-8.4, -3.6], [-3.2, -5.8], [4.2, -5.6],
    ],
    rbtR: 1,
    rbtCyOff: 1,
    hasRbt: true,
    hasYFlare: false,
    bldgBudget: 17,
    specialRoster: ['hq', 'factory', 'commtower'],
  },
  riverbend_mill_hamlet: {
    poly: [
      [9.4, -3.2], [8.6, 4.6], [2.0, 5.4], [-1.5, 2.8], [-7.8, 5.2],
      [-9.6, -1.2], [-4.2, -5.6], [4.4, -5.2],
    ],
    rbtR: 1,
    rbtCyOff: 1,
    hasRbt: true,
    hasYFlare: true,
    bldgBudget: 17,
    specialRoster: ['hq', 'factory', 'silo'],
  },
  industrial_freight_crescent: {
    poly: [
      [10.6, -3.8], [10.0, 4.8], [3.6, 5.6], [-3.6, 5.6], [-10.0, 4.6],
      [-10.4, -2.8], [-4.0, -5.6], [5.0, -5.4],
    ],
    rbtR: 1,
    rbtCyOff: 1,
    hasRbt: false,
    hasYFlare: false,
    bldgBudget: 17,
    specialRoster: ['hq', 'factory', 'factory', 'silo', 'usedSilo'],
  },
};

export function compileOrganicSatelliteBlueprint(
  spec: CityScaleSpec,
  masks: UrbanContainmentMasks,
  originGlobalX: number,
  originGlobalY: number,
  safeCenterLocalX: number,
  safeCenterLocalY: number,
  landPredicate: (lng: number, lat: number) => boolean
): UrbanCityBlueprint {
  const { width, height, dryMunicipalityMask, portCoastMask } = masks;
  const seed = detHash32(`${spec.cityId}_sat_v6`);
  const family: SatelliteFamilyId = spec.satelliteFamily ?? 'highway_roundabout_hub';
  const fSpec = SAT_FAMILY_SPECS[family];

  const cellFlags = new Uint8Array(width * height);
  const bridgeAxis = new Uint8Array(width * height);
  const roadMask = new Uint8Array(width * height);
  const rbtProtectedMask = new Uint8Array(width * height);

  // Escalar polígono de 33x33 al canvas de la localidad (20x20 o 40x40)
  const polyScale = Math.min(1.0, (Math.min(width, height) - 4) / 22.0);
  const ptsW: Array<[number, number]> = fSpec.poly.map(([px, py], iv) => {
    const jit = 1.0 + (((detHashInt(iv, seed & 0xff, seed + 511) % 13) - 6) / 100.0);
    return [
      safeCenterLocalX + px * polyScale * jit,
      safeCenterLocalY + py * polyScale * jit,
    ];
  });
  const smoothed = chaikinSmooth(ptsW, 2);
  const raw = rasterizePolygon(smoothed, width, height);

  // Intersectar con M_dry_mun(c) (0 agua, 0 ríos)
  const dryRaw = new Uint8Array(width * height);
  for (let i = 0; i < dryRaw.length; i++) {
    if (raw[i] && dryMunicipalityMask[i]) dryRaw[i] = 1;
  }

  const rbtCx = Math.max(3, Math.min(width - 4, safeCenterLocalX));
  const rbtCy = Math.max(3, Math.min(height - 4, safeCenterLocalY + fSpec.rbtCyOff));
  const notchHw = fSpec.rbtR === 2 ? 2 : 1;

  if (fSpec.hasYFlare && width >= 24) {
    for (let y = rbtCy + fSpec.rbtR + 1; y < height; y++) {
      for (let x = rbtCx - notchHw; x <= rbtCx + notchHw; x++) {
        if (x >= 0 && x < width) dryRaw[y * width + x] = 0;
      }
    }
  }

  let mSat = cleanLobeMask(dryRaw, width, height, rbtCx, Math.max(2, rbtCy - 1), 2);
  let dryAreaTiles = 0;
  for (let i = 0; i < mSat.length; i++) if (mSat[i]) dryAreaTiles++;

  // Fallback si el polígono municipal es muy estrecho (ej. isla o península)
  if (dryAreaTiles < 28) {
    const fb = new Uint8Array(width * height);
    const rFb = Math.max(4, Math.floor(Math.min(width, height) * 0.34));
    for (let y = 2; y < height - 2; y++) {
      for (let x = 2; x < width - 2; x++) {
        if (Math.hypot(x - safeCenterLocalX, y - safeCenterLocalY) <= rFb && dryMunicipalityMask[y * width + x]) {
          fb[y * width + x] = 1;
        }
      }
    }
    mSat = cleanLobeMask(fb, width, height, safeCenterLocalX, safeCenterLocalY, 2);
    dryAreaTiles = 0;
    for (let i = 0; i < mSat.length; i++) if (mSat[i]) dryAreaTiles++;
  }

  for (let i = 0; i < mSat.length; i++) {
    if (mSat[i]) cellFlags[i] |= URBAN_CELL_BIT_LOBE;
  }

  // 1. Proyectar Línea Amarilla Base inmutable
  const localTrunkCells: Array<[number, number]> = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const gx = originGlobalX + x;
      const gy = originGlobalY + y;
      if (isYellowTrunkAtGlobalCell(gx, gy, landPredicate)) {
        const idx = y * width + x;
        cellFlags[idx] |= URBAN_CELL_BIT_YELLOW_TRUNK;
        const bAxis = getYellowTrunkBridgeAxisAtGlobalCell(gx, gy, landPredicate);
        if (bAxis !== 0) {
          cellFlags[idx] |= URBAN_CELL_BIT_BRIDGE;
          bridgeAxis[idx] = bAxis;
        } else {
          cellFlags[idx] |= URBAN_CELL_BIT_ROAD;
        }
        roadMask[idx] = 1;
        localTrunkCells.push([x, y]);
      }
    }
  }

  // 2. Anillo perimetral extractThinRing(mSat)
  const beltwayMask = extractThinRing(mSat, width, height);
  const beltwayPts: Array<[number, number]> = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (beltwayMask[idx]) {
        if (!roadMask[idx] && !wouldMake2x2(roadMask, width, height, x, y)) {
          roadMask[idx] = 1;
          cellFlags[idx] |= URBAN_CELL_BIT_ROAD | URBAN_CELL_BIT_BELTWAY;
        } else if (roadMask[idx]) {
          cellFlags[idx] |= URBAN_CELL_BIT_BELTWAY;
        }
        beltwayPts.push([x, y]);
      }
    }
  }

  let mainHubPt: [number, number] = beltwayPts.length > 0 ? beltwayPts[0] : [rbtCx, rbtCy];

  // 3. Rotonda 5x5 o 3x3 + mediana Y-flare con pinos (igual que Crossroads South)
  const roundabouts: RoundaboutRecord[] = [];
  if (fSpec.hasRbt && mSat[rbtCy * width + rbtCx]) {
    const rUse: 1 | 2 = fSpec.rbtR === 2 && width >= 26 ? 2 : 1;
    const ringPts = stampChamferedRoundabout(
      roadMask,
      cellFlags,
      rbtProtectedMask,
      width,
      height,
      rbtCx,
      rbtCy,
      rUse
    );
    if (ringPts.length > 0) mainHubPt = ringPts[0];
    roundabouts.push({
      id: `rbt_sat_${spec.cityId}`,
      centerX: rbtCx,
      centerY: rbtCy,
      radius: rUse,
      role: 'primary',
    });

    if (fSpec.hasYFlare && rbtCy + rUse + 3 < height - 1) {
      const yApex = rbtCy + rUse + 3;
      for (let fy = rbtCy + rUse + 1; fy <= yApex; fy++) {
        for (const fx of [rbtCx - 1, rbtCx + 1]) {
          if (fx >= 1 && fx < width - 1 && !wouldMake2x2(roadMask, width, height, fx, fy)) {
            roadMask[fy * width + fx] = 1;
            cellFlags[fy * width + fx] |= URBAN_CELL_BIT_ROAD;
          }
        }
        const midIdx = fy * width + rbtCx;
        if (fy === yApex) {
          if (!wouldMake2x2(roadMask, width, height, rbtCx, fy)) {
            roadMask[midIdx] = 1;
            cellFlags[midIdx] |= URBAN_CELL_BIT_ROAD;
          }
        } else {
          roadMask[midIdx] = 0;
          cellFlags[midIdx] &= ~URBAN_CELL_BIT_ROAD;
          cellFlags[midIdx] |= URBAN_CELL_BIT_PARK;
          rbtProtectedMask[midIdx] = 1;
        }
      }
    }
  }

  // 4. Espinas internas ortogonales conectando centro al beltway
  for (const ang of [0, Math.PI * 0.5, Math.PI, Math.PI * 1.5]) {
    if (beltwayPts.length === 0) break;
    let bestPt = beltwayPts[0];
    let bestProj = -Infinity;
    const ca = Math.cos(ang);
    const sa = Math.sin(ang);
    for (const [bx, by] of beltwayPts) {
      const p = (bx - rbtCx) * ca + (by - rbtCy) * sa;
      if (p > bestProj) {
        bestProj = p;
        bestPt = [bx, by];
      }
    }
    const pts = trace4ConnNo2x2(roadMask, width, height, mainHubPt, bestPt, mSat, null, beltwayMask);
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

  // 5. Puertas multi-eje (3-4 direcciones secas) + empalme con la Línea Amarilla Base
  const perimeterPortalsGlobal: Array<[number, number]> = [];
  let pMerge: [number, number] = mainHubPt;
  let trunkInteractionMode: YellowTrunkCityInteractionMode = 'trunk_spur_precompiled';

  if (beltwayPts.length > 0) {
    // Extraer hasta 4 puertas cardinales bien separadas (>= 7 tiles) sobre el anillo
    const gateSelectors: Array<(p: [number, number]) => number> = [
      (p) => -p[1], // Sur (primary apex)
      (p) => p[1],  // Norte
      (p) => p[0],  // Oeste
      (p) => -p[0], // Este
    ];
    const localGates: Array<[number, number]> = [];
    for (const sel of gateSelectors) {
      let bestG = beltwayPts[0];
      let bestV = Infinity;
      for (const pt of beltwayPts) {
        const v = sel(pt);
        if (v < bestV) {
          bestV = v;
          bestG = pt;
        }
      }
      if (localGates.every((g) => Math.abs(g[0] - bestG[0]) + Math.abs(g[1] - bestG[1]) >= 7)) {
        localGates.push(bestG);
        perimeterPortalsGlobal.push([originGlobalX + bestG[0], originGlobalY + bestG[1]]);
      }
    }
    if (localGates.length > 0) pMerge = localGates[0];
  }

  if (localTrunkCells.length > 0 && beltwayPts.length > 0) {
    let bestD = Infinity;
    let bestT = localTrunkCells[0];
    let bestB = beltwayPts[0];
    for (const [tx, ty] of localTrunkCells) {
      for (const [bx, by] of beltwayPts) {
        const d = Math.abs(tx - bx) + Math.abs(ty - by);
        if (d < bestD) {
          bestD = d;
          bestT = [tx, ty];
          bestB = [bx, by];
        }
      }
    }
    pMerge = bestB;
    trunkInteractionMode = bestD <= 2 ? 'pass_through_absorb' : bestD <= 6 ? 'tangential_bypass' : 'trunk_spur_precompiled';
    if (bestD > 0) {
      const spur = trace4ConnNo2x2(roadMask, width, height, bestB, bestT, masks.dryGlobalMask);
      if (spur) {
        for (const [px, py] of spur) {
          const pIdx = py * width + px;
          if (!roadMask[pIdx] && !wouldMake2x2(roadMask, width, height, px, py)) {
            roadMask[pIdx] = 1;
            cellFlags[pIdx] |= URBAN_CELL_BIT_ROAD;
          }
        }
      }
    }
  }

  // Peel 2x2 y cierre k-core
  const protYellow = new Uint8Array(width * height);
  for (let i = 0; i < protYellow.length; i++) {
    if ((cellFlags[i] & (URBAN_CELL_BIT_YELLOW_TRUNK | URBAN_CELL_BIT_BRIDGE)) !== 0) protYellow[i] = 1;
  }
  const peeled = peel2x2(roadMask, width, height, protYellow);
  for (let i = 0; i < peeled.length; i++) {
    if (roadMask[i] && !peeled[i]) {
      roadMask[i] = 0;
      cellFlags[i] &= ~(URBAN_CELL_BIT_ROAD | URBAN_CELL_BIT_BELTWAY);
    }
  }

  const buildingsByLocalIdx = new Map<number, UrbanBuildingPlacement>();
  const buildingsMask = new Uint8Array(width * height);

  // Cerrar o podar puntas deg <= 1 antes de poblar edificios (incluyendo bordes de beltway rotos)
  for (let pass = 0; pass < 16; pass++) {
    let ch = false;
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const idx = y * width + x;
        if (!roadMask[idx] || protYellow[idx]) continue;
        if (x === pMerge[0] && y === pMerge[1]) continue;
        if (orthoDegree(roadMask, width, height, x, y) <= 1) {
          const closed = closeLoopFromDeg1(roadMask, buildingsMask, mSat, null, width, height, [x, y], null, 6);
          if (!closed) {
            roadMask[idx] = 0;
            cellFlags[idx] &= ~(URBAN_CELL_BIT_ROAD | URBAN_CELL_BIT_BELTWAY);
          } else {
            for (let k = 0; k < roadMask.length; k++) if (roadMask[k]) cellFlags[k] |= URBAN_CELL_BIT_ROAD;
          }
          ch = true;
        }
      }
    }
    if (!ch) break;
  }

  // 6. Colocar edificios 100 % GRISES NEUTRALES (ownerId: null) adyacentes a carretera
  const { labels } = connectedComponents4(roadMask, width, height);
  const mainCid = labels[mainHubPt[1] * width + mainHubPt[0]];
  const lots: Array<[number, number]> = [];
  for (let y = 2; y < height - 2; y++) {
    for (let x = 2; x < width - 2; x++) {
      const idx = y * width + x;
      if (!mSat[idx] || roadMask[idx] || rbtProtectedMask[idx]) continue;
      const touchesMain = CARDINAL_DIRS.some(([dx, dy]) => {
        const nx = x + dx;
        const ny = y + dy;
        return roadMask[ny * width + nx] !== 0 && (mainCid <= 0 || labels[ny * width + nx] === mainCid);
      });
      if (touchesMain) lots.push([x, y]);
    }
  }
  lots.sort(
    (a, b) =>
      Math.hypot(a[0] - rbtCx, a[1] - rbtCy) - Math.hypot(b[0] - rbtCx, b[1] - rbtCy)
  );

  const safePlaceSat = (bx: number, by: number, bt: InitialNeutralBuildingType): boolean => {
    const idx = by * width + bx;
    if (buildingsMask[idx] || !dryMunicipalityMask[idx]) return false;
    if (AWBW_BUILDING_OVERHANG_PX[bt] >= 8 && buildingsMask[(by - 1) * width + bx]) return false;
    const southB = buildingsByLocalIdx.get((by + 1) * width + bx);
    if (southB && southB.overhangPx >= 8) return false;
    buildingsByLocalIdx.set(idx, {
      localX: bx,
      localY: by,
      globalX: originGlobalX + bx,
      globalY: originGlobalY + by,
      type: bt,
      ownerId: null,
      overhangPx: AWBW_BUILDING_OVERHANG_PX[bt],
      neutralSkinVariant: 0,
      districtId: `sat_${family}`,
    });
    buildingsMask[idx] = 1;
    if (bt === 'port') cellFlags[idx] |= URBAN_CELL_BIT_PORT_WATER;
    cellFlags[idx] &= ~URBAN_CELL_BIT_PARK;
    return true;
  };

  // Colocar 2-3 puertos marítimos directamente en la costa navegable si es harbor_promenade_cove (Port Veridian)
  if (family === 'harbor_promenade_cove' || spec.waterfrontDir !== 'none') {
    const portCands: Array<[number, number]> = [];
    for (let y = 2; y < height - 2; y++) {
      for (let x = 2; x < width - 2; x++) {
        const idx = y * width + x;
        if (portCoastMask[idx] && dryMunicipalityMask[idx] && !roadMask[idx] && !buildingsMask[idx]) {
          const adjR = CARDINAL_DIRS.some(([dx, dy]) => roadMask[(y + dy) * width + (x + dx)] !== 0);
          if (adjR) portCands.push([x, y]);
        }
      }
    }
    const chosenPorts: Array<[number, number]> = [];
    for (const pt of portCands) {
      if (chosenPorts.length >= 3) break;
      if (chosenPorts.every((p) => Math.hypot(p[0] - pt[0], p[1] - pt[1]) >= 3)) {
        if (safePlaceSat(pt[0], pt[1], 'port')) {
          chosenPorts.push(pt);
        }
      }
    }
  }

  // Agrupar edificios ordenadamente de arriba hacia abajo (respetando bolsillos abiertos)
  lots.sort((a, b) => (a[1] !== b[1] ? a[1] - b[1] : a[0] - b[0]));
  const targetBudget = Math.min(22, Math.max(fSpec.bldgBudget, spec.neutralBuildings.total));
  let specIdx = 0;
  for (const [lx, ly] of lots) {
    if (buildingsByLocalIdx.size >= targetBudget) break;
    if (buildingsMask[ly * width + lx]) continue;
    if (specIdx < fSpec.specialRoster.length) {
      const nextT = fSpec.specialRoster[specIdx];
      if (nextT === 'port') {
        specIdx++;
      } else if (safePlaceSat(lx, ly, nextT)) {
        specIdx++;
        continue;
      }
    }
    if (buildingsByLocalIdx.size >= 12 && detHashInt(lx, ly, seed + 77) % 8 === 0) {
      cellFlags[ly * width + lx] |= URBAN_CELL_BIT_PARK;
      continue;
    }
    safePlaceSat(lx, ly, 'city');
  }

  // Corona periurbana de árboles
  let crowns = 0;
  for (let y = 1; y < height - 1 && crowns < 12; y++) {
    for (let x = 1; x < width - 1 && crowns < 12; x++) {
      const idx = y * width + x;
      if (mSat[idx] || !dryMunicipalityMask[idx] || roadMask[idx] || buildingsMask[idx]) continue;
      let nearB = false;
      for (let dy = -2; dy <= 2 && !nearB; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx >= 0 && nx < width && ny >= 0 && ny < height && beltwayMask[ny * width + nx]) {
            nearB = true;
            break;
          }
        }
      }
      if (nearB && detHashInt(x, y, seed + 99) % 3 === 0) {
        cellFlags[idx] |= URBAN_CELL_BIT_TREE_CROWN;
        crowns++;
      }
    }
  }

  let tallOverhangViolations = 0;
  for (const b of buildingsByLocalIdx.values()) {
    if (b.overhangPx >= 8 && b.localY > 0 && buildingsMask[(b.localY - 1) * width + b.localX]) {
      tallOverhangViolations++;
    }
  }

  let interiorDeadEnds = 0;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x;
      if (!roadMask[idx] || protYellow[idx]) continue;
      if (x === pMerge[0] && y === pMerge[1]) continue;
      if (orthoDegree(roadMask, width, height, x, y) <= 1) interiorDeadEnds++;
    }
  }

  const plainInt = new Uint8Array(width * height);
  for (let i = 0; i < plainInt.length; i++) {
    if (mSat[i] && !roadMask[i] && !buildingsMask[i] && (cellFlags[i] & URBAN_CELL_BIT_PARK) === 0) {
      plainInt[i] = 1;
    }
  }

  return {
    spec,
    originGlobalX,
    originGlobalY,
    width,
    height,
    safeCenterLocalX,
    safeCenterLocalY,
    trunkInteractionMode,
    cellFlags,
    bridgeAxis,
    buildingsByLocalIdx,
    perimeterPortalsGlobal,
    roundabouts,
    functionalDistricts: [],
    metrics: {
      dryAreaTiles,
      buildingCount: buildingsByLocalIdx.size,
      roadBlob2x2Count: count2x2Blobs(roadMask, width, height),
      tallOverhangViolations,
      interiorDeadEnds,
      maxEmptySquareSide: maxEmptySquareSide(plainInt, width, height),
      functionalDistrictsCount: 0,
      distinctMicroGrainsCount: Math.max(2, spec.microGrains.length),
      topoSignature9D: computeTopoSignature9D(mSat, roadMask, buildingsMask, roundabouts.length, width, height),
    },
  };
}
