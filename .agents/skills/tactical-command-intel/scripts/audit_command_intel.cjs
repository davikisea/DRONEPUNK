#!/usr/bin/env node
/**
 * C4ISR UI, Audio Catalog, Haptics & Bark Engine Auditor for DRONEPUNK.
 * Non-regressive by default (exit 0 at baseline); pass --strict for 0 debt.
 */
const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const STRICT = process.argv.includes('--strict');
const JSON_OUT = process.argv.includes('--json');

const BASELINE = {
  brokenPlayCueKeys: 14,       // current calls to defeat_sting, victory_fanfare, tactical_confirm_click, action_confirmed
  rawAudioContexts: 2,         // GeotacticsLoadingScreen.tsx:33,57
  singleSubjectLocked: 1,      // barkEngine.ts singleSubjectLock = true
  duplicateGhostBars: 1,       // world/components/TacticalGhostBar.tsx
  roundedLgInUi: 10,           // current rounded-lg hits in UI components
};

function walk(dir, exts) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p, exts));
    else if (exts.some((ext) => e.name.endsWith(ext))) out.push(p);
  }
  return out;
}

const audioSrc = fs.readFileSync(path.join(ROOT, 'src/domains/game-feel/core/audioManager.ts'), 'utf8');
const catalogBlock = audioSrc.match(/AUDIO_SYNTHESIS_CATALOG[\s\S]*?=\s*\{([\s\S]*?)\};/);
const validCueKeys = new Set();
if (catalogBlock) {
  for (const m of catalogBlock[1].matchAll(/^\s*([a-z0-9_]+)\s*:/gm)) {
    validCueKeys.add(m[1]);
  }
}

const barkSrc = fs.readFileSync(path.join(ROOT, 'src/domains/game-feel/core/barkEngine.ts'), 'utf8');
const singleSubjectLocked = /singleSubjectLock\s*(?::\s*boolean)?\s*=\s*true/.test(barkSrc) ? 1 : 0;

const srcFiles = walk(path.join(ROOT, 'src'), ['.ts', '.tsx']);
const brokenCueCalls = [];
const rawAudioContexts = [];
const duplicateGhostBars = [];
const roundedLgHits = [];

for (const file of srcFiles) {
  const rel = path.relative(ROOT, file).replace(/\\/g, '/');
  if (rel.includes('/__tests__/')) continue;
  const text = fs.readFileSync(file, 'utf8');
  const lines = text.split(/\r?\n/);

  if (path.basename(file) === 'TacticalGhostBar.tsx' && rel !== 'src/shared/ui/TacticalGhostBar.tsx') {
    duplicateGhostBars.push(rel);
  }

  lines.forEach((line, idx) => {
    for (const m of line.matchAll(/playCue\(\s*['"]([^'"]+)['"]\s*\)/g)) {
      if (!validCueKeys.has(m[1])) brokenCueCalls.push(`${rel}:${idx + 1} (${m[1]})`);
    }
    if (!rel.endsWith('audioManager.ts') && /new\s+(?:\(window\.)?(?:AudioContext|webkitAudioContext)/.test(line)) {
      rawAudioContexts.push(`${rel}:${idx + 1}`);
    }
    if ((rel.includes('/components/') || rel.startsWith('src/shared/ui/')) && /\brounded-lg\b/.test(line)) {
      roundedLgHits.push(`${rel}:${idx + 1}`);
    }
  });
}

const regressions = [];
if (brokenCueCalls.length > BASELINE.brokenPlayCueKeys) regressions.push(`brokenCueCalls grew: ${brokenCueCalls.length}`);
if (rawAudioContexts.length > BASELINE.rawAudioContexts) regressions.push(`rawAudioContexts grew: ${rawAudioContexts.length}`);
if (singleSubjectLocked > BASELINE.singleSubjectLocked) regressions.push('singleSubjectLocked regression');
if (duplicateGhostBars.length > BASELINE.duplicateGhostBars) regressions.push('duplicateGhostBars grew');
if (roundedLgHits.length > BASELINE.roundedLgInUi) regressions.push(`roundedLgHits grew: ${roundedLgHits.length}`);

const strictFailures = [];
if (STRICT) {
  if (brokenCueCalls.length > 0) strictFailures.push(`brokenCueCalls=${brokenCueCalls.length}`);
  if (rawAudioContexts.length > 0) strictFailures.push(`rawAudioContexts=${rawAudioContexts.length}`);
  if (singleSubjectLocked) strictFailures.push('singleSubjectLock=true in barkEngine.ts');
  if (duplicateGhostBars.length > 0) strictFailures.push(`duplicateGhostBars=${duplicateGhostBars.length}`);
  if (roundedLgHits.length > 0) strictFailures.push(`roundedLgHits=${roundedLgHits.length}`);
}

const ok = STRICT ? strictFailures.length === 0 : regressions.length === 0;
const report = {
  ok,
  mode: STRICT ? 'strict' : 'non-regressive',
  validCueKeysCount: validCueKeys.size,
  counts: {
    brokenCueCalls: brokenCueCalls.length,
    rawAudioContexts: rawAudioContexts.length,
    singleSubjectLocked,
    duplicateGhostBars: duplicateGhostBars.length,
    roundedLgHits: roundedLgHits.length,
  },
  brokenCueCalls,
  rawAudioContexts,
  duplicateGhostBars,
  regressions,
  strictFailures,
};

if (JSON_OUT) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`[CommandIntelAudit] mode=${report.mode} ok=${ok}`);
  console.log(`  validCueKeys=${validCueKeys.size} | brokenPlayCue=${brokenCueCalls.length} | rawAudioCtx=${rawAudioContexts.length} | singleSubjectLock=${singleSubjectLocked} | dupGhostBar=${duplicateGhostBars.length} | rounded-lg=${roundedLgHits.length}`);
  if (regressions.length) console.error('  REGRESSIONS:', regressions.join('; '));
  if (strictFailures.length) console.error('  STRICT FAILURES:', strictFailures.join('; '));
}

process.exit(ok ? 0 : 1);
