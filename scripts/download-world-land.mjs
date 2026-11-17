import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import { buildTheatreTopology, cleanGeometry } from './build-theatre-vector-data.mjs';

const NE_50M_COUNTRIES_URL =
  'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_countries.geojson';
const NE_110M_COUNTRIES_URL =
  'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_0_countries.geojson';

const TARGET_50M_CODES = new Set([
  'COL', 'BRA', 'GUY', 'SUR', 'GUF', 'TTO', 'CUW', 'ABW', 'BRB', 'GRD',
  'VCT', 'LCA', 'DMA', 'ATG', 'KNA', 'PRI', 'DOM', 'HTI', 'JAM', 'CUB',
  'PAN', 'CRI', 'NIC', 'HND', 'SLV', 'GTM', 'BLZ', 'MEX', 'USA', 'PER',
  'ECU', 'BOL',
]);

function isVenezuela(props = {}) {
  return (
    props.ADM0_A3 === 'VEN' ||
    props.ISO_A3 === 'VEN' ||
    props.ISO_A3_EH === 'VEN' ||
    props.SOV_A3 === 'VEN'
  );
}

function getFeatureCodes(props = {}) {
  return [props.ADM0_A3, props.ISO_A3, props.ISO_A3_EH].filter(Boolean);
}

function polyMinX(polyCoords) {
  let minX = Infinity;
  for (const pt of polyCoords[0] || []) {
    if (pt[0] < minX) minX = pt[0];
  }
  return minX;
}

function filterPolygonsByMinX(geom, predicate) {
  if (!geom) return null;
  const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
  const kept = polys.filter((poly) => predicate(polyMinX(poly)));
  if (kept.length === 0) return null;
  return kept.length === 1
    ? { type: 'Polygon', coordinates: kept[0] }
    : { type: 'MultiPolygon', coordinates: kept };
}

async function fetchJson(url, label) {
  console.log(`Descargando ${label}...`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Error al descargar ${label}: HTTP ${res.status}`);
  return res.json();
}

export async function buildWorldLand() {
  const [ne50, ne110, theatre] = await Promise.all([
    fetchJson(NE_50M_COUNTRIES_URL, 'Natural Earth 50m Admin-0 Countries'),
    fetchJson(NE_110M_COUNTRIES_URL, 'Natural Earth 110m Admin-0 Countries'),
    buildTheatreTopology({ targetStates: ['REG_VE_02'] }),
  ]);

  const features = [];
  const included50Codes = new Set();

  for (const feat of ne50.features || []) {
    const props = feat.properties || {};
    if (isVenezuela(props)) continue;

    const codes = getFeatureCodes(props);
    const matchedCode = codes.find((c) => TARGET_50M_CODES.has(c));

    if (matchedCode) {
      const cleaned = cleanGeometry(feat.geometry, 4);
      if (!cleaned) continue;
      included50Codes.add(props.ADM0_A3 || matchedCode);
      features.push({
        type: 'Feature',
        id: props.ADM0_A3 || matchedCode,
        properties: {
          featurecla: 'Admin-0 country',
          name: props.NAME || props.ADMIN || matchedCode,
          adm0_a3: props.ADM0_A3 || matchedCode,
          source: 'ne_50m',
        },
        geometry: cleaned,
      });
      continue;
    }

    // Natural Earth incluye Guayana Francesa (GUF) y Antillas Francesas dentro de FRA
    if (props.ADM0_A3 === 'FRA' && TARGET_50M_CODES.has('GUF')) {
      const americasFra = cleanGeometry(
        filterPolygonsByMinX(feat.geometry, (minX) => minX < -30),
        4
      );
      if (americasFra) {
        features.push({
          type: 'Feature',
          id: 'GUF',
          properties: {
            featurecla: 'Admin-0 country',
            name: 'French Guiana',
            adm0_a3: 'GUF',
            source: 'ne_50m_fra_americas',
          },
          geometry: americasFra,
        });
      }
    }

    // Natural Earth incluye Bonaire / Saba / Sint Eustatius dentro de NLD
    if (props.ADM0_A3 === 'NLD') {
      const caribbeanNld = cleanGeometry(
        filterPolygonsByMinX(feat.geometry, (minX) => minX < -30),
        4
      );
      if (caribbeanNld) {
        features.push({
          type: 'Feature',
          id: 'BES',
          properties: {
            featurecla: 'Admin-0 country',
            name: 'Caribbean Netherlands',
            adm0_a3: 'BES',
            source: 'ne_50m_nld_caribbean',
          },
          geometry: caribbeanNld,
        });
      }
    }
  }

  for (const feat of ne110.features || []) {
    const props = feat.properties || {};
    if (isVenezuela(props)) continue;

    const codes = getFeatureCodes(props);
    if (codes.some((c) => TARGET_50M_CODES.has(c) || included50Codes.has(c))) continue;

    let rawGeom = feat.geometry;
    // Evitar duplicar Guayana Francesa en FRA 110m (ya extraída en 50m)
    if (props.ADM0_A3 === 'FRA' && TARGET_50M_CODES.has('GUF')) {
      rawGeom = filterPolygonsByMinX(rawGeom, (minX) => minX >= -30);
    }

    const cleaned = cleanGeometry(rawGeom, 4);
    if (!cleaned) continue;

    features.push({
      type: 'Feature',
      id: props.ADM0_A3 || props.ISO_A3 || props.NAME,
      properties: {
        featurecla: 'Admin-0 country',
        name: props.NAME || props.ADMIN || 'Land',
        adm0_a3: props.ADM0_A3 || props.ISO_A3 || '',
        source: 'ne_110m',
      },
      geometry: cleaned,
    });
  }

  // Insertar la masa disuelta EXACTA de Venezuela desde la misma topología TopoJSON
  const venFeature = {
    type: 'Feature',
    id: 'VEN',
    properties: {
      featurecla: 'Admin-0 country',
      name: 'Venezuela',
      adm0_a3: 'VEN',
      source: 'geoboundaries_adm2_topojson',
    },
    geometry: theatre.venezuelaLandGeometry,
  };
  features.push(venFeature);

  // Verificación bit-a-bit de que no queda Venezuela de Natural Earth y la insertada coincide exactamente
  const venCount = features.filter((f) => f.properties.adm0_a3 === 'VEN').length;
  if (venCount !== 1) {
    throw new Error(`Se esperaba exactamente 1 feature VEN en world_land.json, encontrados: ${venCount}`);
  }

  const outPath = path.resolve('public/map/world_land.json');
  const outGeoJson = { type: 'FeatureCollection', features };
  fs.writeFileSync(outPath, JSON.stringify(outGeoJson), 'utf-8');

  console.log(
    `✓ world_land.json guardado en ${outPath} (${(fs.statSync(outPath).size / 1024).toFixed(1)} KB, ${features.length} países/territorios, VEN bit-a-bit idéntico a theatre_regions.json)`
  );
  return { outPath, featureCount: features.length, verification: theatre.verification };
}

const isMainModule =
  Boolean(process.argv[1]) && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isMainModule) {
  buildWorldLand().catch((err) => {
    console.error('Error fatal en download-world-land:', err);
    process.exit(1);
  });
}
