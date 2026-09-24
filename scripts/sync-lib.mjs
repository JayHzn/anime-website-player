// Mirror extension/lib → mobile/lib.
//
// The extractor library is platform-agnostic on purpose (see extension/lib/http.js:
// the one platform difference, setting Referer, is branched inside the lib itself).
// But a Chrome extension can only load files packaged under extension/, and Metro
// only bundles what's under mobile/ — so the same files have to exist in both trees.
// extension/lib is the canonical copy; run `npm run sync:lib` after touching it.
//
// Usage: node scripts/sync-lib.mjs [--check]

import { readdirSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SRC = join(ROOT, 'extension', 'lib');
const DEST = join(ROOT, 'mobile', 'lib');

const CHECK_ONLY = process.argv.includes('--check');

const HEADER = `// AUTO-GENERATED — do not edit. Mirrored from extension/lib by scripts/sync-lib.mjs.\n`;

function walk(dir, base = '') {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const abs = join(dir, entry);
    const rel = base ? `${base}/${entry}` : entry;
    if (statSync(abs).isDirectory()) out.push(...walk(abs, rel));
    else if (entry.endsWith('.js')) out.push(rel);
  }
  return out;
}

if (!existsSync(SRC)) {
  console.error(`[sync-lib] missing source directory: ${relative(ROOT, SRC)}`);
  process.exit(1);
}

const files = walk(SRC);
const stale = [];

for (const rel of files) {
  const content = HEADER + readFileSync(join(SRC, rel), 'utf8');
  const target = join(DEST, rel);

  if (CHECK_ONLY) {
    if (!existsSync(target) || readFileSync(target, 'utf8') !== content) stale.push(rel);
    continue;
  }

  mkdirSync(join(target, '..'), { recursive: true });
  writeFileSync(target, content);
}

// Drop files that no longer exist upstream, so a deleted extractor doesn't linger.
if (!CHECK_ONLY && existsSync(DEST)) {
  for (const rel of walk(DEST)) {
    if (!files.includes(rel)) rmSync(join(DEST, rel));
  }
}

if (CHECK_ONLY) {
  if (stale.length > 0) {
    console.error(`[sync-lib] mobile/lib is out of date:\n  ${stale.join('\n  ')}\nRun: npm run sync:lib`);
    process.exit(1);
  }
  console.log(`[sync-lib] mobile/lib is up to date (${files.length} files)`);
} else {
  console.log(`[sync-lib] mirrored ${files.length} files → ${relative(ROOT, DEST)}`);
}
