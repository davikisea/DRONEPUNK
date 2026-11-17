#!/usr/bin/env node
/**
 * WebGL Zero-Raster & Anti-Pattern Auditor for @domains/world.
 * Non-regressive by default (exit 0 at baseline); pass --strict for 0 anti-patterns.
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const STRICT = process.argv.includes('--strict');
const JSON_OUT = process.argv.includes('--json');

const BASELINE = {
  hoverSetData: 1,
  missingFeatureState: 1,
  blurOnWebgl: 1,
  missingContextLostListener: 1,
  unguardedRtsInterval: 1,
};

const mapPath = path.join(ROOT, 'src/domains/world/components/TacticalWorldMap.tsx');
const cssPath = path.join(ROOT, 'src/index.css');
const appPath = path.join(ROOT, 'src/App.tsx');

const mapSrc = fs.existsSync(mapPath) ? fs.readFileSync(mapPath, 'utf8') : '';
const cssSrc = fs.existsSync(cssPath) ? fs.readFileSync(cssPath, 'utf8') : '';
const appSrc = fs.existsSync(appPath) ? fs.readFileSync(appPath, 'utf8') : '';

// 1. Check 7 GeoJSON assets in public/map/
const expectedGeo = [
  'world_land.json',
  'theatre_regions.json',
  'theatre_borders_mesh.json',
  'theatre_roads.json',
  'theatre_urban_roads.json',
  'theatre_cities.json',
  'zulia_municipalities.json',
];
const mapDir = path.join(ROOT, 'public/map');
let totalMapBytes = 0;
const missingGeo = [];
for (const f of expectedGeo) {
  const fp = path.join(mapDir, f);
  if (!fs.existsSync(fp)) missingGeo.push(f);
  else totalMapBytes += fs.statSync(fp).size;
}
const workerExists = fs.existsSync(path.join(ROOT, 'public/maplibre-gl-worker.mjs'));
const sizeOk = totalMapBytes <= 2 * 1024 * 1024;

// 2. Anti-pattern checks
const hoverSetData = (mapSrc.includes('syncHoverGrid') && mapSrc.includes('hoverSrc.setData')) ? 1 : 0;
const missingFeatureState = mapSrc.includes('setFeatureState') ? 0 : 1;
const blurOnWebgl = (mapSrc.includes('tactical-stratum-blur') && /blur\(/i.test(cssSrc)) ? 1 : 0;
const missingContextLostListener = mapSrc.includes('webglcontextlost') ? 0 : 1;
const unguardedRtsInterval = (mapSrc.includes('syncRtsUnitsToMap') && !mapSrc.includes('isHidden')) ? 1 : 0;

// 3. Zero-Unmount check in App.tsx
const zeroUnmountOk = appSrc.includes('<WarLobbyHub') && !/mainNav\s*!==\s*['"]combat['"]\s*&&\s*<WarLobbyHub/.test(appSrc);

const regressions = [];
if (missingGeo.length > 0) regressions.push(`missingGeo: ${missingGeo.join(',')}`);
if (!workerExists) regressions.push('missing public/maplibre-gl-worker.mjs');
if (!sizeOk) regressions.push(`public/map exceeded 2MB: ${totalMapBytes}`);
if (!zeroUnmountOk) regressions.push('WarLobbyHub conditional unmount detected in App.tsx');
if (hoverSetData > BASELINE.hoverSetData) regressions.push('hoverSetData regression');
if (blurOnWebgl > BASELINE.blurOnWebgl) regressions.push('blurOnWebgl regression');

const strictFailures = [];
if (STRICT) {
  if (hoverSetData) strictFailures.push('hoverSetData active (use setFeatureState)');
  if (missingFeatureState) strictFailures.push('0 calls to map.setFeatureState');
  if (blurOnWebgl) strictFailures.push('tactical-stratum-blur applied to WebGL container');
  if (missingContextLostListener) strictFailures.push('missing webglcontextlost/webglcontextrestored listeners');
  if (unguardedRtsInterval) strictFailures.push('RTS setInterval lacks hidden/combat pause guard');
}

const ok = STRICT
  ? regressions.length === 0 && strictFailures.length === 0
  : regressions.length === 0;

const report = {
  ok,
  mode: STRICT ? 'strict' : 'non-regressive',
  assets: { geoCount: expectedGeo.length - missingGeo.length, totalMapKB: Math.round(totalMapBytes / 1024), workerExists },
  zeroUnmountOk,
  antiPatterns: { hoverSetData, missingFeatureState, blurOnWebgl, missingContextLostListener, unguardedRtsInterval },
  regressions,
  strictFailures,
};

if (JSON_OUT) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`[WebGLAudit] mode=${report.mode} ok=${ok}`);
  console.log(`  assets: ${report.assets.geoCount}/7 GeoJSON (${report.assets.totalMapKB} KB), worker=${workerExists}, zeroUnmount=${zeroUnmountOk}`);
  console.log(`  debt: hoverSetData=${hoverSetData} noFeatureState=${missingFeatureState} blur=${blurOnWebgl} noContextLost=${missingContextLostListener} rtsInterval=${unguardedRtsInterval}`);
  if (regressions.length) console.error('  REGRESSIONS:', regressions.join('; '));
  if (strictFailures.length) console.error('  STRICT FAILURES:', strictFailures.join('; '));
}

process.exit(ok ? 0 : 1);
