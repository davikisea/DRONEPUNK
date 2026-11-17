#!/usr/bin/env node
/**
 * Validates @path mentions and `npm run <script>` references in a DRONEPUNK prompt file (or stdin).
 * Usage: node validatePromptMentions.cjs <prompt.md>
 */
const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const fileArg = process.argv[2];

let text = '';
if (fileArg) {
  if (!fs.existsSync(fileArg)) {
    console.error(`[PromptValidator] File not found: ${fileArg}`);
    process.exit(1);
  }
  text = fs.readFileSync(fileArg, 'utf8');
} else {
  text = fs.readFileSync(0, 'utf8');
}

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const validScripts = new Set(Object.keys(pkg.scripts || {}));

const mentionRe = /@((?:src|docs|supabase|tests|scripts|public|\.agents)\/[A-Za-z0-9_.\-\/]+)/g;
const missingPaths = [];
for (const m of text.matchAll(mentionRe)) {
  const relPath = m[1].replace(/[.,:;`)\]]+$/, '');
  if (!relPath.includes('*') && !fs.existsSync(path.join(ROOT, relPath))) {
    missingPaths.push(relPath);
  }
}

const npmRe = /\bnpm run ([a-zA-Z0-9:_-]+)/g;
const missingScripts = [];
for (const m of text.matchAll(npmRe)) {
  if (!validScripts.has(m[1])) missingScripts.push(m[1]);
}

const ok = missingPaths.length === 0 && missingScripts.length === 0;
console.log(`[PromptValidator] ok=${ok} missingPaths=${missingPaths.length} missingScripts=${missingScripts.length}`);
if (missingPaths.length) console.error('  Missing @paths:', missingPaths.join(', '));
if (missingScripts.length) console.error('  Missing npm scripts:', missingScripts.join(', '));

process.exit(ok ? 0 : 1);
