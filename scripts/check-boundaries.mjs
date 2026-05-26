#!/usr/bin/env node
// Boundary checks for the Lite package split.
//
// Enforces the dependency rules pinned in `.cursor/rules/project-boundaries.mdc`
// and `.memory/architecture-decisions.md`:
//
//   - `@slidestage/spec` is the .stage (`slidestage@1.0`) format SoT. It may
//     depend only on `zod`. No React, no DOM, no host adapters, no other
//     workspace packages — it sits below core in the dependency graph.
//   - `@slidestage/core` must stay headless: no react, no react-dom, no DOM-UI
//     bundles, no host adapters (lucide, tauri), no other workspace packages
//     other than `@slidestage/spec`, no Pro shims, no relative paths into
//     another package's src/.
//   - `@slidestage/ui` may depend on `@slidestage/core` and React; it must
//     NOT consume `@slidestage/lite-preset` (preset-agnostic) or anything Pro.
//   - `@slidestage/lite-preset` may consume core + ui; it must NOT depend on
//     any Pro surface.
//   - No package may use `file:../SlideStageLite` / `link:../SlideStageLite`
//     dependencies — Pro must consume Lite through real semver releases.
//
// The script reads each TS/TSX file's `import ... from '...'` literals + all
// dynamic `import('...')` literals and matches them against the rules per
// package. Self-imports (anything starting with `@slidestage/<this package>`)
// are tolerated so a package can re-export from its own subpaths.

import { readFile, readdir, stat } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

const sourcePatterns = /\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;

// Match every import specifier in either a static `from '...'` clause or a
// dynamic `import('...')` call. The patterns intentionally stay simple — they
// run against TS source files and only need the specifier itself.
const importPatterns = [
  /\bfrom\s+['"]([^'"]+)['"]/g,
  /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  /\bexport\s+(?:\*|\{[^}]*\})\s+from\s+['"]([^'"]+)['"]/g,
  // Bare side-effect imports: `import 'name';` or `import "name";`. We don't
  // pin the right edge of the line so trailing inline comments still match.
  /(?:^|\n)\s*import\s+['"]([^'"]+)['"]\s*;?/g,
  // Side-effect dynamic require fallback (rarely used in TS but still
  // worth catching if someone slips it into a `require('react')`).
  /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
];

/** @type {Record<string, { dir: string, forbidden: { match: RegExp, why: string }[] }>} */
const packageRules = {
  '@slidestage/spec': {
    dir: 'packages/spec/src',
    forbidden: [
      { match: /^react(\/|$)/, why: 'spec must stay platform-agnostic: no react' },
      { match: /^react-dom(\/|$)/, why: 'spec must stay platform-agnostic: no react-dom' },
      { match: /^lucide-react(\/|$)/, why: 'spec must stay platform-agnostic: no lucide-react' },
      { match: /^fflate(\/|$)/, why: 'spec describes the .stage format only; zip parsing belongs in core' },
      { match: /^@slidestage\/core(\/|$)/, why: 'spec sits below core; circular dependency' },
      { match: /^@slidestage\/ui(\/|$)/, why: 'spec may not depend on @slidestage/ui' },
      {
        match: /^@slidestage\/lite-preset(\/|$)/,
        why: 'spec may not depend on @slidestage/lite-preset',
      },
      { match: /^@tauri-apps\//, why: 'spec may not depend on Tauri APIs' },
      { match: /^@slidestage\/pro/, why: 'spec may not import any Pro surface' },
      { match: /(^|\/)SlideStagePro(\/|$)/, why: 'spec may not reach into the Pro repo' },
    ],
  },
  '@slidestage/core': {
    dir: 'packages/core/src',
    forbidden: [
      { match: /^react(\/|$)/, why: 'core must stay headless: no react' },
      { match: /^react-dom(\/|$)/, why: 'core must stay headless: no react-dom' },
      { match: /^lucide-react(\/|$)/, why: 'core must stay headless: no lucide-react' },
      { match: /^@slidestage\/ui(\/|$)/, why: 'core may not depend on @slidestage/ui' },
      {
        match: /^@slidestage\/lite-preset(\/|$)/,
        why: 'core may not depend on @slidestage/lite-preset',
      },
      { match: /^@tauri-apps\//, why: 'core may not depend on Tauri APIs' },
      { match: /^@slidestage\/pro/, why: 'core may not import any Pro surface' },
      { match: /(^|\/)SlideStagePro(\/|$)/, why: 'core may not reach into the Pro repo' },
    ],
  },
  '@slidestage/ui': {
    dir: 'packages/ui/src',
    forbidden: [
      {
        match: /^@slidestage\/lite-preset(\/|$)/,
        why: 'ui may not depend on @slidestage/lite-preset (preset-agnostic)',
      },
      { match: /^@slidestage\/pro/, why: 'ui may not import any Pro surface' },
      { match: /(^|\/)SlideStagePro(\/|$)/, why: 'ui may not reach into the Pro repo' },
    ],
  },
  '@slidestage/lite-preset': {
    dir: 'packages/lite-preset/src',
    forbidden: [
      { match: /^@slidestage\/pro/, why: 'lite-preset may not import any Pro surface' },
      {
        match: /(^|\/)SlideStagePro(\/|$)/,
        why: 'lite-preset may not reach into the Pro repo',
      },
    ],
  },
};

/** @returns {Promise<string[]>} */
async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await walk(full)));
    } else if (entry.isFile() && sourcePatterns.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

function extractSpecifiers(source) {
  const specs = new Set();
  for (const re of importPatterns) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(source))) {
      specs.add(m[1]);
    }
  }
  return [...specs];
}

function isRelativeOutOfPackage(specifier, fileAbs, packageDirAbs) {
  if (!specifier.startsWith('.')) return false;
  const dir = join(fileAbs, '..');
  const resolved = join(dir, specifier);
  const rel = relative(packageDirAbs, resolved);
  return rel.startsWith('..') || rel === '';
}

/**
 * @returns {Promise<Array<{ file: string, specifier: string, reason: string }>>}
 */
async function checkPackage(pkgName, rule) {
  const violations = [];
  const pkgDir = join(repoRoot, rule.dir);
  const files = await walk(pkgDir);
  for (const file of files) {
    const source = await readFile(file, 'utf-8');
    const specs = extractSpecifiers(source);
    for (const spec of specs) {
      // Tolerate self-imports — a package can reference its own subpaths.
      if (spec.startsWith(`${pkgName}/`) || spec === pkgName) continue;
      if (isRelativeOutOfPackage(spec, file, pkgDir)) {
        violations.push({
          file: relative(repoRoot, file),
          specifier: spec,
          reason: 'relative import escapes package directory',
        });
        continue;
      }
      for (const forbidden of rule.forbidden) {
        if (forbidden.match.test(spec)) {
          violations.push({
            file: relative(repoRoot, file),
            specifier: spec,
            reason: forbidden.why,
          });
        }
      }
    }
  }
  return violations;
}

async function checkManifests() {
  const manifestPaths = [
    'package.json',
    'packages/spec/package.json',
    'packages/core/package.json',
    'packages/ui/package.json',
    'packages/lite-preset/package.json',
  ];
  const violations = [];
  for (const rel of manifestPaths) {
    const abs = join(repoRoot, rel);
    let json;
    try {
      json = JSON.parse(await readFile(abs, 'utf-8'));
    } catch (err) {
      if (err && err.code === 'ENOENT') continue;
      throw err;
    }
    const buckets = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];
    for (const bucket of buckets) {
      const entries = json[bucket] ?? {};
      for (const [name, version] of Object.entries(entries)) {
        if (typeof version !== 'string') continue;
        // Hard-block any Pro path-based dependency. Pro must depend on
        // semver-published Lite packages, not on the Lite source tree.
        if (/SlideStageLite/.test(version) && /^(file|link):/.test(version)) {
          violations.push({
            file: rel,
            specifier: `${name}@${version}`,
            reason: 'file:/link: dependency back into SlideStageLite is forbidden',
          });
        }
      }
    }
  }
  return violations;
}

async function main() {
  let total = 0;
  for (const [pkgName, rule] of Object.entries(packageRules)) {
    const stats = await stat(join(repoRoot, rule.dir)).catch(() => null);
    if (!stats?.isDirectory()) {
      process.stderr.write(`[boundaries] skipping ${pkgName}: ${rule.dir} not found\n`);
      continue;
    }
    const violations = await checkPackage(pkgName, rule);
    if (violations.length === 0) {
      process.stdout.write(`[boundaries] ${pkgName} OK\n`);
      continue;
    }
    total += violations.length;
    process.stderr.write(`[boundaries] ${pkgName} has ${violations.length} violation(s):\n`);
    for (const v of violations) {
      process.stderr.write(`  - ${v.file}${sep}\n    import "${v.specifier}"\n    -> ${v.reason}\n`);
    }
  }
  const manifestViolations = await checkManifests();
  if (manifestViolations.length === 0) {
    process.stdout.write('[boundaries] manifests OK\n');
  } else {
    total += manifestViolations.length;
    process.stderr.write(`[boundaries] manifests have ${manifestViolations.length} violation(s):\n`);
    for (const v of manifestViolations) {
      process.stderr.write(`  - ${v.file}\n    "${v.specifier}"\n    -> ${v.reason}\n`);
    }
  }
  if (total > 0) {
    process.stderr.write(`[boundaries] FAIL: ${total} violation(s)\n`);
    process.exit(1);
  }
  process.stdout.write('[boundaries] all checks passed\n');
}

await main();
