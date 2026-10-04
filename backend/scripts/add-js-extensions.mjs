/**
 * One-off migration helper (kept in the repo so the transformation is auditable):
 * adds the explicit `.js` extension to every relative import/export specifier in
 * the backend source.
 *
 * Why this is needed: NestJS 12 ships ESM-only packages, so this project is
 * `"type": "module"` with `moduleResolution: nodenext`, and Node's ESM resolver
 * requires the *emitted* file name — `./auth.module.js`, not `./auth.module`.
 * TypeScript resolves that back to `auth.module.ts` while compiling.
 *
 * Idempotent: specifiers that already end in `.js`, `.json` or `.css` are left
 * alone, so re-running it is a no-op.
 *
 * Usage: node scripts/add-js-extensions.mjs
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const backendRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Directories to rewrite, relative to the backend root. */
const TARGET_DIRS = ['src', 'test', 'prisma'];

/** Never touch generated code — `prisma generate` owns those files. */
const SKIP_DIRS = new Set(['generated', 'node_modules']);

/** `from '...'`, `import('...')`, `export ... from '...'`. */
const SPECIFIER_PATTERN =
  /(from\s*['"]|import\s*\(\s*['"])(\.{1,2}\/[^'"]+)(['"])/g;

const HAS_EXTENSION = /\.(js|mjs|cjs|json|css)$/;

function collectFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    const stats = statSync(full);
    if (stats.isDirectory()) out.push(...collectFiles(full));
    else if (full.endsWith('.ts')) out.push(full);
  }
  return out;
}

let filesChanged = 0;
let specifiersChanged = 0;

for (const target of TARGET_DIRS) {
  const dir = join(backendRoot, target);
  let files;
  try {
    files = collectFiles(dir);
  } catch {
    continue;
  }

  for (const file of files) {
    const original = readFileSync(file, 'utf8');
    const updated = original.replace(
      SPECIFIER_PATTERN,
      (match, prefix, specifier, suffix) => {
        if (HAS_EXTENSION.test(specifier)) return match;
        specifiersChanged += 1;
        return `${prefix}${specifier}.js${suffix}`;
      },
    );

    if (updated !== original) {
      writeFileSync(file, updated);
      filesChanged += 1;
      console.log(`updated ${file.replace(`${backendRoot}/`, '')}`);
    }
  }
}

console.log(`\n${filesChanged} file(s), ${specifiersChanged} import(s) updated.`);
