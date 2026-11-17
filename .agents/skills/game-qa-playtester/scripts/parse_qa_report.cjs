#!/usr/bin/env node
/**
 * Playwright QA Report & Telemetry Classifier for DRONEPUNK.
 * Parses test-results/qa-run-latest.json (and qa-run-report.json if present).
 * Exit 0 if PASS_CLEAN (or if no report exists yet when --allow-missing is passed); exit 1 on failures.
 */
const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const ALLOW_MISSING = process.argv.includes('--allow-missing');
const JSON_OUT = process.argv.includes('--json');

const latestPath = path.join(ROOT, 'test-results/qa-run-latest.json');
const playwrightReportPath = path.join(ROOT, 'test-results/qa-run-report.json');

if (!fs.existsSync(latestPath) && !fs.existsSync(playwrightReportPath)) {
  const msg = { ok: ALLOW_MISSING, status: 'NO_REPORT_FOUND', hint: 'Run npm run test:qa first' };
  console.log(JSON_OUT ? JSON.stringify(msg, null, 2) : `[QAReportParser] ${msg.status} (${msg.hint})`);
  process.exit(ALLOW_MISSING ? 0 : 1);
}

const latest = fs.existsSync(latestPath) ? JSON.parse(fs.readFileSync(latestPath, 'utf8')) : null;
const categories = [];

if (latest) {
  const fatalErrors = latest.fatalErrors || [];
  const networkFailures = latest.networkFailures || [];
  const snap = latest.finalSnapshot || {};

  for (const err of fatalErrors) {
    const s = String(err);
    if (/DEFCON-1|SyntaxError|does not provide an export/i.test(s)) categories.push({ type: 'DEFCON-1', detail: s });
    else if (/webgl|maplibre|isStyleLoaded/i.test(s)) categories.push({ type: 'WEBGL_ZERO_RASTER', detail: s });
    else categories.push({ type: 'FATAL_JS_ERROR', detail: s });
  }
  for (const nf of networkFailures) {
    const s = String(nf);
    if (/\/rest\/v1\/|\/rpc\//i.test(s)) categories.push({ type: 'NETWORK_MOCK_GAP', detail: s });
    else if (/\/map\//i.test(s)) categories.push({ type: 'WEBGL_ASSET_404', detail: s });
    else categories.push({ type: 'NETWORK_FAILURE', detail: s });
  }
  if (snap.canvasRendered === false) {
    categories.push({ type: 'WEBGL_ZERO_RASTER', detail: 'finalSnapshot.canvasRendered === false' });
  }
}

if (fs.existsSync(playwrightReportPath)) {
  const pw = JSON.parse(fs.readFileSync(playwrightReportPath, 'utf8'));
  const collectSpecs = (suite) => {
    for (const sp of suite.specs || []) {
      for (const t of sp.tests || []) {
        for (const r of t.results || []) {
          if (r.status === 'failed' || r.status === 'timedOut') {
            const msg = r.error?.message || r.status;
            if (/strict mode violation/i.test(msg)) categories.push({ type: 'STRICT_SELECTOR', detail: `${sp.title}: ${msg.slice(0, 140)}` });
            else if (/intercepts pointer events/i.test(msg)) categories.push({ type: 'POINTER_INTERCEPT', detail: `${sp.title}: ${msg.slice(0, 140)}` });
            else if (/activeScreen.*game/i.test(msg)) categories.push({ type: 'LAYER2_TRANSITION', detail: `${sp.title}: ${msg.slice(0, 140)}` });
            else categories.push({ type: 'PLAYWRIGHT_FAILURE', detail: `${sp.title}: ${msg.slice(0, 140)}` });
          }
        }
      }
    }
    for (const child of suite.suites || []) collectSpecs(child);
  };
  for (const s of pw.suites || []) collectSpecs(s);
}

const ok = categories.length === 0;
const out = {
  ok,
  status: ok ? 'PASS_CLEAN' : 'FAIL',
  fatalErrorsCount: latest?.fatalErrorsCount ?? null,
  networkFailuresCount: latest?.networkFailuresCount ?? null,
  activeScreen: latest?.finalSnapshot?.activeScreen ?? null,
  categories,
};

if (JSON_OUT) {
  console.log(JSON.stringify(out, null, 2));
} else {
  console.log(`[QAReportParser] status=${out.status} issues=${categories.length} activeScreen=${out.activeScreen}`);
  categories.forEach((c) => console.log(`  - [${c.type}] ${c.detail}`));
}

process.exit(ok ? 0 : 1);
