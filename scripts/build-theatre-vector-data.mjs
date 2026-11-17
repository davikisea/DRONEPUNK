import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import * as topojsonServer from 'topojson-server';
import * as topojsonClient from 'topojson-client';
import * as topojsonSimplify from 'topojson-simplify';

const PUBLIC_MAP_DIR = path.resolve('public/map');
const ADM2_URL =
  'https://github.com/wmgeolab/geoBoundaries/raw/9469f09/releaseData/gbOpen/VEN/ADM2/geoBoundaries-VEN-ADM2.geojson';
const ADM1_SIMPLIFIED_URL =
  'https://github.com/wmgeolab/geoBoundaries/raw/9469f09/releaseData/gbOpen/VEN/ADM1/geoBoundaries-VEN-ADM1_simplified.geojson';

const DEFAULT_MIN_WEIGHT = 1.5e-5;
const COORD_DECIMALS = 5;
const QUANTIZATION = 1e5;

// Mapeo canónico exacto a politicalAliceEngine
export const STATE_NAME_TO_REGION_ID = {
  'Distrito Capital': 'REG_VE_01',
  'Zulia': 'REG_VE_02',
  'Bolívar': 'REG_VE_03',
  'Anzoátegui': 'REG_VE_04',
  'Carabobo': 'REG_VE_05',
  'Miranda': 'REG_VE_06',
  'Lara': 'REG_VE_07',
  'Aragua': 'REG_VE_08',
  'Falcón': 'REG_VE_09',
  'Táchira': 'REG_VE_10',
  'Sucre': 'REG_VE_11',
  'Monagas': 'REG_VE_12',
  'Portuguesa': 'REG_VE_13',
  'Barinas': 'REG_VE_14',
  'Mérida': 'REG_VE_15',
  'Trujillo': 'REG_VE_16',
  'Guárico': 'REG_VE_17',
  'Yaracuy': 'REG_VE_18',
  'Apure': 'REG_VE_19',
  'Nueva Esparta': 'REG_VE_20',
  'Cojedes': 'REG_VE_21',
  'Delta Amacuro': 'REG_VE_22',
  'Amazonas': 'REG_VE_23',
  'La Guaira': 'REG_VE_24',
  'Vargas': 'REG_VE_24',
  'Dependencias Federales': 'BUF_MARITIME_CARIBE',
};

// Mapeo canónico exacto de los 21 municipios de Zulia (TacticalWorldMap.tsx + theatre_cities.json)
const ZULIA_MUNICIPALITIES = [
  { aliases: ['Maracaibo'], id: 'MUN_ZULIA_MARACAIBO', name: 'Maracaibo', cityName: 'Maracaibo' },
  { aliases: ['San Francisco'], id: 'MUN_ZULIA_SAN_FRANCISCO', name: 'San Francisco', cityName: 'San Francisco' },
  { aliases: ['Cabimas'], id: 'MUN_ZULIA_CABIMAS', name: 'Cabimas', cityName: 'Cabimas' },
  { aliases: ['Santa Rita'], id: 'MUN_ZULIA_SANTA_RITA', name: 'Santa Rita', cityName: 'Santa Rita' },
  { aliases: ['Miranda'], id: 'MUN_ZULIA_MIRANDA', name: 'Miranda', cityName: 'Los Puertos de Altagracia' },
  { aliases: ['Lagunillas'], id: 'MUN_ZULIA_LAGUNILLAS', name: 'Lagunillas', cityName: 'Ciudad Ojeda' },
  { aliases: ['Valmore Rodríguez'], id: 'MUN_ZULIA_VALMORE_RODRIGUEZ', name: 'Valmore Rodríguez', cityName: 'Bachaquero' },
  { aliases: ['Baralt'], id: 'MUN_ZULIA_BARALT', name: 'Baralt', cityName: 'Mene Grande' },
  { aliases: ['Simón Bolívar'], id: 'MUN_ZULIA_SIMON_BOLIVAR', name: 'Simón Bolívar', cityName: 'Tía Juana' },
  { aliases: ['Mara'], id: 'MUN_ZULIA_MARA', name: 'Mara', cityName: 'San Rafael del Moján' },
  { aliases: ['Páez', 'Guajira'], id: 'MUN_ZULIA_GUAJIRA', name: 'Guajira', cityName: 'Sinamaica / Paraguaipoa' },
  { aliases: ['Jesús Enrique Lossada'], id: 'MUN_ZULIA_JESUS_ENRIQUE_LOSSADA', name: 'Jesús Enrique Lossada', cityName: 'La Concepción' },
  { aliases: ['La Cañada de Urdaneta'], id: 'MUN_ZULIA_LA_CANADA_DE_URDANETA', name: 'La Cañada de Urdaneta', cityName: 'Concepción' },
  { aliases: ['Machiques de Perijá'], id: 'MUN_ZULIA_MACHIQUES_DE_PERIJA', name: 'Machiques de Perijá', cityName: 'Machiques' },
  { aliases: ['Rosario de Perijá'], id: 'MUN_ZULIA_ROSARIO_DE_PERIJA', name: 'Rosario de Perijá', cityName: 'La Villa del Rosario' },
  { aliases: ['Colón'], id: 'MUN_ZULIA_COLON', name: 'Colón', cityName: 'San Carlos del Zulia' },
  { aliases: ['Francisco Javier Pulgar'], id: 'MUN_ZULIA_FRANCISCO_JAVIER_PULGAR', name: 'Francisco Javier Pulgar', cityName: 'Pueblo Nuevo-El Chivo' },
  { aliases: ['Catatumbo'], id: 'MUN_ZULIA_CATATUMBO', name: 'Catatumbo', cityName: 'Encontrados' },
  { aliases: ['Jesús María Semprum', 'Jesús María Semprúm'], id: 'MUN_ZULIA_JESUS_MARIA_SEMPRUM', name: 'Jesús María Semprúm', cityName: 'Casigua El Cubo' },
  { aliases: ['Sucre'], id: 'MUN_ZULIA_SUCRE', name: 'Sucre', cityName: 'Bobures' },
  { aliases: ['Almirante Padilla'], id: 'MUN_ZULIA_ALMIRANTE_PADILLA', name: 'Almirante Padilla', cityName: 'El Toro' },
];

const ZULIA_BY_ALIAS = new Map();
const ZULIA_ORDER = new Map();
ZULIA_MUNICIPALITIES.forEach((entry, index) => {
  ZULIA_ORDER.set(entry.id, index);
  for (const alias of entry.aliases) {
    ZULIA_BY_ALIAS.set(alias.toLowerCase(), entry);
  }
});

function ensurePublicMapDir() {
  if (!fs.existsSync(PUBLIC_MAP_DIR)) {
    fs.mkdirSync(PUBLIC_MAP_DIR, { recursive: true });
  }
}

function slugifyUpper(value) {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function roundCoord(value, decimals = COORD_DECIMALS) {
  return Number(value.toFixed(decimals));
}

function ringArea(ring) {
  let sum = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    sum += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  }
  return Math.abs(sum) * 0.5;
}

function getBBox(geom) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const scan = (coords) => {
    if (typeof coords[0] === 'number') {
      if (coords[0] < minX) minX = coords[0];
      if (coords[0] > maxX) maxX = coords[0];
      if (coords[1] < minY) minY = coords[1];
      if (coords[1] > maxY) maxY = coords[1];
    } else {
      for (const c of coords) scan(c);
    }
  };
  scan(geom.coordinates);
  return [minX, minY, maxX, maxY];
}

function pointInRing(pt, ring) {
  const [x, y] = pt;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function pointInPolygon(pt, coords) {
  if (!pointInRing(pt, coords[0])) return false;
  for (let i = 1; i < coords.length; i++) {
    if (pointInRing(pt, coords[i])) return false;
  }
  return true;
}

function pointInGeometry(pt, geom) {
  if (!geom) return false;
  if (geom.type === 'Polygon') return pointInPolygon(pt, geom.coordinates);
  if (geom.type === 'MultiPolygon') return geom.coordinates.some((poly) => pointInPolygon(pt, poly));
  return false;
}

function getInteriorSamplePoints(geom) {
  const rawPolys = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
  const polys = [...rawPolys].sort((a, b) => ringArea(b[0]) - ringArea(a[0]));

  for (const gridN of [5, 9, 15]) {
    const pts = [];
    for (const poly of polys.slice(0, 3)) {
      const [minX, minY, maxX, maxY] = getBBox({ type: 'Polygon', coordinates: poly });
      for (let ix = 1; ix <= gridN; ix++) {
        for (let iy = 1; iy <= gridN; iy++) {
          const pt = [
            minX + ((maxX - minX) * ix) / (gridN + 1),
            minY + ((maxY - minY) * iy) / (gridN + 1),
          ];
          if (pointInPolygon(pt, poly)) pts.push(pt);
        }
      }
      if (pts.length >= 3) return pts;
    }
    if (pts.length > 0) return pts;
  }

  // Fallback: promedio de vértices del anillo exterior mayor
  const ring = polys[0][0];
  let sx = 0;
  let sy = 0;
  for (const pt of ring) {
    sx += pt[0];
    sy += pt[1];
  }
  return [[sx / ring.length, sy / ring.length]];
}

function cleanRingCoords(ring, decimals = null) {
  const cleaned = [];
  for (const pt of ring) {
    const rx = decimals == null ? pt[0] : roundCoord(pt[0], decimals);
    const ry = decimals == null ? pt[1] : roundCoord(pt[1], decimals);
    const prev = cleaned[cleaned.length - 1];
    if (!prev || prev[0] !== rx || prev[1] !== ry) {
      cleaned.push([rx, ry]);
    }
  }
  if (
    cleaned.length >= 2 &&
    (cleaned[0][0] !== cleaned[cleaned.length - 1][0] || cleaned[0][1] !== cleaned[cleaned.length - 1][1])
  ) {
    cleaned.push([cleaned[0][0], cleaned[0][1]]);
  }
  if (cleaned.length < 4 || ringArea(cleaned) === 0) return null;
  return cleaned;
}

export function cleanGeometry(geom, decimals = null) {
  if (!geom) return null;
  const cleanPoly = (poly) => {
    if (!Array.isArray(poly) || poly.length === 0) return null;
    const exterior = cleanRingCoords(poly[0], decimals);
    if (!exterior) return null;
    const holes = poly.slice(1).map((r) => cleanRingCoords(r, decimals)).filter(Boolean);
    return [exterior, ...holes];
  };

  if (geom.type === 'Polygon') {
    const poly = cleanPoly(geom.coordinates);
    return poly ? { type: 'Polygon', coordinates: poly } : null;
  }
  if (geom.type === 'MultiPolygon') {
    const polys = geom.coordinates.map(cleanPoly).filter(Boolean);
    if (polys.length === 0) return null;
    return polys.length === 1
      ? { type: 'Polygon', coordinates: polys[0] }
      : { type: 'MultiPolygon', coordinates: polys };
  }
  return geom;
}

function preserveClosedArcs(presimplifiedTopo, minWeight) {
  return {
    ...presimplifiedTopo,
    arcs: presimplifiedTopo.arcs.map((arc) => {
      const first = arc[0];
      const last = arc[arc.length - 1];
      const isClosed = first[0] === last[0] && first[1] === last[1];
      if (!isClosed || arc.length <= 4) {
        return isClosed ? arc.map((p) => [p[0], p[1], Infinity]) : arc;
      }
      const surviving = arc.filter((p) => p[2] >= minWeight).length;
      if (surviving >= 4) return arc;

      // Garantiza al menos 4 vértices [start, pA, pB, end] en islas de arco único
      const interiorIndices = [];
      for (let i = 1; i < arc.length - 1; i++) interiorIndices.push(i);
      interiorIndices.sort((a, b) => arc[b][2] - arc[a][2]);
      const keep = new Set(interiorIndices.slice(0, 2));
      return arc.map((p, idx) => (keep.has(idx) ? [p[0], p[1], Math.max(p[2], minWeight)] : p));
    }),
  };
}

function decodeAndSnapTopoArcs(topo, decimals = COORD_DECIMALS) {
  const transformPoint = topo.transform ? topojsonClient.transform(topo.transform) : (p) => p;
  let zeroLengthArcCount = 0;

  topo.arcs = topo.arcs.map((arc) => {
    const cleaned = [];
    for (let i = 0; i < arc.length; i++) {
      const pt = transformPoint(arc[i], i);
      const rx = roundCoord(pt[0], decimals);
      const ry = roundCoord(pt[1], decimals);
      const prev = cleaned[cleaned.length - 1];
      if (!prev || prev[0] !== rx || prev[1] !== ry) {
        cleaned.push([rx, ry]);
      }
    }
    if (cleaned.length < 2) {
      const p0 = transformPoint(arc[0], 0);
      const pLast = transformPoint(arc[arc.length - 1], arc.length - 1);
      const r0 = [roundCoord(p0[0], decimals), roundCoord(p0[1], decimals)];
      const rLast = [roundCoord(pLast[0], decimals), roundCoord(pLast[1], decimals)];
      if (r0[0] === rLast[0] && r0[1] === rLast[1]) zeroLengthArcCount++;
      return [r0, rLast];
    }
    return cleaned;
  });

  delete topo.transform;
  return zeroLengthArcCount;
}

function pointKey(pt) {
  return `${pt[0]},${pt[1]}`;
}

function undirectedSegKey(u, v) {
  return u < v ? `${u}|${v}` : `${v}|${u}`;
}

function extractDirectedEdges(geom) {
  const edges = [];
  if (!geom) return edges;
  const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
  for (const poly of polys) {
    for (const ring of poly) {
      for (let i = 0; i < ring.length - 1; i++) {
        const u = pointKey(ring[i]);
        const v = pointKey(ring[i + 1]);
        if (u !== v) edges.push([u, v]);
      }
    }
  }
  return edges;
}

function verifyTopologyInvariants({
  regionsGeoJson,
  zuliaGeoJson,
  bordersMeshGeoJson,
  venezuelaLandGeometry,
  zeroLengthArcCount,
}) {
  if (zeroLengthArcCount > 0) {
    throw new Error(`Se detectaron ${zeroLengthArcCount} arcos de longitud cero tras redondeo.`);
  }
  if (regionsGeoJson.features.length !== 25) {
    throw new Error(`Se esperaban 25 features en theatre_regions.json, encontrados: ${regionsGeoJson.features.length}`);
  }
  if (zuliaGeoJson && zuliaGeoJson.features.length !== 21) {
    throw new Error(`Se esperaban 21 features en zulia_municipalities.json, encontrados: ${zuliaGeoJson.features.length}`);
  }

  for (const feat of regionsGeoJson.features) {
    if (!feat.geometry) throw new Error(`Geometría colapsada en región ${feat.id}`);
  }

  // 1. Verificar duplicados y longitud cero en theatre_borders_mesh.json
  const meshSegSet = new Set();
  const meshInternalSegSet = new Set();
  const meshExteriorSegSet = new Set();
  let meshDuplicates = 0;
  let meshZeroSegs = 0;

  for (const feat of bordersMeshGeoJson.features) {
    const isInternal = feat.id === 'mesh_state_internal';
    for (const line of feat.geometry.coordinates) {
      for (let i = 0; i < line.length - 1; i++) {
        const u = pointKey(line[i]);
        const v = pointKey(line[i + 1]);
        if (u === v) {
          meshZeroSegs++;
          continue;
        }
        const uk = undirectedSegKey(u, v);
        if (meshSegSet.has(uk)) meshDuplicates++;
        meshSegSet.add(uk);
        if (isInternal) meshInternalSegSet.add(uk);
        else meshExteriorSegSet.add(uk);
      }
    }
  }
  if (meshDuplicates > 0 || meshZeroSegs > 0) {
    throw new Error(`theatre_borders_mesh inválido: duplicados=${meshDuplicates}, segmentosCero=${meshZeroSegs}`);
  }

  // 2. Verificar coincidencia dirigida (u->v en Estado A vs v->u en Estado B) en theatre_regions.json
  const directedStateEdges = new Map();
  const undirectedStateOwners = new Map();
  for (const feat of regionsGeoJson.features) {
    for (const [u, v] of extractDirectedEdges(feat.geometry)) {
      const dk = `${u}->${v}`;
      if (!directedStateEdges.has(dk)) directedStateEdges.set(dk, []);
      directedStateEdges.get(dk).push(feat.id);

      const uk = undirectedSegKey(u, v);
      if (!undirectedStateOwners.has(uk)) undirectedStateOwners.set(uk, new Set());
      undirectedStateOwners.get(uk).add(feat.id);
    }
  }

  let sameDirCollisions = 0;
  for (const [, owners] of directedStateEdges) {
    if (owners.length > 1) sameDirCollisions++;
  }

  let internalDirMismatches = 0;
  for (const feat of bordersMeshGeoJson.features) {
    if (feat.id !== 'mesh_state_internal') continue;
    for (const line of feat.geometry.coordinates) {
      for (let i = 0; i < line.length - 1; i++) {
        const u = pointKey(line[i]);
        const v = pointKey(line[i + 1]);
        if (u === v) continue;
        const fwd = directedStateEdges.get(`${u}->${v}`) || [];
        const rev = directedStateEdges.get(`${v}->${u}`) || [];
        if (fwd.length !== 1 || rev.length !== 1 || fwd[0] === rev[0]) {
          internalDirMismatches++;
        }
      }
    }
  }

  let unindexedSharedStateEdges = 0;
  for (const [uk, owners] of undirectedStateOwners) {
    if (owners.size > 1 && !meshInternalSegSet.has(uk)) {
      unindexedSharedStateEdges++;
    }
  }

  if (sameDirCollisions > 0 || internalDirMismatches > 0 || unindexedSharedStateEdges > 0) {
    throw new Error(
      `Desajuste topológico entre estados: sameDir=${sameDirCollisions}, internalDirMismatches=${internalDirMismatches}, unindexedShared=${unindexedSharedStateEdges}`
    );
  }

  // 3. Verificar coincidencia 100% entre perímetro exterior de Zulia y REG_VE_02
  let zuliaExteriorEdgesCount = 0;
  let zuliaMismatches = 0;
  if (zuliaGeoJson) {
    const zuliaMunCounts = new Map();
    for (const feat of zuliaGeoJson.features) {
      for (const [u, v] of extractDirectedEdges(feat.geometry)) {
        const uk = undirectedSegKey(u, v);
        zuliaMunCounts.set(uk, (zuliaMunCounts.get(uk) || 0) + 1);
      }
    }
    const zuliaStateFeat = regionsGeoJson.features.find((f) => f.id === 'REG_VE_02');
    const zuliaStateSet = new Set(
      extractDirectedEdges(zuliaStateFeat.geometry).map(([u, v]) => undirectedSegKey(u, v))
    );

    for (const [uk, count] of zuliaMunCounts) {
      if (count === 1) {
        zuliaExteriorEdgesCount++;
        if (!zuliaStateSet.has(uk)) zuliaMismatches++;
      }
    }
    for (const uk of zuliaStateSet) {
      if (!zuliaMunCounts.has(uk)) zuliaMismatches++;
    }
    if (zuliaMismatches > 0) {
      throw new Error(`Desajuste Zulia vs REG_VE_02: ${zuliaMismatches} aristas distintas`);
    }
  }

  // 4. Verificar coincidencia 100% entre exterior de Venezuela disuelta y mesh exterior
  const venLandSet = new Set(
    extractDirectedEdges(venezuelaLandGeometry).map(([u, v]) => undirectedSegKey(u, v))
  );
  let worldLandMismatches = 0;
  for (const uk of meshExteriorSegSet) {
    if (!venLandSet.has(uk)) worldLandMismatches++;
  }
  for (const uk of venLandSet) {
    if (!meshExteriorSegSet.has(uk)) worldLandMismatches++;
  }
  if (worldLandMismatches > 0) {
    throw new Error(`Desajuste venezuelaLandGeometry vs mesh exterior: ${worldLandMismatches} aristas distintas`);
  }

  return {
    regionsCount: regionsGeoJson.features.length,
    zuliaCount: zuliaGeoJson?.features.length ?? 0,
    meshInternalSegments: meshInternalSegSet.size,
    meshExteriorSegments: meshExteriorSegSet.size,
    sameDirCollisions,
    internalDirMismatches,
    unindexedSharedStateEdges,
    zuliaExteriorEdgesCount,
    zuliaMismatches,
    worldLandMismatches,
  };
}

async function fetchJson(url, label) {
  console.log(`Descargando ${label} (${url})...`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Error al descargar ${label}: HTTP ${res.status}`);
  return res.json();
}

function classifyMunicipalityState(feat, adm1States) {
  const pts = getInteriorSamplePoints(feat.geometry);
  const votes = new Map();
  for (const pt of pts) {
    for (const st of adm1States) {
      const [minX, minY, maxX, maxY] = st.bbox;
      if (pt[0] < minX || pt[0] > maxX || pt[1] < minY || pt[1] > maxY) continue;
      if (pointInGeometry(pt, st.geometry)) {
        votes.set(st.id, (votes.get(st.id) || 0) + 1);
      }
    }
  }
  let bestState = null;
  let bestCount = -1;
  for (const [stateId, count] of votes) {
    if (count > bestCount) {
      bestCount = count;
      bestState = stateId;
    }
  }
  return bestState;
}

export async function buildTheatreTopology({
  minWeight = DEFAULT_MIN_WEIGHT,
  targetStates = ['REG_VE_02'],
} = {}) {
  const [adm2Data, adm1Data] = await Promise.all([
    fetchJson(ADM2_URL, 'geoBoundaries VEN ADM2 (full)'),
    fetchJson(ADM1_SIMPLIFIED_URL, 'geoBoundaries VEN ADM1_simplified'),
  ]);

  const adm1States = [];
  let fedDepsFeature = null;

  for (const feat of adm1Data.features || []) {
    const rawName = feat.properties?.shapeName?.trim();
    const regionId = STATE_NAME_TO_REGION_ID[rawName];
    if (!regionId) {
      throw new Error(`Estado ADM1 desconocido en geoBoundaries: "${rawName}"`);
    }
    if (regionId === 'BUF_MARITIME_CARIBE') {
      fedDepsFeature = {
        type: 'Feature',
        id: 'BUF_MARITIME_CARIBE',
        properties: {
          id: 'BUF_MARITIME_CARIBE',
          name: rawName,
          shapeISO: feat.properties?.shapeISO || 'VE-W',
          isCapital: false,
        },
        geometry: cleanGeometry(feat.geometry, COORD_DECIMALS),
      };
      continue;
    }
    adm1States.push({
      id: regionId,
      name: rawName,
      shapeISO: feat.properties?.shapeISO || '',
      isCapital: regionId === 'REG_VE_01',
      bbox: getBBox(feat.geometry),
      geometry: feat.geometry,
    });
  }

  if (adm1States.length !== 24 || !fedDepsFeature) {
    throw new Error(
      `ADM1 inválido: ${adm1States.length} estados + fedDeps=${Boolean(fedDepsFeature)}`
    );
  }

  const stateById = new Map(adm1States.map((s) => [s.id, s]));
  const classifiedMuns = [];
  const usedMunIds = new Set();

  for (const feat of adm2Data.features || []) {
    const rawName = feat.properties?.shapeName?.trim();
    if (!rawName || rawName === 'Zona en Reclamación') continue;

    const stateId = classifyMunicipalityState(feat, adm1States);
    if (!stateId) {
      throw new Error(`No se pudo clasificar municipio ADM2 "${rawName}" en ningún estado ADM1`);
    }
    const stateMeta = stateById.get(stateId);
    const snapped = cleanGeometry(feat.geometry, COORD_DECIMALS);
    if (!snapped) {
      throw new Error(`Geometría inválida tras pre-snap para municipio "${rawName}" (${stateId})`);
    }

    let munId;
    let munName = rawName;
    let cityName = rawName;

    if (stateId === 'REG_VE_02') {
      const canonical = ZULIA_BY_ALIAS.get(rawName.toLowerCase());
      if (!canonical) {
        throw new Error(`Municipio de Zulia sin mapeo canónico: "${rawName}"`);
      }
      munId = canonical.id;
      munName = canonical.name;
      cityName = canonical.cityName;
    } else {
      const stateSlug = slugifyUpper(stateMeta.name);
      const munSlug = slugifyUpper(rawName);
      munId = `MUN_${stateSlug}_${munSlug}`;
    }

    if (usedMunIds.has(munId)) {
      throw new Error(`ID municipal duplicado: ${munId} (${rawName}, ${stateId})`);
    }
    usedMunIds.add(munId);

    classifiedMuns.push({
      type: 'Feature',
      id: munId,
      properties: {
        id: munId,
        name: munName,
        cityName,
        stateId,
        stateName: stateMeta.name,
      },
      geometry: snapped,
    });
  }

  console.log(`Clasificados ${classifiedMuns.length} municipios ADM2 en ${adm1States.length} estados.`);

  // Construir UNA ÚNICA topología TopoJSON
  const rawTopo = topojsonServer.topology(
    {
      municipalities: { type: 'FeatureCollection', features: classifiedMuns },
      federal_dependencies: { type: 'FeatureCollection', features: [fedDepsFeature] },
    },
    QUANTIZATION
  );

  // Simplificación topológica preservando arcos compartidos e islas pequeñas
  const presimplified = topojsonSimplify.presimplify(rawTopo);
  const protectedPresimp = preserveClosedArcs(presimplified, minWeight);
  const topo = topojsonSimplify.simplify(protectedPresimp, minWeight);

  // CRÍTICO: decodificar arcos, redondear exactamente, dedup consecutivo y eliminar topo.transform
  const zeroLengthArcCount = decodeAndSnapTopoArcs(topo, COORD_DECIMALS);

  // 1) Exportar theatre_regions.json (24 estados disueltos + Dependencias Federales)
  const regionFeatures = [];
  for (const st of adm1States) {
    const stateGeoms = topo.objects.municipalities.geometries.filter(
      (g) => g.properties.stateId === st.id
    );
    if (stateGeoms.length === 0) {
      throw new Error(`Estado ${st.id} (${st.name}) quedó sin municipios asignados`);
    }
    const mergedGeom = cleanGeometry(topojsonClient.merge(topo, stateGeoms));
    if (!mergedGeom) {
      throw new Error(`Estado ${st.id} (${st.name}) colapsó tras merge topológico`);
    }
    regionFeatures.push({
      type: 'Feature',
      id: st.id,
      properties: {
        id: st.id,
        name: st.name,
        shapeISO: st.shapeISO,
        isCapital: st.isCapital,
      },
      geometry: mergedGeom,
    });
  }

  const fedFeatureOut = topojsonClient.feature(topo, topo.objects.federal_dependencies).features[0];
  fedFeatureOut.id = 'BUF_MARITIME_CARIBE';
  fedFeatureOut.geometry = cleanGeometry(fedFeatureOut.geometry);
  regionFeatures.push(fedFeatureOut);

  const regionsGeoJson = {
    type: 'FeatureCollection',
    features: regionFeatures,
  };

  // 2) Exportar municipios parametrizados (por defecto REG_VE_02 -> zulia_municipalities.json)
  const resolvedStates = targetStates.includes('ALL')
    ? adm1States.map((s) => s.id)
    : targetStates.map((s) => STATE_NAME_TO_REGION_ID[s] || s);

  const municipalExports = new Map();
  for (const stateId of resolvedStates) {
    const stateMeta = stateById.get(stateId);
    if (!stateMeta) continue;
    const geoms = topo.objects.municipalities.geometries.filter(
      (g) => g.properties.stateId === stateId
    );
    const features = geoms.map((g) => {
      const feat = topojsonClient.feature(topo, g);
      feat.id = g.properties.id;
      feat.geometry = cleanGeometry(feat.geometry);
      return feat;
    });
    if (stateId === 'REG_VE_02') {
      features.sort((a, b) => ZULIA_ORDER.get(a.id) - ZULIA_ORDER.get(b.id));
    }
    const fileName =
      stateId === 'REG_VE_02'
        ? 'zulia_municipalities.json'
        : `${slugifyUpper(stateMeta.name).toLowerCase()}_municipalities.json`;
    municipalExports.set(stateId, {
      fileName,
      featureCollection: { type: 'FeatureCollection', features },
    });
  }

  // 3) Exportar malla única sin duplicados (theatre_borders_mesh.json)
  const meshStateInternal = topojsonClient.mesh(
    topo,
    topo.objects.municipalities,
    (a, b) => a !== b && a.properties.stateId !== b.properties.stateId
  );
  const meshTheatreExterior = topojsonClient.mesh(
    topo,
    topo.objects.municipalities,
    (a, b) => a === b
  );
  const meshFederalDependencies = topojsonClient.mesh(
    topo,
    topo.objects.federal_dependencies,
    (a, b) => a === b
  );

  const bordersMeshGeoJson = {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        id: 'mesh_state_internal',
        properties: { id: 'mesh_state_internal', kind: 'state_internal' },
        geometry: meshStateInternal,
      },
      {
        type: 'Feature',
        id: 'mesh_theatre_exterior',
        properties: { id: 'mesh_theatre_exterior', kind: 'theatre_exterior' },
        geometry: meshTheatreExterior,
      },
      {
        type: 'Feature',
        id: 'mesh_federal_dependencies',
        properties: { id: 'mesh_federal_dependencies', kind: 'federal_dependencies' },
        geometry: meshFederalDependencies,
      },
    ],
  };

  // 4) Masa terrestre disuelta exacta de Venezuela (para world_land.json)
  const mainlandDissolved = cleanGeometry(
    topojsonClient.merge(topo, topo.objects.municipalities.geometries)
  );
  const mainlandPolys =
    mainlandDissolved.type === 'Polygon'
      ? [mainlandDissolved.coordinates]
      : mainlandDissolved.coordinates;
  const fedPolys =
    fedFeatureOut.geometry.type === 'Polygon'
      ? [fedFeatureOut.geometry.coordinates]
      : fedFeatureOut.geometry.coordinates;
  const venezuelaLandGeometry = {
    type: 'MultiPolygon',
    coordinates: [...mainlandPolys, ...fedPolys],
  };

  const zuliaGeoJson = municipalExports.get('REG_VE_02')?.featureCollection || null;
  const verification = verifyTopologyInvariants({
    regionsGeoJson,
    zuliaGeoJson,
    bordersMeshGeoJson,
    venezuelaLandGeometry,
    zeroLengthArcCount,
  });

  return {
    topo,
    regionsGeoJson,
    municipalExports,
    bordersMeshGeoJson,
    venezuelaLandGeometry,
    verification,
  };
}

async function buildRoads() {
  console.log('Consultando red vial troncal de Venezuela (OpenStreetMap Overpass)...');
  const query = `[out:json][timeout:60];
(
  way["highway"="motorway"](0.5,-73.5,12.5,-59.5);
  way["highway"="trunk"](0.5,-73.5,12.5,-59.5);
);
out geom;`;

  const res = await fetch('https://overpass-api.de/api/interpreter', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'User-Agent': 'GeotacticsTacticalCommand/1.0',
    },
    body: 'data=' + encodeURIComponent(query),
  });

  if (!res.ok) throw new Error('Error de Overpass: ' + res.status);
  const osmData = await res.json();
  console.log(`Elementos OSM recibidos: ${osmData.elements?.length || 0}`);

  const features = [];
  for (const el of osmData.elements || []) {
    if (el.type === 'way' && el.geometry && el.geometry.length >= 2) {
      const coords = el.geometry.map((pt) => [
        Number(pt.lon.toFixed(5)),
        Number(pt.lat.toFixed(5)),
      ]);
      features.push({
        type: 'Feature',
        id: `road_${el.id}`,
        properties: {
          id: el.id,
          name: el.tags?.name || el.tags?.ref || 'Carretera Troncal',
          ref: el.tags?.ref || '',
          highway: el.tags?.highway || 'trunk',
          lanes: el.tags?.lanes ? Number(el.tags.lanes) : 2,
        },
        geometry: {
          type: 'LineString',
          coordinates: coords,
        },
      });
    }
  }

  const outputPath = path.join(PUBLIC_MAP_DIR, 'theatre_roads.json');
  fs.writeFileSync(outputPath, JSON.stringify({ type: 'FeatureCollection', features }), 'utf-8');
  console.log(
    `✓ Carreteras guardadas en ${outputPath} (${(fs.statSync(outputPath).size / 1024).toFixed(1)} KB, ${features.length} segmentos)`
  );
}

export function parseCliArgs(argv = process.argv.slice(2)) {
  let skipRoads = false;
  let rebuildRoads = false;
  let targetStates = ['REG_VE_02'];
  let minWeight = DEFAULT_MIN_WEIGHT;

  for (const arg of argv) {
    if (arg === '--skip-roads') skipRoads = true;
    else if (arg === '--rebuild-roads') rebuildRoads = true;
    else if (arg.startsWith('--states=')) {
      targetStates = arg
        .slice('--states='.length)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    } else if (arg.startsWith('--min-weight=')) {
      const parsed = Number(arg.slice('--min-weight='.length));
      if (Number.isFinite(parsed) && parsed > 0) minWeight = parsed;
    }
  }

  return { skipRoads, rebuildRoads, targetStates, minWeight };
}

export async function runBuildPipeline(options = {}) {
  ensurePublicMapDir();
  const {
    skipRoads = false,
    rebuildRoads = false,
    targetStates = ['REG_VE_02'],
    minWeight = DEFAULT_MIN_WEIGHT,
  } = options;

  const {
    regionsGeoJson,
    municipalExports,
    bordersMeshGeoJson,
    verification,
  } = await buildTheatreTopology({ minWeight, targetStates });

  const regionsPath = path.join(PUBLIC_MAP_DIR, 'theatre_regions.json');
  fs.writeFileSync(regionsPath, JSON.stringify(regionsGeoJson), 'utf-8');
  console.log(
    `✓ Regiones guardadas en ${regionsPath} (${(fs.statSync(regionsPath).size / 1024).toFixed(1)} KB, ${regionsGeoJson.features.length} features)`
  );

  for (const [, exp] of municipalExports) {
    const munPath = path.join(PUBLIC_MAP_DIR, exp.fileName);
    fs.writeFileSync(munPath, JSON.stringify(exp.featureCollection), 'utf-8');
    console.log(
      `✓ Municipios guardados en ${munPath} (${(fs.statSync(munPath).size / 1024).toFixed(1)} KB, ${exp.featureCollection.features.length} features)`
    );
  }

  const meshPath = path.join(PUBLIC_MAP_DIR, 'theatre_borders_mesh.json');
  fs.writeFileSync(meshPath, JSON.stringify(bordersMeshGeoJson), 'utf-8');
  console.log(
    `✓ Malla de fronteras guardada en ${meshPath} (${(fs.statSync(meshPath).size / 1024).toFixed(1)} KB, ${bordersMeshGeoJson.features.length} features)`
  );

  console.log('✓ Verificación topológica:', JSON.stringify(verification));

  const roadsPath = path.join(PUBLIC_MAP_DIR, 'theatre_roads.json');
  if (skipRoads) {
    console.log('• Red vial omitida por bandera --skip-roads.');
  } else if (fs.existsSync(roadsPath) && !rebuildRoads) {
    console.log(
      `• Red vial existente preservada en ${roadsPath} (usa --rebuild-roads para consultar Overpass).`
    );
  } else {
    await buildRoads();
  }

  console.log('¡Pipeline topológico de cartografía vectorial completado con éxito!');
  return { verification };
}

const isMainModule =
  Boolean(process.argv[1]) && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isMainModule) {
  const cliOptions = parseCliArgs();
  runBuildPipeline(cliOptions).catch((err) => {
    console.error('Error fatal:', err);
    process.exit(1);
  });
}
