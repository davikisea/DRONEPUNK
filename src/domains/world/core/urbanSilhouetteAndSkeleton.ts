/**
 * ==============================================================================
 * SILUETAS CHAIKIN (5 FAMILIAS), BELTWAY_REAL 0-BLOBS Y ESQUELETO ARTERIAL
 * ==============================================================================
 * Port 100 % fiel de 09_city_world_engine.py (v6.0.0-awbw, L1259-1355, L2705-3088):
 * - 5 familias matemáticas de silueta:
 *   1. harmonic_fourier_polygon (20 vértices + Chaikin 0.78/0.22 x2)
 *   2. multi_ellipse_metaball (2..4 lóbulos gaussianos >= 0.52)
 *   3. coastal_arc_crescent (asimetría espejo + sustracción de bahía)
 *   4. river_corridor_split (doble lóbulo con cintura estrecha)
 *   5. alpine_wedge_terrace (3 terrazas cuantizadas + ala lateral)
 * - cleanLobeMask + notch carving (notch_hw = 3 en x3/x2, 2 en x1)
 * - beltway_real = extractThinRing(inlandReal) (0 bloques 2x2)
 * - Rotonda primaria R7 (x3) / R5 (x2/x1) + sub-rotonda secundaria R5 en x3
 * - 8 topologías arteriales + 6 patrones de acceso regional empalmados a Línea Amarilla
 * ==============================================================================
 */

import {
  URBAN_CELL_BIT_BELTWAY,
  URBAN_CELL_BIT_BRIDGE,
  URBAN_CELL_BIT_LOBE,
  URBAN_CELL_BIT_PARK,
  URBAN_CELL_BIT_ROAD,
  URBAN_CELL_BIT_YELLOW_TRUNK,
  type CityDnaProfile,
  type CityScaleSpec,
  type RoundaboutRecord,
  type YellowTrunkCityInteractionMode,
} from '../types/urbanMorphologyTypes';
import type { UrbanContainmentMasks } from './urbanContainmentMasks';
import {
  getYellowTrunkBridgeAxisAtGlobalCell,
  isYellowTrunkAtGlobalCell,
} from './yellowTrunkBackboneIndex';
import {
  bfsDistance,
  chaikinSmooth,
  cleanLobeMask,
  connectedComponents4,
  count2x2Blobs,
  detHash32,
  detHashInt,
  erode8,
  extractThinRing,
  peel2x2,
  rasterizePolygon,
  trace4ConnNo2x2,
  wouldMake2x2,
} from './urbanMorphologyPrimitives';
import { resolveCityDnaProfile } from './urbanVariabilityEngine';

export interface SynthesizedSilhouetteResult {
  readonly inlandMask: Uint8Array;
  readonly dryAreaTiles: number;
  readonly rbtCenterX: number;
  readonly rbtCenterY: number;
  readonly rbtRadius: 2 | 3;
  readonly approachDir: readonly [number, number];
  readonly lateralDir: readonly [number, number];
  readonly notchHw: number;
}

export interface ArterialSkeletonResult {
  readonly trunkInteractionMode: YellowTrunkCityInteractionMode;
  readonly perimeterPortalsGlobal: Array<[number, number]>;
  readonly beltwayMask: Uint8Array;
  readonly roadMask: Uint8Array;
  readonly rbtProtectedMask: Uint8Array;
  readonly approachProtectedMask: Uint8Array;
  readonly mainHubPt: readonly [number, number];
  readonly pMerge: readonly [number, number];
  readonly roundabouts: RoundaboutRecord[];
}

export function count2x2RoadBlobs(cellFlags: Uint8Array, width: number, height: number): number {
  const rm = new Uint8Array(width * height);
  for (let i = 0; i < rm.length; i++) {
    if ((cellFlags[i] & (URBAN_CELL_BIT_ROAD | URBAN_CELL_BIT_BRIDGE)) !== 0) rm[i] = 1;
  }
  return count2x2Blobs(rm, width, height);
}

export function peel2x2RoadCorners(cellFlags: Uint8Array, width: number, height: number): void {
  const rm = new Uint8Array(width * height);
  const prot = new Uint8Array(width * height);
  for (let i = 0; i < rm.length; i++) {
    if ((cellFlags[i] & (URBAN_CELL_BIT_ROAD | URBAN_CELL_BIT_BRIDGE)) !== 0) rm[i] = 1;
    if ((cellFlags[i] & (URBAN_CELL_BIT_YELLOW_TRUNK | URBAN_CELL_BIT_BRIDGE)) !== 0) prot[i] = 1;
  }
  const peeled = peel2x2(rm, width, height, prot);
  for (let i = 0; i < rm.length; i++) {
    if (rm[i] && !peeled[i]) {
      cellFlags[i] &= ~URBAN_CELL_BIT_ROAD;
      cellFlags[i] &= ~URBAN_CELL_BIT_BELTWAY;
    }
  }
}

/**
 * Rasteriza exactamente una de las 5 familias de silueta de 09_city_world_engine.py (L1259-1355).
 */
function rasterizeSilhouetteFamily(
  dna: CityDnaProfile,
  cx: number,
  cy: number,
  w: number,
  h: number,
  waterfrontDir: CityScaleSpec['waterfrontDir'],
  seed: number,
  radiusScale: number
): Uint8Array {
  const mask = new Uint8Array(w * h);
  const sf = Math.max(0.55, radiusScale);
  const ca = Math.cos(-dna.angleRad);
  const sa = Math.sin(-dna.angleRad);

  if (dna.silhouetteFamily === 'harmonic_fourier_polygon') {
    const hCoefs = dna.harmonics.length > 0 ? dna.harmonics : [0.18, -0.11, 0.06];
    const nPts = 20;
    const r0 = 17.0 * sf;
    const pts: Array<[number, number]> = [];
    for (let i = 0; i < nPts; i++) {
      const th = (2 * Math.PI * i) / nPts;
      let mod = 1.0;
      for (let kh = 0; kh < Math.min(4, hCoefs.length); kh++) {
        const phase = ((detHashInt(kh, 71, seed) % 628) / 100.0) + 1.1;
        mod += 1.55 * hCoefs[kh] * Math.cos((kh + 2) * th + phase);
      }
      mod = Math.max(0.5, Math.min(1.52, mod));
      pts.push([
        cx + r0 * mod * Math.cos(th + dna.angleRad),
        cy + r0 * mod * 0.88 * Math.sin(th + dna.angleRad),
      ]);
    }
    const smoothed = chaikinSmooth(pts, 2);
    return rasterizePolygon(smoothed, w, h);
  }

  if (dna.silhouetteFamily === 'multi_ellipse_metaball') {
    const nLobes = Math.max(2, Math.min(4, dna.lobeCount));
    const lobes: Array<{ ox: number; oy: number; rx: number; ry: number; ct: number; st: number }> = [];
    for (let idxL = 0; idxL < nLobes; idxL++) {
      const angL =
        (2 * Math.PI * idxL) / nLobes +
        (((detHashInt(idxL, 17, seed) % 100) / 100.0) - 0.5) * 0.95;
      const distL = (8.8 + (detHashInt(idxL, 31, seed) % 35) * 0.14) * sf;
      const thL = angL + 0.65 * idxL;
      lobes.push({
        ox: Math.cos(angL) * distL,
        oy: Math.sin(angL) * distL * 0.78,
        rx: Math.max(1.0, (9.6 + (detHashInt(idxL, 43, seed) % 35) * 0.12) * sf),
        ry: Math.max(1.0, (4.4 + (detHashInt(idxL, 59, seed) % 25) * 0.08) * sf),
        ct: Math.cos(thL),
        st: Math.sin(thL),
      });
    }
    for (let y = 0; y < h; y++) {
      const dy = y - cy;
      for (let x = 0; x < w; x++) {
        const dx = x - cx;
        const lx = dx * ca - dy * sa;
        const ly = dx * sa + dy * ca;
        let field = 0;
        for (let i = 0; i < lobes.length; i++) {
          const lb = lobes[i];
          const ux = (lx - lb.ox) * lb.ct + (ly - lb.oy) * lb.st;
          const uy = -(lx - lb.ox) * lb.st + (ly - lb.oy) * lb.ct;
          field += Math.exp(-((ux / lb.rx) ** 2 + (uy / lb.ry) ** 2));
        }
        if (field >= 0.52) mask[y * w + x] = 1;
      }
    }
    return mask;
  }

  if (dna.silhouetteFamily === 'coastal_arc_crescent') {
    const isNs = waterfrontDir === 'N' || waterfrontDir === 'S';
    const signOut = waterfrontDir === 'W' || waterfrontDir === 'N' ? -1.0 : 1.0;
    const bayR = (9.5 + dna.concavity * 9.0) * sf;
    for (let y = 0; y < h; y++) {
      const dy = y - cy;
      for (let x = 0; x < w; x++) {
        const dx = x - cx;
        const lx = dx * ca - dy * sa;
        const ly = dx * sa + dy * ca;
        const axU = isNs ? lx : ly;
        const axV = isNs ? ly : lx;
        const uNorm = axU / (19.5 * sf);
        if (Math.abs(uNorm) > 1.05) continue;
        const uSqClip = Math.min(1.5, uNorm * uNorm);
        const bow = (0.35 + dna.concavity * 1.4) * (1.0 - uSqClip) * 11.5 * sf;
        const vCenter = -signOut * (0.35 * bow) + signOut * (10.5 * sf);
        const uClip = Math.max(-1.0, Math.min(1.0, uNorm));
        const halfThick = (9.2 + 2.6 * Math.cos(uNorm * 1.4)) * (1.0 + 0.24 * uClip) * sf;
        const radTerm = Math.sqrt(Math.max(0, 1.0 - (uNorm * 0.9) ** 2));
        if (Math.abs(axV - vCenter) <= halfThick * radTerm) {
          const bayDist = Math.hypot(axU - 3.6 * sf, axV - signOut * (19.5 * sf));
          if (bayDist >= bayR * 0.72) {
            mask[y * w + x] = 1;
          }
        }
      }
    }
    return mask;
  }

  if (dna.silhouetteFamily === 'river_corridor_split') {
    const dLobe = 8.8 * sf;
    const rA = 11.2 * sf;
    const rB = 10.0 * sf;
    const waistH = Math.max(3.8, (6.8 - dna.concavity * 6.0) * sf);
    for (let y = 0; y < h; y++) {
      const dy = y - cy;
      for (let x = 0; x < w; x++) {
        const dx = x - cx;
        const lx = dx * ca - dy * sa;
        const ly = dx * sa + dy * ca;
        const inA = ((lx + dLobe) / rA) ** 2 + ((ly + 1.2 * sf) / (rA * 0.94)) ** 2 <= 1.0;
        const inB = ((lx - dLobe) / rB) ** 2 + ((ly - 2.2 * sf) / (rB * 0.86)) ** 2 <= 1.0;
        const inW = Math.abs(lx) <= dLobe * 0.9 && Math.abs(ly - 0.5 * sf) <= waistH;
        if (inA || inB || inW) mask[y * w + x] = 1;
      }
    }
    return mask;
  }

  // alpine_wedge_terrace
  const yTop = -12.0 * sf;
  const yBot = 14.2 * sf;
  const spanY = Math.max(1.0, yBot - yTop);
  for (let y = 0; y < h; y++) {
    const dy = y - cy;
    for (let x = 0; x < w; x++) {
      const dx = x - cx;
      const lx = dx * ca - dy * sa;
      const ly = dx * sa + dy * ca;
      const ty = Math.max(0, Math.min(1, (ly - yTop) / spanY));
      const tier = Math.floor(ty * 3.0) / 3.0;
      const halfW = (4.2 + 14.5 * (0.45 * ty + 0.55 * tier)) * sf;
      const stepShift = -2.2 * sf * (1.0 - ty);
      const inCore =
        ly >= yTop &&
        ly <= yBot &&
        Math.abs(lx - stepShift) <= halfW &&
        Math.abs(lx - stepShift) + Math.max(0, -ly - 5.5 * sf) <= 14.5 * sf;
      const inWing =
        lx >= 4.5 * sf && lx <= 19.5 * sf && ly >= 3.5 * sf && ly <= 13.0 * sf;
      if (inCore || inWing) mask[y * w + x] = 1;
    }
  }
  return mask;
}

/**
 * Sintetiza la silueta orgánica de la ciudad contenida en M_dry_mun(c) (0 agua, 0 ríos),
 * aplica cleanLobeMask + notch carving y encuentra el centro profundo para la rotonda primaria.
 */
export function synthesizeUrbanSilhouette(
  spec: CityScaleSpec,
  masks: UrbanContainmentMasks,
  safeCenterX: number,
  safeCenterY: number,
  cellFlags: Uint8Array,
  dnaOverride?: CityDnaProfile
): SynthesizedSilhouetteResult {
  const { width, height, dryMunicipalityMask } = masks;
  const dna = dnaOverride ?? resolveCityDnaProfile(spec);
  const seed = detHash32(`${spec.cityId}_silhouette_v6`);

  // Escala espacial calibrada para encajar en el canvas (60x60 para x3, 40x40 para x2/x1)
  const radiusScale = Math.max(0.55, Math.min(1.45, spec.radiusTiles / 18.0));
  const rawFamily = rasterizeSilhouetteFamily(
    dna,
    safeCenterX,
    safeCenterY,
    width,
    height,
    spec.waterfrontDir,
    seed,
    radiusScale
  );

  // Intersección estricta con M_dry_mun(c) (que ya excluye mar y ríos)
  const intersected = new Uint8Array(width * height);
  let interCount = 0;
  for (let i = 0; i < intersected.length; i++) {
    if (rawFamily[i] && dryMunicipalityMask[i]) {
      intersected[i] = 1;
      interCount++;
    }
  }

  // Fallback seguro si una silueta costera fue recortada demasiado por un borde municipal estrecho
  let workingMask = intersected;
  const minTargetArea = Math.max(60, Math.floor(spec.targetDryAreaTiles * 0.35));
  if (interCount < minTargetArea) {
    const fallback = new Uint8Array(width * height);
    const r = Math.max(6, Math.min(spec.radiusTiles, Math.floor(Math.min(width, height) / 2) - 3));
    for (let y = 2; y < height - 2; y++) {
      for (let x = 2; x < width - 2; x++) {
        const dx = x - safeCenterX;
        const dy = y - safeCenterY;
        const ang = Math.atan2(dy, dx);
        const mod = 1 + 0.14 * Math.cos(3 * ang + dna.angleRad) - 0.08 * Math.sin(2 * ang);
        if (Math.hypot(dx, dy) <= r * mod && dryMunicipalityMask[y * width + x]) {
          fallback[y * width + x] = 1;
        }
      }
    }
    workingMask = fallback;
  }

  const borderMargin = width >= 50 ? 3 : 2;
  let inlandMask = cleanLobeMask(workingMask, width, height, safeCenterX, safeCenterY, borderMargin);

  // Dirección de aproximación y lateral ortogonal
  const approachDir: [number, number] =
    spec.waterfrontDir === 'W'
      ? [1, 0]
      : spec.waterfrontDir === 'E'
      ? [-1, 0]
      : spec.waterfrontDir === 'N'
      ? [0, 1]
      : [0, -1];
  const lateralDir: [number, number] = [-approachDir[1], approachDir[0]];

  const isHighScale =
    spec.engineScale === 'x5' ||
    spec.engineScale === 'x4' ||
    spec.engineScale === 'x3';
  const rbtRadius: 2 | 3 = isHighScale ? 3 : 2;
  const notchHw = spec.engineScale === 'x1' ? 2 : 3;

  // Encontrar centro profundo dentro de inlandMask para la rotonda primaria
  const invInland = new Uint8Array(width * height);
  for (let i = 0; i < invInland.length; i++) invInland[i] = inlandMask[i] ? 0 : 1;
  const dInland = bfsDistance(invInland, width, height);

  let rbtCenterX = safeCenterX;
  let rbtCenterY = safeCenterY;
  const minDepthReq = rbtRadius + 1;
  if (
    rbtCenterX < 0 ||
    rbtCenterX >= width ||
    rbtCenterY < 0 ||
    rbtCenterY >= height ||
    dInland[rbtCenterY * width + rbtCenterX] < minDepthReq
  ) {
    let maxD = 0;
    for (let i = 0; i < dInland.length; i++) {
      if (dInland[i] > maxD) maxD = dInland[i];
    }
    if (maxD > 0) {
      const thresh = Math.max(1, maxD - 1);
      let bestDistSq = Infinity;
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          if (dInland[y * width + x] >= thresh) {
            const dSq = (x - safeCenterX) ** 2 + (y - safeCenterY) ** 2;
            if (dSq < bestDistSq) {
              bestDistSq = dSq;
              rbtCenterX = x;
              rbtCenterY = y;
            }
          }
        }
      }
    }
  }

  // Notch carving para divided_stem y y_fork_approach
  const useNotch =
    (dna.regionalAccessPattern === 'divided_stem' ||
      dna.regionalAccessPattern === 'y_fork_approach') &&
    width >= 40;
  if (useNotch) {
    const notched = new Uint8Array(inlandMask);
    const [ax, ay] = approachDir;
    const [lxv, lyv] = lateralDir;
    for (let k = rbtRadius + 1; k < Math.floor(width / 2); k++) {
      for (let lat = -notchHw; lat <= notchHw; lat++) {
        const nx = rbtCenterX + ax * k + lxv * lat;
        const ny = rbtCenterY + ay * k + lyv * lat;
        if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
          notched[ny * width + nx] = 0;
        }
      }
    }
    const cleanedNotch = cleanLobeMask(notched, width, height, rbtCenterX, rbtCenterY, borderMargin);
    let notchArea = 0;
    for (let i = 0; i < cleanedNotch.length; i++) if (cleanedNotch[i]) notchArea++;
    if (notchArea >= Math.floor(minTargetArea * 0.8)) {
      inlandMask = cleanedNotch;
    }
  }

  let dryAreaTiles = 0;
  for (let i = 0; i < inlandMask.length; i++) {
    if (inlandMask[i]) {
      cellFlags[i] |= URBAN_CELL_BIT_LOBE;
      dryAreaTiles++;
    }
  }

  return {
    inlandMask,
    dryAreaTiles,
    rbtCenterX,
    rbtCenterY,
    rbtRadius,
    approachDir,
    lateralDir,
    notchHw,
  };
}

/**
 * Estampa una rotonda octogonal achaflanada R5 (5x5, r=2) o R7 (7x7, r=3)
 * con isla verde central (port exacto de _stamp_chamfered_roundabout, L2705-2758).
 */
export function stampChamferedRoundabout(
  roadMask: Uint8Array,
  cellFlags: Uint8Array,
  rbtProtectedMask: Uint8Array,
  width: number,
  height: number,
  cx: number,
  cy: number,
  radius: 1 | 2 | 3
): Array<[number, number]> {
  const ringPts: Array<[number, number]> = [];
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const px = cx + dx;
      const py = cy + dy;
      if (px < 1 || px >= width - 1 || py < 1 || py >= height - 1) continue;
      const adx = Math.abs(dx);
      const ady = Math.abs(dy);
      const manh = adx + ady;
      let isRing = false;
      let isIsl = false;

      if (radius === 3) {
        isRing =
          (ady === 3 && adx <= 1) ||
          (ady === 2 && (adx === 1 || adx === 2)) ||
          (ady === 1 && (adx === 2 || adx === 3)) ||
          (ady === 0 && adx === 3);
        isIsl = manh <= 2;
      } else if (radius === 2) {
        isRing =
          (ady === 2 && adx <= 1) ||
          (ady === 1 && (adx === 1 || adx === 2)) ||
          (ady === 0 && adx === 2);
        isIsl = manh <= 1;
      } else {
        isRing = Math.max(adx, ady) === 1;
        isIsl = adx === 0 && ady === 0;
      }

      const idx = py * width + px;
      if (isRing) {
        roadMask[idx] = 1;
        cellFlags[idx] |= URBAN_CELL_BIT_ROAD;
        cellFlags[idx] &= ~URBAN_CELL_BIT_PARK;
        rbtProtectedMask[idx] = 1;
        ringPts.push([px, py]);
      } else if (isIsl) {
        roadMask[idx] = 0;
        cellFlags[idx] &= ~URBAN_CELL_BIT_ROAD;
        rbtProtectedMask[idx] = 1;
        if (manh <= (radius === 3 ? 1 : 0)) {
          cellFlags[idx] |= URBAN_CELL_BIT_PARK;
        }
      } else if (radius >= 2 && adx === radius && ady === radius) {
        // Proteger esquinas achaflanadas externas para que el octágono nunca se deforme a cuadrado
        roadMask[idx] = 0;
        cellFlags[idx] &= ~URBAN_CELL_BIT_ROAD;
        rbtProtectedMask[idx] = 1;
      }
      if (adx <= radius && ady <= radius) {
        rbtProtectedMask[idx] = 1;
      }
    }
  }
  return ringPts;
}

/**
 * Construye beltway_real (extractThinRing 0-blobs), rotonda primaria + secundaria (x3),
 * espinas arteriales (8 topologías) y empalme con la Línea Amarilla Base (6 patrones).
 */
export function buildArterialSkeletonAndYellowSplice(
  spec: CityScaleSpec,
  dna: CityDnaProfile,
  sil: SynthesizedSilhouetteResult,
  masks: UrbanContainmentMasks,
  originGlobalX: number,
  originGlobalY: number,
  cellFlags: Uint8Array,
  bridgeAxis: Uint8Array,
  landPredicate: (lng: number, lat: number) => boolean
): ArterialSkeletonResult {
  const { width, height } = masks;
  const { inlandMask, rbtCenterX, rbtCenterY, rbtRadius, approachDir, lateralDir, notchHw } = sil;
  const roadMask = new Uint8Array(width * height);
  const rbtProtectedMask = new Uint8Array(width * height);
  const approachProtectedMask = new Uint8Array(width * height);

  // 1. Proyectar Línea Amarilla Base inmutable (Priority-0) dentro de la ventana
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

  // 2. beltway_real continuo de 1 tile sin blobs 2x2 vía extractThinRing(inlandMask)
  const beltwayMask = extractThinRing(inlandMask, width, height);
  const [ax, ay] = approachDir;
  const [lxv, lyv] = lateralDir;
  const isHighScale =
    spec.engineScale === 'x5' ||
    spec.engineScale === 'x4' ||
    spec.engineScale === 'x3';
  const useRbt =
    dna.arterialSkeleton === 'eccentric_roundabout' ||
    dna.arterialSkeleton === 'radial_annular' ||
    isHighScale;
  const useNotch =
    dna.regionalAccessPattern === 'divided_stem' ||
    dna.regionalAccessPattern === 'y_fork_approach';

  if (useRbt && useNotch) {
    for (let k = rbtRadius; k <= rbtRadius + 2; k++) {
      for (let lat = -rbtRadius; lat <= rbtRadius; lat++) {
        const nx = rbtCenterX + ax * k + lxv * lat;
        const ny = rbtCenterY + ay * k + lyv * lat;
        if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
          beltwayMask[ny * width + nx] = 0;
        }
      }
    }
  }

  let mainHubPt: [number, number] = [rbtCenterX, rbtCenterY];
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
  if (beltwayPts.length > 0) {
    mainHubPt = beltwayPts[0];
  }

  // 3. Rotonda primaria + sub-rotonda secundaria en x3 (L2838-2900)
  const roundabouts: RoundaboutRecord[] = [];
  if (useRbt) {
    const ring0 = stampChamferedRoundabout(
      roadMask,
      cellFlags,
      rbtProtectedMask,
      width,
      height,
      rbtCenterX,
      rbtCenterY,
      rbtRadius
    );
    if (ring0.length > 0) mainHubPt = ring0[0];
    roundabouts.push({
      id: `rbt_${spec.cityId}_0`,
      centerX: rbtCenterX,
      centerY: rbtCenterY,
      radius: rbtRadius,
      role: 'primary',
    });

    // Paredes laterales de la muesca conectadas al borde de la rotonda
    if (useNotch) {
      for (const sgn of [-1, 1] as const) {
        const latWall = sgn * (notchHw + 1);
        let wallPt: [number, number] | null = null;
        for (let kw = rbtRadius + 2; kw >= -2; kw--) {
          const wx = rbtCenterX + ax * kw + lxv * latWall;
          const wy = rbtCenterY + ay * kw + lyv * latWall;
          if (wx >= 1 && wx < width - 1 && wy >= 1 && wy < height - 1 && beltwayMask[wy * width + wx]) {
            wallPt = [wx, wy];
            break;
          }
        }
        const sideRim: [number, number] = [
          Math.max(1, Math.min(width - 2, rbtCenterX + lxv * sgn * rbtRadius)),
          Math.max(1, Math.min(height - 2, rbtCenterY + lyv * sgn * rbtRadius)),
        ];
        if (wallPt) {
          const allowUnion = new Uint8Array(width * height);
          for (let i = 0; i < allowUnion.length; i++) {
            allowUnion[i] = inlandMask[i] || roadMask[i] ? 1 : 0;
          }
          const ptsC = trace4ConnNo2x2(roadMask, width, height, wallPt, sideRim, allowUnion);
          if (ptsC) {
            for (const [px, py] of ptsC) {
              const pIdx = py * width + px;
              if (!roadMask[pIdx] && !wouldMake2x2(roadMask, width, height, px, py)) {
                roadMask[pIdx] = 1;
                cellFlags[pIdx] |= URBAN_CELL_BIT_ROAD;
              }
            }
          }
        }
      }
      // Proteger la mediana del acceso dividido
      for (let k = rbtRadius + 1; k <= rbtRadius + 5; k++) {
        for (let lat = -1; lat <= 1; lat++) {
          const mx = rbtCenterX + ax * k + lxv * lat;
          const my = rbtCenterY + ay * k + lyv * lat;
          if (mx >= 0 && mx < width && my >= 0 && my < height) {
            approachProtectedMask[my * width + mx] = 1;
          }
        }
      }
    }

    // Sub-rotonda(s) secundaria(s) obligatorias en metrópolis x3/x4/x5 (11 <= d <= 21)
    const targetSubRbts = spec.engineScale === 'x5' ? 2 : isHighScale ? 1 : 0;
    if (targetSubRbts > 0) {
      const erodedDeep = erode8(erode8(erode8(inlandMask, width, height), width, height), width, height);
      for (let subIdx = 0; subIdx < targetSubRbts; subIdx++) {
        let bestScore = -Infinity;
        let bestSub: [number, number] | null = null;
        for (let sy = 4; sy < height - 4; sy++) {
          for (let sx = 4; sx < width - 4; sx++) {
            if (!erodedDeep[sy * width + sx] || approachProtectedMask[sy * width + sx]) continue;
            const dP = Math.hypot(sx - rbtCenterX, sy - rbtCenterY);
            if (dP < 11 || dP > 21) continue;
            let clearBox = true;
            for (let dy = -3; dy <= 3 && clearBox; dy++) {
              for (let dx = -3; dx <= 3; dx++) {
                const bIdx = (sy + dy) * width + (sx + dx);
                if (!inlandMask[bIdx] || beltwayMask[bIdx] || rbtProtectedMask[bIdx]) {
                  clearBox = false;
                  break;
                }
              }
            }
            if (!clearBox) continue;
            const kProj = (sx - rbtCenterX) * ax + (sy - rbtCenterY) * ay;
            const latProj = (sx - rbtCenterX) * lxv + (sy - rbtCenterY) * lyv;
            const signFlip = subIdx === 0 ? 1 : -1;
            const score = -kProj * 0.4 * signFlip + Math.abs(latProj) * 0.7 - Math.abs(dP - 14.0) * 0.5;
            if (score > bestScore) {
              bestScore = score;
              bestSub = [sx, sy];
            }
          }
        }
        if (bestSub) {
          stampChamferedRoundabout(
            roadMask,
            cellFlags,
            rbtProtectedMask,
            width,
            height,
            bestSub[0],
            bestSub[1],
            2
          );
          roundabouts.push({
            id: `rbt_${spec.cityId}_${subIdx + 1}`,
            centerX: bestSub[0],
            centerY: bestSub[1],
            radius: 2,
            role: 'secondary',
          });
          const link = trace4ConnNo2x2(
            roadMask,
            width,
            height,
            [bestSub[0], bestSub[1]],
            mainHubPt,
            inlandMask,
            approachProtectedMask
          );
          if (link) {
            for (const [px, py] of link) {
              const pIdx = py * width + px;
              if (!roadMask[pIdx] && !wouldMake2x2(roadMask, width, height, px, py)) {
                roadMask[pIdx] = 1;
                cellFlags[pIdx] |= URBAN_CELL_BIT_ROAD;
              }
            }
          }
        }
      }
    }
  }

  // 4. Espinas arteriales conectando el hub central hacia los puntos cardinales/angulares del beltway_real
  const spineAngles =
    dna.arterialSkeleton === 'y_trident_fork'
      ? [dna.angleRad, dna.angleRad + (2 * Math.PI) / 3, dna.angleRad + (4 * Math.PI) / 3]
      : dna.arterialSkeleton === 'radial_annular' || spec.engineScale === 'x3'
      ? [0, Math.PI * 0.4, Math.PI * 0.8, Math.PI * 1.2, Math.PI * 1.6]
      : [0, Math.PI * 0.5, Math.PI, Math.PI * 1.5];

  const paintTrace = (from: readonly [number, number], to: readonly [number, number], stopMask?: Uint8Array) => {
    const pts = trace4ConnNo2x2(roadMask, width, height, from, to, inlandMask, approachProtectedMask, stopMask);
    if (!pts) return;
    for (const [px, py] of pts) {
      const pIdx = py * width + px;
      if (!roadMask[pIdx] && !wouldMake2x2(roadMask, width, height, px, py)) {
        roadMask[pIdx] = 1;
        cellFlags[pIdx] |= URBAN_CELL_BIT_ROAD;
      }
    }
  };

  for (const ang of spineAngles) {
    if (beltwayPts.length === 0) break;
    let bestPt = beltwayPts[0];
    let bestProj = -Infinity;
    const ca = Math.cos(ang);
    const sa = Math.sin(ang);
    for (let i = 0; i < beltwayPts.length; i++) {
      const [bx, by] = beltwayPts[i];
      const proj = (bx - rbtCenterX) * ca + (by - rbtCenterY) * sa;
      if (proj > bestProj) {
        bestProj = proj;
        bestPt = [bx, by];
      }
    }
    paintTrace(mainHubPt, bestPt, beltwayMask);
  }

  // 5. Salidas multi-direccionales (U-turnout interchanges + portales en todas las direcciones secas)
  //    y empalme limpio con la Línea Amarilla Base (Priority-0)
  const perimeterPortalsGlobal: Array<[number, number]> = [];
  let pMerge: [number, number] = mainHubPt;
  let trunkInteractionMode: YellowTrunkCityInteractionMode = 'trunk_spur_precompiled';

  const targetExits =
    spec.targetExitsCount ??
    (spec.engineScale === 'x5'
      ? 7
      : spec.engineScale === 'x4'
      ? 6
      : spec.engineScale === 'x3'
      ? 5
      : spec.engineScale === 'x2'
      ? 4
      : 3);

  const localExits: Array<[number, number]> = [];
  if (beltwayPts.length > 0) {
    const exitDirs: ReadonlyArray<readonly [number, number]> = [
      [0, -1],  // N
      [1, 0],   // E
      [0, 1],   // S
      [-1, 0],  // W
      [1, -1],  // NE
      [1, 1],   // SE
      [-1, 1],  // SW
      [-1, -1], // NW
    ];
    for (const [edx, edy] of exitDirs) {
      if (localExits.length >= targetExits) break;
      const norm = Math.hypot(edx, edy);
      const ux = edx / norm;
      const uy = edy / norm;
      let bestPt: [number, number] | null = null;
      let bestProj = -Infinity;
      for (const pt of beltwayPts) {
        const [bx, by] = pt;
        // Verificar que afuera en esa dirección haya tierra seca (no mar abierto)
        const ox = bx + Math.sign(edx) * 3;
        const oy = by + Math.sign(edy) * 3;
        if (ox < 1 || ox >= width - 1 || oy < 1 || oy >= height - 1) continue;
        if (!masks.dryGlobalMask[oy * width + ox]) continue;
        const proj = (bx - rbtCenterX) * ux + (by - rbtCenterY) * uy;
        if (proj > bestProj) {
          bestProj = proj;
          bestPt = pt;
        }
      }
      if (
        bestPt &&
        localExits.every((e) => Math.abs(e[0] - bestPt![0]) + Math.abs(e[1] - bestPt![1]) >= 8)
      ) {
        localExits.push(bestPt);
        perimeterPortalsGlobal.push([originGlobalX + bestPt[0], originGlobalY + bestPt[1]]);
        // Construir U-turnout cerrado (estilo Solstice West) si es dirección cardinal y hay espacio seco
        if ((edx === 0 || edy === 0) && bestPt[0] >= 4 && bestPt[0] < width - 4 && bestPt[1] >= 4 && bestPt[1] < height - 4) {
          const lx = -edy;
          const ly = edx;
          const depth = 2;
          const turnoutPts: Array<[number, number]> = [];
          let ok = true;
          for (const side of [-2, 2]) {
            for (let st = 1; st <= depth; st++) {
              const tx = bestPt[0] + lx * side + edx * st;
              const ty = bestPt[1] + ly * side + edy * st;
              if (tx < 2 || tx >= width - 2 || ty < 2 || ty >= height - 2 || !masks.dryGlobalMask[ty * width + tx] || inlandMask[ty * width + tx]) {
                ok = false;
                break;
              }
              turnoutPts.push([tx, ty]);
            }
          }
          for (let lat = -2; lat <= 2 && ok; lat++) {
            const tx = bestPt[0] + lx * lat + edx * depth;
            const ty = bestPt[1] + ly * lat + edy * depth;
            if (tx < 2 || tx >= width - 2 || ty < 2 || ty >= height - 2 || !masks.dryGlobalMask[ty * width + tx]) {
              ok = false;
              break;
            }
            turnoutPts.push([tx, ty]);
          }
          if (ok) {
            for (const [tx, ty] of turnoutPts) {
              const tIdx = ty * width + tx;
              if (!roadMask[tIdx] && !wouldMake2x2(roadMask, width, height, tx, ty)) {
                roadMask[tIdx] = 1;
                cellFlags[tIdx] |= URBAN_CELL_BIT_ROAD | URBAN_CELL_BIT_BELTWAY;
              }
            }
          }
        }
      }
    }
    if (localExits.length > 0) pMerge = localExits[0];
  }

  if (localTrunkCells.length > 0 && beltwayPts.length > 0) {
    let bestD = Infinity;
    let bestTrunk = localTrunkCells[0];
    let bestBw = beltwayPts[0];
    for (let i = 0; i < localTrunkCells.length; i += Math.max(1, Math.floor(localTrunkCells.length / 40))) {
      const [tx, ty] = localTrunkCells[i];
      for (let j = 0; j < beltwayPts.length; j += Math.max(1, Math.floor(beltwayPts.length / 60))) {
        const [bx, by] = beltwayPts[j];
        const d = Math.abs(tx - bx) + Math.abs(ty - by);
        if (d < bestD) {
          bestD = d;
          bestTrunk = [tx, ty];
          bestBw = [bx, by];
        }
      }
    }
    pMerge = bestBw;
    trunkInteractionMode = bestD <= 2 ? 'pass_through_absorb' : bestD <= 6 ? 'tangential_bypass' : 'trunk_spur_precompiled';
    if (bestD > 0) {
      const spurPts = trace4ConnNo2x2(
        roadMask,
        width,
        height,
        bestBw,
        bestTrunk,
        masks.dryGlobalMask
      );
      if (spurPts) {
        for (const [px, py] of spurPts) {
          const pIdx = py * width + px;
          if (!roadMask[pIdx] && !wouldMake2x2(roadMask, width, height, px, py)) {
            roadMask[pIdx] = 1;
            cellFlags[pIdx] |= URBAN_CELL_BIT_ROAD;
          }
        }
      }
    }
    if (!perimeterPortalsGlobal.some(([gx, gy]) => gx === originGlobalX + bestBw[0] && gy === originGlobalY + bestBw[1])) {
      perimeterPortalsGlobal.push([originGlobalX + bestBw[0], originGlobalY + bestBw[1]]);
    }
  }

  // Asegurar que la componente de beltway y las rotondas estén conectadas
  const { labels } = connectedComponents4(roadMask, width, height);
  const hubCid = labels[mainHubPt[1] * width + mainHubPt[0]];
  if (hubCid > 0 && beltwayPts.length > 0) {
    const mainMask = new Uint8Array(width * height);
    for (let i = 0; i < mainMask.length; i++) if (labels[i] === hubCid) mainMask[i] = 1;
    for (let i = 0; i < beltwayPts.length; i += Math.max(1, Math.floor(beltwayPts.length / 12))) {
      const [bx, by] = beltwayPts[i];
      if (labels[by * width + bx] !== hubCid) {
        paintTrace([bx, by], mainHubPt, mainMask);
      }
    }
  }

  // Limpiar cualquier blob 2x2 residual protegiendo línea amarilla y puentes
  const protYellow = new Uint8Array(width * height);
  for (let i = 0; i < protYellow.length; i++) {
    if ((cellFlags[i] & (URBAN_CELL_BIT_YELLOW_TRUNK | URBAN_CELL_BIT_BRIDGE)) !== 0) {
      protYellow[i] = 1;
    }
  }
  const cleanRoad = peel2x2(roadMask, width, height, protYellow);
  for (let i = 0; i < cleanRoad.length; i++) {
    if (roadMask[i] && !cleanRoad[i]) {
      roadMask[i] = 0;
      cellFlags[i] &= ~URBAN_CELL_BIT_ROAD;
      cellFlags[i] &= ~URBAN_CELL_BIT_BELTWAY;
    }
  }

  return {
    trunkInteractionMode,
    perimeterPortalsGlobal,
    beltwayMask,
    roadMask,
    rbtProtectedMask,
    approachProtectedMask,
    mainHubPt,
    pMerge,
    roundabouts,
  };
}
