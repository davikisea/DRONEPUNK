/**
 * ==============================================================================
 * MOTOR DE VARIABILIDAD, ANTI-COLISIÓN (AC-01..AC-07), D4 IoU Y FIRMA 9D
 * ==============================================================================
 * Port 100 % fiel de 09_city_world_engine.py (v6.0.0-awbw, L1079-1256):
 * - applyAntiCollisionRepairs (AC-01..AC-07)
 * - normalizeCanonicalMask & maxD4IoU (8 transformaciones diédricas D4)
 * - computeTopoSignature9D & topoDistances (Gate 24)
 * ==============================================================================
 */

import type {
  CityDnaProfile,
  CityScaleSpec,
  DistrictOrientationId,
  MicroGrainGrammarId,
  PartitionGeometryMethodId,
  WaterfrontDirection,
} from '../types/urbanMorphologyTypes';
import { detHash32, orthoDegree } from './urbanMorphologyPrimitives';

export const ALL_MICRO_GRAINS: readonly MicroGrainGrammarId[] = [
  'curved_arc',
  'diagonal_terrace',
  'ns_bars',
  'ew_bars',
  'superblock_central_park',
  'courtyard_cloisters',
  'comb_piers',
  'organic_loops',
  'divided_borough',
];

export interface AntiCollisionContext {
  readonly waterfrontDir: WaterfrontDirection;
  readonly riverPresent: boolean;
  readonly scale: 'x5' | 'x4' | 'x3' | 'x2' | 'x1' | 'sat_hub' | 'sat_outpost';
}

/**
 * Construye un CityDnaProfile determinista desde CityScaleSpec y aplica AC-01..AC-07.
 */
export function resolveCityDnaProfile(
  spec: CityScaleSpec,
  angleOffsetRad: number = 0
): CityDnaProfile {
  const h = detHash32(`${spec.cityId}_dna_v6`);
  const baseAngle = (((h % 628) / 100.0) - Math.PI) * 0.35 + angleOffsetRad;

  const partitionMethods: readonly PartitionGeometryMethodId[] = [
    'voronoi_geodesic',
    'non_orthogonal_angular',
    'coast_parallel_bands',
    'elevation_terraces',
  ];

  let partitionMethod: PartitionGeometryMethodId;
  if (spec.waterfrontDir !== 'none' && spec.silhouetteFamily === 'coastal_arc_crescent') {
    partitionMethod = 'coast_parallel_bands';
  } else if (spec.silhouetteFamily === 'alpine_wedge_terrace') {
    partitionMethod = 'elevation_terraces';
  } else {
    partitionMethod = partitionMethods[(h >>> 4) % partitionMethods.length];
  }

  const sectorCount =
    spec.engineScale === 'x5'
      ? 6
      : spec.engineScale === 'x4' || spec.engineScale === 'x3'
      ? 5
      : spec.engineScale === 'x2'
      ? 4
      : 3;

  const defaultOri: DistrictOrientationId =
    spec.waterfrontDir !== 'none'
      ? 'COASTAL_ARC'
      : (['EW', 'NS', 'L_SHAPED'] as const)[(h >>> 8) % 3];

  const scaleFactor =
    spec.engineScale === 'x5'
      ? 1.55
      : spec.engineScale === 'x4'
      ? 1.32
      : spec.engineScale === 'x3'
      ? 1.12
      : spec.engineScale === 'x2'
      ? 0.92
      : 0.74;

  const raw: CityDnaProfile = {
    silhouetteFamily: spec.silhouetteFamily,
    scaleFactor,
    angleRad: baseAngle,
    harmonics: [
      0.14 + (((h >>> 2) % 9) * 0.01),
      -(0.08 + (((h >>> 6) % 7) * 0.01)),
      0.05 + (((h >>> 10) % 5) * 0.01),
    ],
    lobeCount: 2 + ((h >>> 12) % 3),
    concavity: 0.22 + (((h >>> 14) % 10) * 0.01),
    arterialSkeleton: spec.arterialSkeleton,
    regionalAccessPattern: spec.regionalAccessPattern,
    partitionMethod,
    sectorCount,
    angularJitterRad: 0.16 + (((h >>> 16) % 20) * 0.01),
    defaultOrientation: defaultOri,
    perDistrictOrientation: {
      civic_core: defaultOri,
      air_hub: ((h >>> 18) & 1) === 0 ? 'EW' : 'NS',
      industrial_logistics_park: ((h >>> 19) & 1) === 0 ? 'EW' : 'NS',
      science_campus: 'BLOCK_INTEGRATED',
      waterfront_port: spec.waterfrontDir !== 'none' ? 'COASTAL_ARC' : 'EW',
    },
    microGrains: [...spec.microGrains],
  };

  return applyAntiCollisionRepairs(raw, {
    waterfrontDir: spec.waterfrontDir,
    riverPresent: spec.riverPresent,
    scale: spec.engineScale,
  });
}

/**
 * Aplica las 7 reglas deterministas AC-01..AC-07 de 09_city_world_engine.py (L1151-1256).
 */
export function applyAntiCollisionRepairs(
  dna: CityDnaProfile,
  ctx: AntiCollisionContext
): CityDnaProfile {
  const out: CityDnaProfile = {
    ...dna,
    harmonics: [...dna.harmonics],
    perDistrictOrientation: { ...dna.perDistrictOrientation },
    microGrains: [...dna.microGrains],
  };

  // AC-01: waterfront_dir == 'none' prohíbe morfologías costeras
  if (ctx.waterfrontDir === 'none') {
    if (out.silhouetteFamily === 'coastal_arc_crescent') {
      out.silhouetteFamily = 'harmonic_fourier_polygon';
    }
    if (out.arterialSkeleton === 'coastal_promenade') {
      out.arterialSkeleton = 'tangential_beltway';
    }
    if (out.partitionMethod === 'coast_parallel_bands') {
      out.partitionMethod = 'elevation_terraces';
    }
    if (out.defaultOrientation === 'COASTAL_ARC') {
      out.defaultOrientation = 'L_SHAPED';
    }
    for (const k of Object.keys(out.perDistrictOrientation) as Array<keyof typeof out.perDistrictOrientation>) {
      if (out.perDistrictOrientation[k] === 'COASTAL_ARC') {
        out.perDistrictOrientation[k] = 'L_SHAPED';
      }
    }
  }

  // AC-02: riverPresent == false prohíbe morfologías fluviales
  if (!ctx.riverPresent) {
    if (out.silhouetteFamily === 'river_corridor_split') {
      out.silhouetteFamily = 'multi_ellipse_metaball';
    }
    if (out.arterialSkeleton === 'bi_bank_bridges') {
      out.arterialSkeleton = 'twin_plaza_dumbbell';
    }
  }

  // AC-03: monumental_bridge requiere costa o río
  if (
    out.regionalAccessPattern === 'monumental_bridge' &&
    ctx.waterfrontDir === 'none' &&
    !ctx.riverPresent
  ) {
    out.regionalAccessPattern = 'divided_stem';
  }

  // AC-04: x1 limita sectorCount <= 4 (objetivo 3) y evita twin_plaza_dumbbell / radial_annular
  if (ctx.scale === 'x1') {
    if (
      out.arterialSkeleton === 'twin_plaza_dumbbell' ||
      out.arterialSkeleton === 'radial_annular'
    ) {
      out.arterialSkeleton = 'eccentric_roundabout';
    }
    if (out.sectorCount > 4) {
      out.sectorCount = 3;
    }
  }

  // AC-05: tangential_beltway / s_spine_collector + divided_stem -> t_plaza
  if (
    (out.arterialSkeleton === 'tangential_beltway' ||
      out.arterialSkeleton === 's_spine_collector') &&
    out.regionalAccessPattern === 'divided_stem'
  ) {
    out.terminalMode = 't_plaza';
  }

  // AC-06: air_hub jamás puede ser BLOCK_INTEGRATED
  if (out.perDistrictOrientation.air_hub === 'BLOCK_INTEGRATED') {
    out.perDistrictOrientation.air_hub = 'EW';
  }

  // AC-07: >= min(K, 3) micro_grains distintos y exactamente sectorCount elementos
  const kSec = Math.max(2, out.sectorCount);
  const distinct = new Set<MicroGrainGrammarId>(out.microGrains);
  for (const candidate of ALL_MICRO_GRAINS) {
    if (out.microGrains.length >= kSec && distinct.size >= Math.min(kSec, 3)) break;
    if (!distinct.has(candidate)) {
      distinct.add(candidate);
      out.microGrains.push(candidate);
    }
  }
  while (out.microGrains.length < kSec) {
    out.microGrains.push(ALL_MICRO_GRAINS[out.microGrains.length % ALL_MICRO_GRAINS.length]);
  }
  out.microGrains = out.microGrains.slice(0, kSec);

  return out;
}

/**
 * Recorta el bbox ajustado y remuestrea a (size x size) por vecino más cercano (L1079-1087).
 */
export function normalizeCanonicalMask(
  mask: Uint8Array,
  w: number,
  h: number,
  size: number = 32
): Uint8Array {
  let minX = w;
  let maxX = -1;
  let minY = h;
  let maxY = -1;
  for (let y = 0; y < h; y++) {
    const r = y * w;
    for (let x = 0; x < w; x++) {
      if (mask[r + x]) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  const out = new Uint8Array(size * size);
  if (maxX < minX || maxY < minY) return out;

  const cw = maxX - minX + 1;
  const ch = maxY - minY + 1;
  for (let sy = 0; sy < size; sy++) {
    const srcY = minY + Math.round((sy / Math.max(1, size - 1)) * (ch - 1));
    for (let sx = 0; sx < size; sx++) {
      const srcX = minX + Math.round((sx / Math.max(1, size - 1)) * (cw - 1));
      out[sy * size + sx] = mask[srcY * w + srcX] ? 1 : 0;
    }
  }
  return out;
}

/**
 * Máxima IoU entre maskA y las 8 transformaciones diédricas D4 de maskB (L1090-1102).
 */
export function maxD4IoU(
  maskA: Uint8Array,
  wA: number,
  hA: number,
  maskB: Uint8Array,
  wB: number,
  hB: number,
  size: number = 32
): number {
  const ca = normalizeCanonicalMask(maskA, wA, hA, size);
  const cb = normalizeCanonicalMask(maskB, wB, hB, size);
  let best = 0;

  for (let rot = 0; rot < 4; rot++) {
    for (let flip = 0; flip < 2; flip++) {
      let inter = 0;
      let union = 0;
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          let tx = x;
          let ty = y;
          if (flip === 1) tx = size - 1 - tx;
          let bx = tx;
          let by = ty;
          if (rot === 1) {
            bx = size - 1 - ty;
            by = tx;
          } else if (rot === 2) {
            bx = size - 1 - tx;
            by = size - 1 - ty;
          } else if (rot === 3) {
            bx = ty;
            by = size - 1 - tx;
          }
          const a = ca[y * size + x] !== 0;
          const b = cb[by * size + bx] !== 0;
          if (a && b) inter++;
          if (a || b) union++;
        }
      }
      if (union > 0) {
        const iou = inter / union;
        if (iou > best) best = iou;
      }
    }
  }
  return best;
}

/**
 * Firma topológica 9D invariante a escala y orientación (Gate 24, L1105-1138).
 */
export function computeTopoSignature9D(
  cityMask: Uint8Array,
  roadMask: Uint8Array,
  bldgMask: Uint8Array,
  rbtCount: number,
  w: number,
  h: number
): number[] {
  let dryArea = 0;
  let minX = w;
  let maxX = -1;
  let minY = h;
  let maxY = -1;
  let vCnt = 0;
  let d2 = 0;
  let d3 = 0;
  let d4p = 0;
  let sumDeg = 0;
  let hEdges = 0;
  let vEdges = 0;
  let deg2L = 0;
  let bldgCnt = 0;

  const g = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const r = y * w;
    for (let x = 0; x < w; x++) {
      const idx = r + x;
      if (cityMask[idx]) {
        dryArea++;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        if (bldgMask[idx]) bldgCnt++;
        if (roadMask[idx]) {
          g[idx] = 1;
          vCnt++;
        }
      }
    }
  }

  const safeDry = Math.max(1, dryArea);
  const safeV = Math.max(1, vCnt);
  const bw = maxX >= minX ? maxX - minX + 1 : 1;
  const bh = maxY >= minY ? maxY - minY + 1 : 1;

  for (let y = 0; y < h; y++) {
    const r = y * w;
    for (let x = 0; x < w; x++) {
      const idx = r + x;
      if (!g[idx]) continue;
      const deg = orthoDegree(g, w, h, x, y);
      sumDeg += deg;
      if (deg === 2) {
        d2++;
        const hasH = (x > 0 && g[idx - 1]) || (x < w - 1 && g[idx + 1]);
        const hasV = (y > 0 && g[idx - w]) || (y < h - 1 && g[idx + w]);
        if (hasH && hasV) deg2L++;
      } else if (deg === 3) {
        d3++;
      } else if (deg >= 4) {
        d4p++;
      }
      if (x < w - 1 && g[idx + 1]) hEdges++;
      if (y < h - 1 && g[idx + w]) vEdges++;
    }
  }

  const eCnt = 0.5 * sumDeg;
  const cyclo = Math.min(1, Math.max(0, (eCnt - safeV + 1) / safeV));
  const rbtDens = Math.min(1, rbtCount / Math.max(1, safeDry / 250));
  const orientAniso = Math.abs(hEdges - vEdges) / Math.max(1, hEdges + vEdges);
  const diagRatio = deg2L / Math.max(1, d2);
  const bboxElong = 1 - Math.min(bw, bh) / Math.max(1, Math.max(bw, bh));
  const fillDens = Math.min(1, bldgCnt / safeDry);

  return [
    d2 / safeV,
    d3 / safeV,
    d4p / safeV,
    cyclo,
    rbtDens,
    orientAniso,
    diagRatio,
    bboxElong,
    fillDens,
  ];
}

export function topoDistances(va: readonly number[], vb: readonly number[]): { l1: number; cosDist: number } {
  const n = Math.min(va.length, vb.length);
  if (n === 0) return { l1: 0, cosDist: 0 };
  let sumAbs = 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i++) {
    sumAbs += Math.abs(va[i] - vb[i]);
    dot += va[i] * vb[i];
    na += va[i] * va[i];
    nb += vb[i] * vb[i];
  }
  const l1 = sumAbs / n;
  const denom = Math.sqrt(na) * Math.sqrt(nb) + 1e-9;
  const cosDist = Math.max(0, 1 - dot / denom);
  return { l1, cosDist };
}

/**
 * Calcula circle_iou (similitud de la silueta contra su disco equivalente de igual área).
 */
export function computeCircleIoU(mask: Uint8Array, w: number, h: number): number {
  let area = 0;
  let sumX = 0;
  let sumY = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (mask[y * w + x]) {
        area++;
        sumX += x;
        sumY += y;
      }
    }
  }
  if (area === 0) return 0;
  const cx = sumX / area;
  const cy = sumY / area;
  const r = Math.sqrt(area / Math.PI);
  let inter = 0;
  let union = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const a = mask[y * w + x] !== 0;
      const b = Math.hypot(x - cx, y - cy) <= r;
      if (a && b) inter++;
      if (a || b) union++;
    }
  }
  return union > 0 ? Number((inter / union).toFixed(3)) : 0;
}

/**
 * Calcula internal_mirror_iou (máxima simetría espejo H/V de la silueta).
 */
export function computeInternalMirrorIoU(mask: Uint8Array, w: number, h: number): number {
  const c = normalizeCanonicalMask(mask, w, h, 32);
  let interH = 0;
  let unionH = 0;
  let interV = 0;
  let unionV = 0;
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 32; x++) {
      const a = c[y * 32 + x] !== 0;
      const bh = c[y * 32 + (31 - x)] !== 0;
      const bv = c[(31 - y) * 32 + x] !== 0;
      if (a && bh) interH++;
      if (a || bh) unionH++;
      if (a && bv) interV++;
      if (a || bv) unionV++;
    }
  }
  const iouH = unionH > 0 ? interH / unionH : 0;
  const iouV = unionV > 0 ? interV / unionV : 0;
  return Number(Math.max(iouH, iouV).toFixed(3));
}
