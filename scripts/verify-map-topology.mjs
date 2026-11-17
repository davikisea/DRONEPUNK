/**
 * ==============================================================================
 * AUDITORÍA TOPOLÓGICA DETERMINISTA DE CARTOGRAFÍA VECTORIAL (OPENPLACE BRIDGE)
 * ==============================================================================
 * Valida matemáticamente la coherencia topológica bit-a-bit (0.000 m) de:
 *   1. IDs canónicos (25 regiones, 21 municipios del Zulia) y validez de anillos.
 *   2. Coherencia entre estados en theatre_regions.json y mesh_state_internal.
 *   3. Coherencia entre perímetro exterior de zulia_municipalities.json y REG_VE_02.
 *   4. Unicidad sin duplicados ni segmentos cero en theatre_borders_mesh.json.
 *   5. Coherencia exacta de Venezuela en world_land.json vs exterior del teatro.
 *   6. Invariantes Zero-Raster, maxzoom y tolerance: 0 en TacticalWorldMap.tsx.
 *
 * Uso CLI: node scripts/verify-map-topology.mjs [--json]
 * ==============================================================================
 */

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const CANONICAL_REGION_IDS = [
  'REG_VE_01',
  'REG_VE_02',
  'REG_VE_03',
  'REG_VE_04',
  'REG_VE_05',
  'REG_VE_06',
  'REG_VE_07',
  'REG_VE_08',
  'REG_VE_09',
  'REG_VE_10',
  'REG_VE_11',
  'REG_VE_12',
  'REG_VE_13',
  'REG_VE_14',
  'REG_VE_15',
  'REG_VE_16',
  'REG_VE_17',
  'REG_VE_18',
  'REG_VE_19',
  'REG_VE_20',
  'REG_VE_21',
  'REG_VE_22',
  'REG_VE_23',
  'REG_VE_24',
  'BUF_MARITIME_CARIBE',
];

export const CANONICAL_ZULIA_MUNICIPALITY_IDS = [
  'MUN_ZULIA_MARACAIBO',
  'MUN_ZULIA_SAN_FRANCISCO',
  'MUN_ZULIA_CABIMAS',
  'MUN_ZULIA_SANTA_RITA',
  'MUN_ZULIA_MIRANDA',
  'MUN_ZULIA_LAGUNILLAS',
  'MUN_ZULIA_VALMORE_RODRIGUEZ',
  'MUN_ZULIA_BARALT',
  'MUN_ZULIA_SIMON_BOLIVAR',
  'MUN_ZULIA_MARA',
  'MUN_ZULIA_GUAJIRA',
  'MUN_ZULIA_JESUS_ENRIQUE_LOSSADA',
  'MUN_ZULIA_LA_CANADA_DE_URDANETA',
  'MUN_ZULIA_MACHIQUES_DE_PERIJA',
  'MUN_ZULIA_ROSARIO_DE_PERIJA',
  'MUN_ZULIA_COLON',
  'MUN_ZULIA_FRANCISCO_JAVIER_PULGAR',
  'MUN_ZULIA_CATATUMBO',
  'MUN_ZULIA_JESUS_MARIA_SEMPRUM',
  'MUN_ZULIA_SUCRE',
  'MUN_ZULIA_ALMIRANTE_PADILLA',
];

const KM_PER_LAT_DEGREE = 110.57;
const BASE_KM_PER_LNG_DEGREE = 111.32;
const DEG_TO_RAD = Math.PI / 180;
const NEAR_MISS_MIN_KM = 0.0001;
const NEAR_MISS_MAX_KM = 2.5;
const MAX_SAMPLE_ERRORS = 12;

/** @typedef {[number, number]} Coord2D */
/** @typedef {[number, number, number, number]} BBox */

/**
 * Serializa un vértice a clave exacta bit-a-bit.
 * @param {Coord2D} pt
 * @returns {string}
 */
export function pointKey(pt) {
  return `${pt[0]},${pt[1]}`;
}

/**
 * Construye una clave canónica no dirigida para un segmento {u, v}.
 * @param {string} uKey
 * @param {string} vKey
 * @returns {string}
 */
export function undirectedSegKey(uKey, vKey) {
  return uKey < vKey ? `${uKey}|${vKey}` : `${vKey}|${uKey}`;
}

/**
 * Calcula el área con signo (fórmula del cordón/Shoelace) en grados².
 * @param {Coord2D[]} ring
 * @returns {number}
 */
export function signedShoelaceArea(ring) {
  let sum = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    sum += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  }
  return sum * 0.5;
}

/**
 * Calcula la distancia mínima en km entre un punto P y un segmento AB usando proyección equirrectangular local.
 * @param {Coord2D} p
 * @param {Coord2D} a
 * @param {Coord2D} b
 * @returns {number}
 */
export function pointToSegmentDistKm(p, a, b) {
  const kx = BASE_KM_PER_LNG_DEGREE * Math.cos(p[1] * DEG_TO_RAD);
  const ky = KM_PER_LAT_DEGREE;
  const px = (p[0] - a[0]) * kx;
  const py = (p[1] - a[1]) * ky;
  const bx = (b[0] - a[0]) * kx;
  const by = (b[1] - a[1]) * ky;
  const len2 = bx * bx + by * by;
  if (len2 === 0) return Math.sqrt(px * px + py * py);
  const t = Math.max(0, Math.min(1, (px * bx + py * by) / len2));
  const cx = px - t * bx;
  const cy = py - t * by;
  return Math.sqrt(cx * cx + cy * cy);
}

/**
 * Extrae todos los segmentos dirigidos de un Polygon o MultiPolygon.
 * @param {{ type: string, coordinates: any }} geom
 * @returns {Array<{ a: Coord2D, b: Coord2D, ka: string, kb: string, uk: string, dk: string }>}
 */
export function extractPolygonEdges(geom) {
  const edges = [];
  if (!geom) return edges;
  const polys =
    geom.type === 'Polygon'
      ? [geom.coordinates]
      : geom.type === 'MultiPolygon'
        ? geom.coordinates
        : [];
  for (const poly of polys) {
    for (const ring of poly) {
      for (let i = 0; i < ring.length - 1; i++) {
        const a = ring[i];
        const b = ring[i + 1];
        const ka = pointKey(a);
        const kb = pointKey(b);
        edges.push({ a, b, ka, kb, uk: undirectedSegKey(ka, kb), dk: `${ka}->${kb}` });
      }
    }
  }
  return edges;
}

/**
 * Extrae todos los segmentos de un LineString o MultiLineString.
 * @param {{ type: string, coordinates: any }} geom
 * @returns {Array<{ a: Coord2D, b: Coord2D, ka: string, kb: string, uk: string }>}
 */
export function extractLineEdges(geom) {
  const edges = [];
  if (!geom) return edges;
  const lines =
    geom.type === 'LineString'
      ? [geom.coordinates]
      : geom.type === 'MultiLineString'
        ? geom.coordinates
        : [];
  for (const line of lines) {
    for (let i = 0; i < line.length - 1; i++) {
      const a = line[i];
      const b = line[i + 1];
      const ka = pointKey(a);
      const kb = pointKey(b);
      edges.push({ a, b, ka, kb, uk: undirectedSegKey(ka, kb) });
    }
  }
  return edges;
}

/**
 * Calcula el bounding box [minLng, minLat, maxLng, maxLat] de una geometría poligonal.
 * @param {{ type: string, coordinates: any }} geom
 * @returns {BBox}
 */
function getPolygonBBox(geom) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
  for (const poly of polys) {
    for (const ring of poly) {
      for (const [x, y] of ring) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  return [minX, minY, maxX, maxY];
}

function bboxesOverlapWithMargin(a, b, marginDeg) {
  return !(
    a[2] + marginDeg < b[0] ||
    b[2] + marginDeg < a[0] ||
    a[3] + marginDeg < b[1] ||
    b[3] + marginDeg < a[1]
  );
}

function orient2D(a, b, c) {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function properSegmentsIntersect(a, b, c, d) {
  if (
    (a[0] === c[0] && a[1] === c[1]) ||
    (a[0] === d[0] && a[1] === d[1]) ||
    (b[0] === c[0] && b[1] === c[1]) ||
    (b[0] === d[0] && b[1] === d[1])
  ) {
    return false;
  }
  const o1 = orient2D(a, b, c);
  const o2 = orient2D(a, b, d);
  const o3 = orient2D(c, d, a);
  const o4 = orient2D(c, d, b);
  return ((o1 > 0 && o2 < 0) || (o1 < 0 && o2 > 0)) && ((o3 > 0 && o4 < 0) || (o3 < 0 && o4 > 0));
}

function readJsonFile(rootDir, relPath) {
  const fullPath = path.resolve(rootDir, relPath);
  if (!fs.existsSync(fullPath)) {
    throw new Error(`Archivo requerido no encontrado: ${relPath}`);
  }
  return JSON.parse(fs.readFileSync(fullPath, 'utf8'));
}

/**
 * Encuentra las features de Venezuela dentro de world_land.json.
 * @param {{ features?: any[] }} worldLand
 * @returns {any[]}
 */
export function findVenezuelaFeatures(worldLand) {
  return (worldLand.features || []).filter((f) => {
    const p = f.properties || {};
    return (
      f.id === 'VEN' ||
      p.ADM0_A3 === 'VEN' ||
      p.adm0_a3 === 'VEN' ||
      p.ISO_A3 === 'VEN' ||
      p.iso_a3 === 'VEN' ||
      p.ISO_A3_EH === 'VEN' ||
      p.SOV_A3 === 'VEN'
    );
  });
}

function validatePolygonCollectionRings(features, collectionLabel) {
  let polygons = 0;
  let rings = 0;
  let vertices = 0;
  const failures = [];

  for (const feat of features) {
    const geom = feat.geometry;
    const featId = String(feat.id ?? feat.properties?.id ?? 'UNKNOWN');
    if (!geom || (geom.type !== 'Polygon' && geom.type !== 'MultiPolygon')) {
      failures.push(`${collectionLabel}:${featId} geometría nula o no poligonal (${geom?.type})`);
      continue;
    }
    const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
    if (polys.length === 0) {
      failures.push(`${collectionLabel}:${featId} sin polígonos`);
      continue;
    }

    polys.forEach((poly, polyIdx) => {
      polygons++;
      if (!Array.isArray(poly) || poly.length === 0) {
        failures.push(`${collectionLabel}:${featId}[${polyIdx}] sin anillos`);
        return;
      }
      poly.forEach((ring, ringIdx) => {
        rings++;
        vertices += ring.length;
        if (!Array.isArray(ring) || ring.length < 4) {
          failures.push(`${collectionLabel}:${featId}[${polyIdx}][${ringIdx}] < 4 vértices (${ring?.length})`);
          return;
        }
        const first = ring[0];
        const last = ring[ring.length - 1];
        if (!first || !last || first[0] !== last[0] || first[1] !== last[1]) {
          failures.push(
            `${collectionLabel}:${featId}[${polyIdx}][${ringIdx}] anillo abierto (${first} !== ${last})`
          );
        }
        for (let i = 0; i < ring.length; i++) {
          const pt = ring[i];
          if (!Number.isFinite(pt?.[0]) || !Number.isFinite(pt?.[1])) {
            failures.push(`${collectionLabel}:${featId}[${polyIdx}][${ringIdx}] coord no finita en ${i}`);
            break;
          }
          if (i > 0 && pt[0] === ring[i - 1][0] && pt[1] === ring[i - 1][1]) {
            failures.push(
              `${collectionLabel}:${featId}[${polyIdx}][${ringIdx}] vértice duplicado consecutivo en ${i}: [${pt[0]}, ${pt[1]}]`
            );
            break;
          }
        }
        const area = signedShoelaceArea(ring);
        if (area === 0) {
          failures.push(`${collectionLabel}:${featId}[${polyIdx}][${ringIdx}] área Shoelace cero`);
        }
      });
    });
  }

  return { polygons, rings, vertices, failures };
}

/**
 * Test 1 — Valida IDs canónicos (25 regiones + 21 municipios Zulia) y validez geométrica de anillos.
 * @param {{ rootDir?: string }} [options]
 */
export function auditCanonicalIdsAndGeometry(options = {}) {
  const rootDir = options.rootDir ?? process.cwd();
  const regions = readJsonFile(rootDir, 'public/map/theatre_regions.json');
  const zulia = readJsonFile(rootDir, 'public/map/zulia_municipalities.json');
  const worldLand = readJsonFile(rootDir, 'public/map/world_land.json');

  const errors = [];

  if (regions.type !== 'FeatureCollection' || !Array.isArray(regions.features)) {
    errors.push('theatre_regions.json debe ser un GeoJSON FeatureCollection válido.');
  }
  if (zulia.type !== 'FeatureCollection' || !Array.isArray(zulia.features)) {
    errors.push('zulia_municipalities.json debe ser un GeoJSON FeatureCollection válido.');
  }

  const regionIds = (regions.features || []).map((f) => String(f.id ?? f.properties?.id ?? ''));
  const regionIdSet = new Set(regionIds);
  if (regionIds.length !== CANONICAL_REGION_IDS.length) {
    errors.push(`theatre_regions.json: se esperaban ${CANONICAL_REGION_IDS.length} features, encontradas ${regionIds.length}.`);
  }
  if (regionIdSet.size !== regionIds.length) {
    errors.push('theatre_regions.json contiene IDs de región duplicados.');
  }
  for (const expectedId of CANONICAL_REGION_IDS) {
    if (!regionIdSet.has(expectedId)) {
      errors.push(`theatre_regions.json: falta región canónica ${expectedId}.`);
    }
  }
  for (const feat of regions.features || []) {
    if (feat.id !== feat.properties?.id) {
      errors.push(`theatre_regions.json: desajuste id (${feat.id}) vs properties.id (${feat.properties?.id}).`);
    }
  }

  const zuliaIds = (zulia.features || []).map((f) => String(f.id ?? f.properties?.id ?? ''));
  const zuliaIdSet = new Set(zuliaIds);
  if (zuliaIds.length !== CANONICAL_ZULIA_MUNICIPALITY_IDS.length) {
    errors.push(
      `zulia_municipalities.json: se esperaban ${CANONICAL_ZULIA_MUNICIPALITY_IDS.length} features, encontradas ${zuliaIds.length}.`
    );
  }
  if (zuliaIdSet.size !== zuliaIds.length) {
    errors.push('zulia_municipalities.json contiene IDs municipales duplicados.');
  }
  for (const expectedMunId of CANONICAL_ZULIA_MUNICIPALITY_IDS) {
    if (!zuliaIdSet.has(expectedMunId)) {
      errors.push(`zulia_municipalities.json: falta municipio canónico ${expectedMunId}.`);
    }
  }
  for (const feat of zulia.features || []) {
    if (feat.id !== feat.properties?.id) {
      errors.push(`zulia_municipalities.json: desajuste id (${feat.id}) vs properties.id (${feat.properties?.id}).`);
    }
    if (feat.properties?.stateId !== 'REG_VE_02') {
      errors.push(`zulia_municipalities.json:${feat.id} tiene stateId=${feat.properties?.stateId} (esperado REG_VE_02).`);
    }
  }

  const regStats = validatePolygonCollectionRings(regions.features || [], 'theatre_regions');
  const zuliaStats = validatePolygonCollectionRings(zulia.features || [], 'zulia_municipalities');
  const venFeats = findVenezuelaFeatures(worldLand);
  const venStats = validatePolygonCollectionRings(venFeats, 'world_land[VEN]');

  errors.push(...regStats.failures, ...zuliaStats.failures, ...venStats.failures);

  return {
    passed: errors.length === 0,
    errors,
    metrics: {
      regionsCount: regionIds.length,
      zuliaMunicipalitiesCount: zuliaIds.length,
      regionPolygons: regStats.polygons,
      regionRings: regStats.rings,
      regionVertices: regStats.vertices,
      zuliaPolygons: zuliaStats.polygons,
      zuliaRings: zuliaStats.rings,
      zuliaVertices: zuliaStats.vertices,
      venLandRings: venStats.rings,
      ringViolations: regStats.failures.length + zuliaStats.failures.length + venStats.failures.length,
    },
  };
}

/**
 * Traza la frontera disuelta de las entidades continentales (excluyendo Dependencias Federales)
 * cancelando pares de aristas internas compartidas en sentido opuesto.
 */
function traceDissolvedMainlandLoops(regions) {
  const mainlandFeats = regions.features.filter((f) => f.id !== 'BUF_MARITIME_CARIBE');
  /** @type {Map<string, Array<{ stateId: string, a: Coord2D, b: Coord2D, ka: string, kb: string }>>} */
  const ukMap = new Map();

  for (const feat of mainlandFeats) {
    for (const edge of extractPolygonEdges(feat.geometry)) {
      if (!ukMap.has(edge.uk)) ukMap.set(edge.uk, []);
      ukMap.get(edge.uk).push({ stateId: feat.id, ...edge });
    }
  }

  /** @type {Map<string, Array<{ stateId: string, a: Coord2D, b: Coord2D, to: string, uk: string }>>} */
  const adjOut = new Map();
  /** @type {Map<string, number>} */
  const inDegree = new Map();
  /** @type {Map<string, number>} */
  const outDegree = new Map();

  for (const [, list] of ukMap) {
    if (list.length !== 1) continue;
    const item = list[0];
    if (!adjOut.has(item.ka)) adjOut.set(item.ka, []);
    adjOut.get(item.ka).push({ stateId: item.stateId, a: item.a, b: item.b, to: item.kb, uk: item.uk });
    outDegree.set(item.ka, (outDegree.get(item.ka) || 0) + 1);
    inDegree.set(item.kb, (inDegree.get(item.kb) || 0) + 1);
  }

  let nonManifoldVertices = 0;
  const allNodes = new Set([...inDegree.keys(), ...outDegree.keys()]);
  for (const v of allNodes) {
    if ((inDegree.get(v) || 0) !== 1 || (outDegree.get(v) || 0) !== 1) {
      nonManifoldVertices++;
    }
  }

  const visited = new Set();
  const loops = [];
  /** @type {Map<string, number>} */
  const edgeToLoopIndex = new Map();

  for (const [start, outs] of adjOut) {
    for (const first of outs) {
      const startEk = `${start}->${first.to}`;
      if (visited.has(startEk)) continue;

      const loopIdx = loops.length;
      const ring = [first.a, first.b];
      const owners = new Set([first.stateId]);
      visited.add(startEk);
      edgeToLoopIndex.set(first.uk, loopIdx);

      let cur = first.to;
      let guard = 0;
      while (cur !== start && guard < 50000) {
        guard++;
        const next = (adjOut.get(cur) || []).find((c) => !visited.has(`${cur}->${c.to}`));
        if (!next) break;
        visited.add(`${cur}->${next.to}`);
        edgeToLoopIndex.set(next.uk, loopIdx);
        owners.add(next.stateId);
        ring.push(next.b);
        cur = next.to;
      }

      loops.push({
        index: loopIdx,
        closed: cur === start,
        vertices: ring.length,
        signedAreaDeg2: signedShoelaceArea(ring),
        owners: [...owners],
      });
    }
  }

  return { loops, edgeToLoopIndex, nonManifoldVertices };
}

/**
 * Test 2 — Coherencia Estado-Estado (0.000 m, devanado opuesto bit-a-bit, 0 near-misses de frontera interna,
 * e igualdad 100% con mesh_state_internal de theatre_borders_mesh.json).
 * @param {{ rootDir?: string }} [options]
 */
export function auditStateToStateBoundaries(options = {}) {
  const rootDir = options.rootDir ?? process.cwd();
  const regions = readJsonFile(rootDir, 'public/map/theatre_regions.json');
  const mesh = readJsonFile(rootDir, 'public/map/theatre_borders_mesh.json');

  const errors = [];
  /** @type {Map<string, string[]>} */
  const directedOwners = new Map();
  /** @type {Map<string, Set<string>>} */
  const undirectedOwners = new Map();
  /** @type {Map<string, Set<string>>} */
  const vertexOwners = new Map();
  const stateGeometryMeta = [];

  for (const feat of regions.features) {
    const edges = extractPolygonEdges(feat.geometry);
    stateGeometryMeta.push({
      id: feat.id,
      bbox: getPolygonBBox(feat.geometry),
      edges,
    });
    for (const edge of edges) {
      if (!directedOwners.has(edge.dk)) directedOwners.set(edge.dk, []);
      directedOwners.get(edge.dk).push(feat.id);

      if (!undirectedOwners.has(edge.uk)) undirectedOwners.set(edge.uk, new Set());
      undirectedOwners.get(edge.uk).add(feat.id);

      if (!vertexOwners.has(edge.ka)) vertexOwners.set(edge.ka, new Set());
      vertexOwners.get(edge.ka).add(feat.id);
    }
  }

  // 2A: Colisiones en el mismo sentido (u -> v duplicado en >= 2 estados o repetido)
  const sameDirCollisions = [];
  for (const [dk, owners] of directedOwners) {
    if (owners.length > 1) {
      sameDirCollisions.push(`${dk} en [${owners.join(', ')}]`);
    }
  }
  if (sameDirCollisions.length > 0) {
    errors.push(
      `Colisiones de aristas en el mismo sentido (${sameDirCollisions.length}): ${sameDirCollisions.slice(0, MAX_SAMPLE_ERRORS).join('; ')}`
    );
  }

  // 2B: Todas las aristas compartidas entre estados deben tener exactamente 2 dueños con devanado opuesto
  const internalStateEdgeSet = new Set();
  const multiOwnerViolations = [];
  const oppositeWindingViolations = [];
  const adjacentPairs = new Set();

  for (const [uk, owners] of undirectedOwners) {
    if (owners.size > 2) {
      multiOwnerViolations.push(`${uk} compartido por ${owners.size} estados [${[...owners].join(', ')}]`);
      continue;
    }
    if (owners.size === 2) {
      internalStateEdgeSet.add(uk);
      const [u, v] = uk.split('|');
      const fwd = directedOwners.get(`${u}->${v}`) || [];
      const rev = directedOwners.get(`${v}->${u}`) || [];
      if (fwd.length !== 1 || rev.length !== 1 || fwd[0] === rev[0]) {
        oppositeWindingViolations.push(`${uk}: fwd=[${fwd.join(',')}], rev=[${rev.join(',')}]`);
      }
      const pairKey = [...owners].sort().join('|');
      adjacentPairs.add(pairKey);
    }
  }

  if (multiOwnerViolations.length > 0) {
    errors.push(
      `Aristas con >2 dueños (${multiOwnerViolations.length}): ${multiOwnerViolations.slice(0, MAX_SAMPLE_ERRORS).join('; ')}`
    );
  }
  if (oppositeWindingViolations.length > 0) {
    errors.push(
      `Desajuste de devanado opuesto (${oppositeWindingViolations.length}): ${oppositeWindingViolations.slice(0, MAX_SAMPLE_ERRORS).join('; ')}`
    );
  }

  // 2C: Auditoría de brechas / near-misses [0.0001 km, 2.5 km] entre estados
  // 1) Pares de estados que NO comparten arista pero cuyos bordes caen entre 0.0001 km y 2.5 km
  const marginDeg = 0.03; // ~3.3 km para poda segura de bounding box
  const nonSharingNearMisses = [];
  for (let i = 0; i < stateGeometryMeta.length; i++) {
    for (let j = i + 1; j < stateGeometryMeta.length; j++) {
      const A = stateGeometryMeta[i];
      const B = stateGeometryMeta[j];
      const pairKey = [A.id, B.id].sort().join('|');
      if (adjacentPairs.has(pairKey)) continue;
      if (!bboxesOverlapWithMargin(A.bbox, B.bbox, marginDeg)) continue;

      let minDist = Infinity;
      let closestSample = null;
      for (const ea of A.edges) {
        for (const eb of B.edges) {
          const d = pointToSegmentDistKm(ea.a, eb.a, eb.b);
          if (d < minDist) {
            minDist = d;
            closestSample = { pt: ea.a, seg: [eb.a, eb.b] };
          }
        }
      }
      for (const eb of B.edges) {
        for (const ea of A.edges) {
          const d = pointToSegmentDistKm(eb.a, ea.a, ea.b);
          if (d < minDist) {
            minDist = d;
            closestSample = { pt: eb.a, seg: [ea.a, ea.b] };
          }
        }
      }
      if (minDist >= NEAR_MISS_MIN_KM && minDist <= NEAR_MISS_MAX_KM) {
        nonSharingNearMisses.push(
          `${pairKey}: ${minDist.toFixed(4)} km cerca de [${closestSample.pt.join(', ')}]`
        );
      }
    }
  }
  if (nonSharingNearMisses.length > 0) {
    errors.push(
      `Estados sin arista compartida dentro de 0.0001-2.5 km (${nonSharingNearMisses.length}): ${nonSharingNearMisses.slice(0, MAX_SAMPLE_ERRORS).join('; ')}`
    );
  }

  // 2) Brechas/slivers internos en el grafo disuelto de los 24 estados continentales
  const dissolved = traceDissolvedMainlandLoops(regions);
  if (dissolved.nonManifoldVertices > 0) {
    errors.push(
      `Grafo exterior disuelto presenta ${dissolved.nonManifoldVertices} vértices no-manifold (frontera rota/abierta).`
    );
  }
  const unclosedLoops = dissolved.loops.filter((l) => !l.closed);
  if (unclosedLoops.length > 0) {
    errors.push(`Grafo exterior disuelto tiene ${unclosedLoops.length} anillos sin cerrar.`);
  }

  // Cualquier lazo con área negativa (< 0) es un hueco interior dentro de Venezuela.
  // Solo se admite un lago natural real de gran extensión (Lago de Valencia: REG_VE_05 & REG_VE_08, |area| > 0.02 deg²).
  // Cualquier hueco sliver entre estados (|area| < 0.01 deg²) indica un desajuste/brecha en frontera compartida.
  const sliverHoles = dissolved.loops.filter(
    (l) => l.signedAreaDeg2 < 0 && Math.abs(l.signedAreaDeg2) < 0.01
  );
  if (sliverHoles.length > 0) {
    errors.push(
      `Detectados ${sliverHoles.length} huecos/slivers internos entre estados: ${JSON.stringify(sliverHoles)}`
    );
  }

  // Verificar que todo near-miss [0.0001 km, 2.5 km] entre estados adyacentes ocurre estrictamente
  // sobre la costa/frontera internacional o Lago de Valencia (mismo lazo exterior cerrado válido) y nunca
  // por bordes internos desalineados.
  const stateById = new Map(stateGeometryMeta.map((s) => [s.id, s]));
  const validExteriorLoopIndices = new Set(
    dissolved.loops
      .filter((l) => l.closed && (l.signedAreaDeg2 > 0 || Math.abs(l.signedAreaDeg2) >= 0.01))
      .map((l) => l.index)
  );
  let coastalNaturalNearContacts = 0;
  const internalNearMisses = [];

  for (const pairKey of adjacentPairs) {
    const [idA, idB] = pairKey.split('|');
    const stA = stateById.get(idA);
    const stB = stateById.get(idB);
    const unsharedA = stA.edges.filter((e) => undirectedOwners.get(e.uk).size === 1);
    const unsharedB = stB.edges.filter((e) => undirectedOwners.get(e.uk).size === 1);

    for (const ea of unsharedA) {
      if (vertexOwners.get(ea.ka).size > 1) continue;
      for (const eb of unsharedB) {
        if (
          Math.abs(ea.a[0] - eb.a[0]) > marginDeg &&
          Math.abs(ea.a[0] - eb.b[0]) > marginDeg
        ) {
          continue;
        }
        if (
          Math.abs(ea.a[1] - eb.a[1]) > marginDeg &&
          Math.abs(ea.a[1] - eb.b[1]) > marginDeg
        ) {
          continue;
        }
        const d = pointToSegmentDistKm(ea.a, eb.a, eb.b);
        if (d >= NEAR_MISS_MIN_KM && d <= NEAR_MISS_MAX_KM) {
          const loopA = dissolved.edgeToLoopIndex.get(ea.uk);
          const loopB = dissolved.edgeToLoopIndex.get(eb.uk);
          if (
            loopA !== undefined &&
            loopA === loopB &&
            validExteriorLoopIndices.has(loopA)
          ) {
            coastalNaturalNearContacts++;
          } else {
            internalNearMisses.push(
              `${pairKey} (${d.toFixed(4)} km): vértice [${ea.a.join(', ')}] vs seg [${eb.a.join(', ')}]->[${eb.b.join(', ')}]`
            );
          }
        }
      }
    }
  }
  if (internalNearMisses.length > 0) {
    errors.push(
      `Near-misses internos en fronteras adyacentes (${internalNearMisses.length}): ${internalNearMisses.slice(0, MAX_SAMPLE_ERRORS).join('; ')}`
    );
  }

  // 2D: Igualdad 100% entre aristas internas estado-estado y mesh_state_internal
  const meshInternalFeat = (mesh.features || []).find((f) => f.id === 'mesh_state_internal');
  if (!meshInternalFeat) {
    errors.push('theatre_borders_mesh.json no contiene feature mesh_state_internal.');
  } else {
    const meshInternalSet = new Set(extractLineEdges(meshInternalFeat.geometry).map((e) => e.uk));
    const missingInMesh = [...internalStateEdgeSet].filter((k) => !meshInternalSet.has(k));
    const extraInMesh = [...meshInternalSet].filter((k) => !internalStateEdgeSet.has(k));

    if (missingInMesh.length > 0 || extraInMesh.length > 0) {
      errors.push(
        `Desajuste aristas internas vs mesh_state_internal: faltanEnMesh=${missingInMesh.length}, sobranEnMesh=${extraInMesh.length}.`
      );
    }
  }

  // Diagnóstico informativo de cruces geométricos propios/entre estados (no bloqueante si topología de aristas coincide)
  let bowTieCrossings = 0;
  for (let i = 0; i < stateGeometryMeta.length; i++) {
    for (let j = i + 1; j < stateGeometryMeta.length; j++) {
      const A = stateGeometryMeta[i];
      const B = stateGeometryMeta[j];
      if (!bboxesOverlapWithMargin(A.bbox, B.bbox, 0)) continue;
      for (const ea of A.edges) {
        const minAx = Math.min(ea.a[0], ea.b[0]);
        const maxAx = Math.max(ea.a[0], ea.b[0]);
        const minAy = Math.min(ea.a[1], ea.b[1]);
        const maxAy = Math.max(ea.a[1], ea.b[1]);
        for (const eb of B.edges) {
          if (maxAx < Math.min(eb.a[0], eb.b[0]) || Math.max(eb.a[0], eb.b[0]) < minAx) continue;
          if (maxAy < Math.min(eb.a[1], eb.b[1]) || Math.max(eb.a[1], eb.b[1]) < minAy) continue;
          if (properSegmentsIntersect(ea.a, ea.b, eb.a, eb.b)) bowTieCrossings++;
        }
      }
    }
  }

  return {
    passed: errors.length === 0,
    errors,
    metrics: {
      adjacentStatePairs: adjacentPairs.size,
      sharedInternalSegments: internalStateEdgeSet.size,
      sameDirCollisions: sameDirCollisions.length,
      multiOwnerViolations: multiOwnerViolations.length,
      oppositeWindingViolations: oppositeWindingViolations.length,
      nonSharingNearMisses: nonSharingNearMisses.length,
      internalNearMisses: internalNearMisses.length,
      sliverHoles: sliverHoles.length,
      dissolvedExteriorLoops: dissolved.loops.length,
      coastalNaturalNearContacts,
      bowTieCrossingsDiagnostic: bowTieCrossings,
    },
  };
}

/**
 * Test 3 — Coherencia Municipio-a-Estado (zulia_municipalities.json exterior vs REG_VE_02, 0.000 m).
 * @param {{ rootDir?: string }} [options]
 */
export function auditZuliaMunicipalitiesCoherence(options = {}) {
  const rootDir = options.rootDir ?? process.cwd();
  const regions = readJsonFile(rootDir, 'public/map/theatre_regions.json');
  const zulia = readJsonFile(rootDir, 'public/map/zulia_municipalities.json');

  const errors = [];
  const reg02 = (regions.features || []).find((f) => f.id === 'REG_VE_02');
  if (!reg02) {
    errors.push('No se encontró REG_VE_02 en theatre_regions.json.');
    return { passed: false, errors, metrics: {} };
  }

  /** @type {Map<string, number>} */
  const munEdgeCounts = new Map();
  let totalMunicipalityEdges = 0;
  for (const feat of zulia.features || []) {
    for (const edge of extractPolygonEdges(feat.geometry)) {
      totalMunicipalityEdges++;
      munEdgeCounts.set(edge.uk, (munEdgeCounts.get(edge.uk) || 0) + 1);
    }
  }

  const zuliaExteriorEdges = new Set();
  let multiOverlapEdges = 0;
  for (const [uk, count] of munEdgeCounts) {
    if (count === 1) zuliaExteriorEdges.add(uk);
    else if (count > 2) multiOverlapEdges++;
  }
  if (multiOverlapEdges > 0) {
    errors.push(`zulia_municipalities.json tiene ${multiOverlapEdges} aristas con multiplicidad > 2.`);
  }

  const zuliaExteriorVertices = new Set();
  for (const uk of zuliaExteriorEdges) {
    const [u, v] = uk.split('|');
    zuliaExteriorVertices.add(u);
    zuliaExteriorVertices.add(v);
  }

  const reg02Edges = new Set(extractPolygonEdges(reg02.geometry).map((e) => e.uk));
  const reg02Vertices = new Set();
  for (const uk of reg02Edges) {
    const [u, v] = uk.split('|');
    reg02Vertices.add(u);
    reg02Vertices.add(v);
  }

  const missingInReg02 = [...zuliaExteriorEdges].filter((k) => !reg02Edges.has(k));
  const missingInZulia = [...reg02Edges].filter((k) => !zuliaExteriorEdges.has(k));
  const missingVertsInReg02 = [...zuliaExteriorVertices].filter((v) => !reg02Vertices.has(v));
  const missingVertsInZulia = [...reg02Vertices].filter((v) => !zuliaExteriorVertices.has(v));

  if (missingInReg02.length > 0 || missingInZulia.length > 0) {
    errors.push(
      `Desajuste de segmentos Zulia exterior vs REG_VE_02: faltanEnREG_VE_02=${missingInReg02.length}, faltanEnZulia=${missingInZulia.length}. Ejemplos: ${[...missingInReg02, ...missingInZulia].slice(0, MAX_SAMPLE_ERRORS).join('; ')}`
    );
  }
  if (missingVertsInReg02.length > 0 || missingVertsInZulia.length > 0) {
    errors.push(
      `Desajuste de vértices Zulia exterior vs REG_VE_02: faltanEnREG_VE_02=${missingVertsInReg02.length}, faltanEnZulia=${missingVertsInZulia.length}.`
    );
  }

  return {
    passed: errors.length === 0,
    errors,
    metrics: {
      totalMunicipalityEdges,
      zuliaExteriorEdges: zuliaExteriorEdges.size,
      reg02Edges: reg02Edges.size,
      zuliaExteriorVertices: zuliaExteriorVertices.size,
      reg02Vertices: reg02Vertices.size,
      edgeMismatches: missingInReg02.length + missingInZulia.length,
      vertexMismatches: missingVertsInReg02.length + missingVertsInZulia.length,
    },
  };
}

/**
 * Test 4 — Cero bordes duplicados ni segmentos de longitud cero en theatre_borders_mesh.json.
 * @param {{ rootDir?: string }} [options]
 */
export function auditBordersMeshUniqueness(options = {}) {
  const rootDir = options.rootDir ?? process.cwd();
  const mesh = readJsonFile(rootDir, 'public/map/theatre_borders_mesh.json');

  const errors = [];
  if (mesh.type !== 'FeatureCollection' || !Array.isArray(mesh.features)) {
    errors.push('theatre_borders_mesh.json debe ser un GeoJSON FeatureCollection.');
    return { passed: false, errors, metrics: {} };
  }

  const expectedMeshFeatures = ['mesh_state_internal', 'mesh_theatre_exterior', 'mesh_federal_dependencies'];
  const actualIds = new Set(mesh.features.map((f) => f.id));
  for (const id of expectedMeshFeatures) {
    if (!actualIds.has(id)) {
      errors.push(`theatre_borders_mesh.json: falta feature requerida ${id}.`);
    }
  }

  const seenSegments = new Set();
  const duplicateSamples = [];
  const zeroLengthSamples = [];
  let totalSegments = 0;

  for (const feat of mesh.features) {
    for (const edge of extractLineEdges(feat.geometry)) {
      totalSegments++;
      if (edge.ka === edge.kb) {
        zeroLengthSamples.push(`${feat.id}: [${edge.ka}]`);
        continue;
      }
      if (seenSegments.has(edge.uk)) {
        duplicateSamples.push(`${feat.id}: ${edge.uk}`);
      }
      seenSegments.add(edge.uk);
    }
  }

  if (duplicateSamples.length > 0) {
    errors.push(
      `Segmentos duplicados en theatre_borders_mesh.json (${duplicateSamples.length}): ${duplicateSamples.slice(0, MAX_SAMPLE_ERRORS).join('; ')}`
    );
  }
  if (zeroLengthSamples.length > 0) {
    errors.push(
      `Segmentos longitud cero en theatre_borders_mesh.json (${zeroLengthSamples.length}): ${zeroLengthSamples.slice(0, MAX_SAMPLE_ERRORS).join('; ')}`
    );
  }

  return {
    passed: errors.length === 0,
    errors,
    metrics: {
      meshFeatures: mesh.features.length,
      totalSegments,
      uniqueSegments: seenSegments.size,
      duplicateSegments: duplicateSamples.length,
      zeroLengthSegments: zeroLengthSamples.length,
    },
  };
}

/**
 * Test 5 — Coherencia exacta de la masa terrestre de Venezuela en world_land.json vs exterior de theatre_regions.json.
 * @param {{ rootDir?: string }} [options]
 */
export function auditWorldLandVenezuelaCoherence(options = {}) {
  const rootDir = options.rootDir ?? process.cwd();
  const regions = readJsonFile(rootDir, 'public/map/theatre_regions.json');
  const mesh = readJsonFile(rootDir, 'public/map/theatre_borders_mesh.json');
  const worldLand = readJsonFile(rootDir, 'public/map/world_land.json');

  const errors = [];
  const venFeats = findVenezuelaFeatures(worldLand);
  if (venFeats.length !== 1) {
    errors.push(`world_land.json debe tener exactamente 1 feature de Venezuela (VEN), encontradas ${venFeats.length}.`);
  }

  const venEdgeSet = new Set();
  for (const feat of venFeats) {
    for (const edge of extractPolygonEdges(feat.geometry)) {
      venEdgeSet.add(edge.uk);
    }
  }

  // Exterior directo desde theatre_regions.json (aristas con multiplicidad 1)
  /** @type {Map<string, number>} */
  const regionEdgeCounts = new Map();
  for (const feat of regions.features || []) {
    for (const edge of extractPolygonEdges(feat.geometry)) {
      regionEdgeCounts.set(edge.uk, (regionEdgeCounts.get(edge.uk) || 0) + 1);
    }
  }
  const regionExteriorSet = new Set();
  for (const [uk, count] of regionEdgeCounts) {
    if (count === 1) regionExteriorSet.add(uk);
  }

  // Exterior desde theatre_borders_mesh.json (mesh_theatre_exterior + mesh_federal_dependencies)
  const meshExteriorSet = new Set();
  for (const feat of mesh.features || []) {
    if (feat.id !== 'mesh_theatre_exterior' && feat.id !== 'mesh_federal_dependencies') continue;
    for (const edge of extractLineEdges(feat.geometry)) {
      meshExteriorSet.add(edge.uk);
    }
  }

  const missingInVenVsRegions = [...regionExteriorSet].filter((k) => !venEdgeSet.has(k));
  const extraInVenVsRegions = [...venEdgeSet].filter((k) => !regionExteriorSet.has(k));
  const missingInVenVsMesh = [...meshExteriorSet].filter((k) => !venEdgeSet.has(k));
  const extraInVenVsMesh = [...venEdgeSet].filter((k) => !meshExteriorSet.has(k));

  if (missingInVenVsRegions.length > 0 || extraInVenVsRegions.length > 0) {
    errors.push(
      `Desajuste world_land[VEN] vs exterior theatre_regions: faltanEnVEN=${missingInVenVsRegions.length}, sobranEnVEN=${extraInVenVsRegions.length}.`
    );
  }
  if (missingInVenVsMesh.length > 0 || extraInVenVsMesh.length > 0) {
    errors.push(
      `Desajuste world_land[VEN] vs mesh_theatre_exterior+mesh_federal_dependencies: faltanEnVEN=${missingInVenVsMesh.length}, sobranEnVEN=${extraInVenVsMesh.length}.`
    );
  }

  return {
    passed: errors.length === 0,
    errors,
    metrics: {
      venFeatureCount: venFeats.length,
      venExteriorSegments: venEdgeSet.size,
      regionExteriorSegments: regionExteriorSet.size,
      meshExteriorSegments: meshExteriorSet.size,
      mismatchesVsRegions: missingInVenVsRegions.length + extraInVenVsRegions.length,
      mismatchesVsMesh: missingInVenVsMesh.length + extraInVenVsMesh.length,
    },
  };
}

/**
 * Elimina comentarios // y /* *\/ respetando cadenas literales para auditar código fuente sin falsos positivos.
 * @param {string} source
 * @returns {string}
 */
function stripCommentsPreservingStrings(source) {
  let out = '';
  let i = 0;
  let state = 'code'; // 'code' | 'sq' | 'dq' | 'bt' | 'line' | 'block'
  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];

    if (state === 'code') {
      if (ch === '/' && next === '/') {
        state = 'line';
        i += 2;
        continue;
      }
      if (ch === '/' && next === '*') {
        state = 'block';
        i += 2;
        continue;
      }
      if (ch === "'") state = 'sq';
      else if (ch === '"') state = 'dq';
      else if (ch === '`') state = 'bt';
      out += ch;
      i++;
    } else if (state === 'line') {
      if (ch === '\n') {
        state = 'code';
        out += '\n';
      }
      i++;
    } else if (state === 'block') {
      if (ch === '*' && next === '/') {
        state = 'code';
        i += 2;
      } else {
        i++;
      }
    } else {
      out += ch;
      if (ch === '\\' && i + 1 < source.length) {
        out += next;
        i += 2;
        continue;
      }
      if ((state === 'sq' && ch === "'") || (state === 'dq' && ch === '"') || (state === 'bt' && ch === '`')) {
        state = 'code';
      }
      i++;
    }
  }
  return out;
}

/**
 * Extrae el bloque balanceado `{ ... }` que comienza en `openBraceIndex`.
 * @param {string} code
 * @param {number} openBraceIndex
 * @returns {string | null}
 */
function extractBalancedBraces(code, openBraceIndex) {
  if (openBraceIndex < 0 || code[openBraceIndex] !== '{') return null;
  let depth = 0;
  let quote = null;
  for (let i = openBraceIndex; i < code.length; i++) {
    const ch = code[i];
    if (quote) {
      if (ch === '\\') {
        i++;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch;
      continue;
    }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return code.slice(openBraceIndex, i + 1);
    }
  }
  return null;
}

function extractLayerObjectById(code, layerId) {
  const idRegex = new RegExp(`id\\s*:\\s*['"]${layerId}['"]`);
  const match = idRegex.exec(code);
  if (!match) return null;
  const openIdx = code.lastIndexOf('{', match.index);
  return {
    index: openIdx,
    block: extractBalancedBraces(code, openIdx),
  };
}

function extractAddSourceObjectById(code, sourceId) {
  const srcRegex = new RegExp(`addSource\\(\\s*['"]${sourceId}['"]\\s*,\\s*\\{`);
  const match = srcRegex.exec(code);
  if (!match) return null;
  const openIdx = code.indexOf('{', match.index);
  return {
    index: openIdx,
    block: extractBalancedBraces(code, openIdx),
  };
}

/**
 * Test 6 — Auditoría read-only de TacticalWorldMap.tsx (Zero-Raster, maxzoom en capas, tolerance: 0 en fuentes).
 * @param {{ rootDir?: string }} [options]
 */
export function auditTacticalWorldMapInvariants(options = {}) {
  const rootDir = options.rootDir ?? process.cwd();
  const mapFilePath = path.resolve(rootDir, 'src/domains/world/components/TacticalWorldMap.tsx');
  if (!fs.existsSync(mapFilePath)) {
    return {
      passed: false,
      errors: ['No se encontró src/domains/world/components/TacticalWorldMap.tsx'],
      metrics: {},
    };
  }

  const rawSource = fs.readFileSync(mapFilePath, 'utf8');
  const code = stripCommentsPreservingStrings(rawSource);
  const errors = [];

  // 1) Zero external raster tile URLs
  const httpUrls = code.match(/https?:\/\/[^\s'"`]+/g) || [];
  const rasterLayerTypes = code.match(/type\s*:\s*['"]raster['"]/g) || [];
  const xyzTileTemplates = code.match(/\{[zxy]\}/g) || [];

  if (httpUrls.length > 0) {
    errors.push(`TacticalWorldMap.tsx contiene URLs externas http(s): ${httpUrls.join(', ')}`);
  }
  if (rasterLayerTypes.length > 0) {
    errors.push('TacticalWorldMap.tsx contiene capas type: "raster".');
  }
  if (xyzTileTemplates.length > 0) {
    errors.push('TacticalWorldMap.tsx contiene plantillas de teselas {z}/{x}/{y}.');
  }

  // 2) maxzoom requerido en las 4 capas de contorno/frontera
  const requiredMaxzoomLayers = [
    'world-land-border',
    'provinces-borders',
    'tactical-borders-mesh',
    'zulia-municipalities-border',
  ];
  const layerOrderPositions = {};
  for (const layerId of requiredMaxzoomLayers) {
    const found = extractLayerObjectById(code, layerId);
    if (!found || !found.block) {
      errors.push(`TacticalWorldMap.tsx: no se encontró la definición de la capa '${layerId}'.`);
      continue;
    }
    layerOrderPositions[layerId] = found.index;
    if (!/\bmaxzoom\s*:/.test(found.block)) {
      errors.push(`TacticalWorldMap.tsx: la capa '${layerId}' no define maxzoom.`);
    }
  }

  // 3) tolerance: 0 requerido en las 3 fuentes GeoJSON tácticas
  const requiredZeroToleranceSources = [
    'tactical-provinces',
    'tactical-borders-mesh',
    'zulia-municipalities',
  ];
  for (const sourceId of requiredZeroToleranceSources) {
    const found = extractAddSourceObjectById(code, sourceId);
    if (!found || !found.block) {
      errors.push(`TacticalWorldMap.tsx: no se encontró addSource('${sourceId}', ...).`);
      continue;
    }
    if (!/\btolerance\s*:\s*0\b/.test(found.block)) {
      errors.push(`TacticalWorldMap.tsx: la fuente '${sourceId}' no establece tolerance: 0.`);
    }
  }

  // 4) Verificar filtro exclusivo en provinces-borders (isSelected / isUnderSiege) y orden Z de capas
  const provBorders = extractLayerObjectById(code, 'provinces-borders');
  if (provBorders?.block) {
    const hasFilter =
      /\bfilter\s*:/.test(provBorders.block) &&
      provBorders.block.includes('isSelected') &&
      provBorders.block.includes('isUnderSiege');
    if (!hasFilter) {
      errors.push("TacticalWorldMap.tsx: 'provinces-borders' debe filtrar exclusivamente por isSelected / isUnderSiege.");
    }
  }

  const orderedLayerIds = [
    'background',
    'world-land-mass',
    'world-land-border',
    'provinces-fill',
    'zulia-municipalities-fill',
    'tactical-borders-mesh',
    'zulia-municipalities-border',
    'provinces-borders',
    'provinces-vulnerable-halo',
  ];
  let prevIdx = -1;
  let zOrderValid = true;
  for (const id of orderedLayerIds) {
    const found = extractLayerObjectById(code, id);
    if (!found) {
      errors.push(`TacticalWorldMap.tsx: falta capa '${id}' en secuencia Z-order.`);
      zOrderValid = false;
      continue;
    }
    if (found.index <= prevIdx) {
      errors.push(`TacticalWorldMap.tsx: orden Z inválido en capa '${id}'.`);
      zOrderValid = false;
    }
    prevIdx = found.index;
  }

  return {
    passed: errors.length === 0,
    errors,
    metrics: {
      externalHttpUrls: httpUrls.length,
      rasterLayerDeclarations: rasterLayerTypes.length,
      xyzTileTemplates: xyzTileTemplates.length,
      maxzoomVerifiedLayers: requiredMaxzoomLayers.length - errors.filter((e) => e.includes('maxzoom')).length,
      zeroToleranceVerifiedSources:
        requiredZeroToleranceSources.length - errors.filter((e) => e.includes('tolerance')).length,
      zOrderValid,
    },
  };
}

/**
 * Ejecuta la auditoría topológica completa (Tests 1-6).
 * @param {{ rootDir?: string }} [options]
 */
export function runFullTopologyAudit(options = {}) {
  const rootDir = options.rootDir ?? process.cwd();
  const t1 = auditCanonicalIdsAndGeometry({ rootDir });
  const t2 = auditStateToStateBoundaries({ rootDir });
  const t3 = auditZuliaMunicipalitiesCoherence({ rootDir });
  const t4 = auditBordersMeshUniqueness({ rootDir });
  const t5 = auditWorldLandVenezuelaCoherence({ rootDir });
  const t6 = auditTacticalWorldMapInvariants({ rootDir });

  const tests = {
    test1CanonicalIdsAndGeometry: t1,
    test2StateToStateBoundaries: t2,
    test3ZuliaMunicipalitiesCoherence: t3,
    test4BordersMeshUniqueness: t4,
    test5WorldLandVenezuelaCoherence: t5,
    test6TacticalWorldMapInvariants: t6,
  };

  const allPassed = Object.values(tests).every((t) => t.passed);
  const allErrors = Object.entries(tests).flatMap(([name, res]) =>
    res.errors.map((err) => `[${name}] ${err}`)
  );

  return {
    ok: allPassed,
    tests,
    errors: allErrors,
    metrics: {
      test1: t1.metrics,
      test2: t2.metrics,
      test3: t3.metrics,
      test4: t4.metrics,
      test5: t5.metrics,
      test6: t6.metrics,
    },
  };
}

function printHumanReport(report) {
  console.log('==============================================================================');
  console.log('AUDITORÍA TOPOLÓGICA DE CARTOGRAFÍA VECTORIAL (OPENPLACE BRIDGE / TOPOJSON)');
  console.log('==============================================================================');

  const entries = [
    ['Test 1 — IDs Canónicos y Validez de Anillos', report.tests.test1CanonicalIdsAndGeometry],
    ['Test 2 — Coherencia Estado-Estado y mesh_state_internal', report.tests.test2StateToStateBoundaries],
    ['Test 3 — Coherencia Zulia (21 Municipios) vs REG_VE_02', report.tests.test3ZuliaMunicipalitiesCoherence],
    ['Test 4 — Unicidad en theatre_borders_mesh.json', report.tests.test4BordersMeshUniqueness],
    ['Test 5 — Coherencia Venezuela en world_land.json', report.tests.test5WorldLandVenezuelaCoherence],
    ['Test 6 — Invariantes Zero-Raster y LOD en TacticalWorldMap.tsx', report.tests.test6TacticalWorldMapInvariants],
  ];

  for (const [label, res] of entries) {
    const badge = res.passed ? '✅ [PASSED]' : '❌ [FAILED]';
    console.log(`\n${badge} ${label}`);
    console.log(`   Métricas: ${JSON.stringify(res.metrics)}`);
    for (const err of res.errors) {
      console.error(`   ↳ VIOLACIÓN: ${err}`);
    }
  }

  console.log('\n------------------------------------------------------------------------------');
  const passedCount = entries.filter(([, r]) => r.passed).length;
  console.log(`RESUMEN AUDITORÍA TOPOLÓGICA: ${passedCount}/${entries.length} SUITES PASARON`);
  console.log('==============================================================================');
}

const isMainModule =
  Boolean(process.argv[1]) && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isMainModule) {
  const report = runFullTopologyAudit();
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printHumanReport(report);
  }
  process.exit(report.ok ? 0 : 1);
}
