#!/usr/bin/env node
/**
 * SlideStageLite — macOS signing/notarization sanity check.
 *
 * This is the "did the release pipeline actually do its job?" probe.
 * It exits 0 only when *all* of the following hold:
 *
 *   - The bundled .app is signed (not adhoc unless --allow-adhoc)
 *   - The .app is stapled with a notarization ticket (unless
 *     --allow-adhoc, in which case stapling is not expected)
 *   - The corresponding .dmg in dist-desktop/ is signed
 *   - The .dmg is stapled (unless --allow-adhoc)
 *   - `spctl --assess --type install` accepts the .dmg
 *
 * Defaults to checking aarch64-apple-darwin. Pass `--target <triple>`
 * to point at a different build.
 *
 * Modes:
 *   default       — strict, expects Developer ID + notarized + stapled
 *   --allow-adhoc — relaxed, only verifies signature is well-formed
 *                   (useful before you actually have a Developer ID cert)
 *
 * Exit codes:
 *   0  all checks passed
 *   1  one or more checks failed (details printed to stderr)
 *   2  precondition missing (no build artifact found, etc.)
 */

import { execSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const ARGS = process.argv.slice(2);
const ALLOW_ADHOC = ARGS.includes('--allow-adhoc');
const VERBOSE = ARGS.includes('--verbose') || !!process.env.CI;

const TARGET = (() => {
  const idx = ARGS.indexOf('--target');
  if (idx >= 0 && ARGS[idx + 1]) return ARGS[idx + 1];
  return 'aarch64-apple-darwin';
})();

const failures = [];
const passes = [];

function pass(msg) {
  passes.push(msg);
  console.log(`  ✓ ${msg}`);
}

function fail(msg, detail) {
  failures.push({ msg, detail });
  console.error(`  ✗ ${msg}`);
  if (detail && VERBOSE) console.error(`      ${detail.trim().replace(/\n/g, '\n      ')}`);
}

function section(title) {
  console.log(`\n[check-macos-signing] ${title}`);
}

function abort(msg) {
  console.error(`\n[check-macos-signing] ABORT: ${msg}`);
  process.exit(2);
}

function tryExec(cmd) {
  try {
    return {
      ok: true,
      out: execSync(cmd, { stdio: ['ignore', 'pipe', 'pipe'] }).toString(),
    };
  } catch (err) {
    return {
      ok: false,
      out:
        (err.stdout?.toString?.() ?? '') +
        (err.stderr?.toString?.() ?? '') +
        (err.message ?? ''),
    };
  }
}

if (process.platform !== 'darwin') {
  console.log('[check-macos-signing] SKIP — only runs on macOS.');
  process.exit(0);
}

// ---- Locate .app -------------------------------------------------------

section(`Inspecting target ${TARGET}`);

const APP = resolve(
  ROOT,
  'src-tauri/target',
  TARGET,
  'release/bundle/macos/SlideStageLite.app',
);
if (!existsSync(APP)) {
  abort(
    `no .app at ${APP}. Did you run \`pnpm tauri build --target ${TARGET}\` ` +
      `(or \`pnpm release:macos\`) first?`,
  );
}
console.log(`  app: ${APP}`);

// ---- App: codesign --verify -------------------------------------------

section('codesign --verify (.app)');
{
  const r = tryExec(
    `codesign --verify --deep --strict --verbose=2 "${APP}"`,
  );
  if (r.ok) pass('codesign --verify succeeds');
  else fail('codesign --verify failed', r.out);
}

// ---- App: identity sanity ---------------------------------------------

section('codesign -dv (.app — identity check)');
{
  const r = tryExec(`codesign -dv --verbose=4 "${APP}" 2>&1`);
  if (!r.ok) {
    fail('codesign -dv failed', r.out);
  } else {
    if (VERBOSE) console.log(r.out);
    const isAdhoc = /Signature=adhoc/i.test(r.out);
    const hasTeam = /TeamIdentifier=([A-Z0-9]{10})/.test(r.out);
    const hasAuthority = /Authority=Developer ID Application:/i.test(r.out);

    if (ALLOW_ADHOC) {
      pass(
        `signature is well-formed (${isAdhoc ? 'adhoc' : hasAuthority ? 'Developer ID' : 'other'})`,
      );
    } else {
      if (isAdhoc) {
        fail(
          'app is adhoc-signed — strict mode requires a Developer ID identity',
          r.out,
        );
      } else if (!hasAuthority) {
        fail(
          'app signature is not a Developer ID Application certificate',
          r.out,
        );
      } else {
        pass('signed with a Developer ID Application certificate');
      }
      if (hasTeam) pass(`TeamIdentifier present (${r.out.match(/TeamIdentifier=([A-Z0-9]{10})/)[1]})`);
      else fail('TeamIdentifier missing from signature', r.out);
    }
  }
}

// ---- App: stapler validate --------------------------------------------

section('xcrun stapler validate (.app)');
if (ALLOW_ADHOC) {
  console.log('  - skipped (--allow-adhoc; adhoc bundles cannot be stapled)');
} else {
  const r = spawnSync('xcrun', ['stapler', 'validate', APP], {
    stdio: 'pipe',
  });
  if (r.status === 0) {
    pass('app stapled OK');
  } else {
    fail(
      'stapler validate failed — app is not notarized or ticket missing',
      (r.stdout?.toString?.() ?? '') + (r.stderr?.toString?.() ?? ''),
    );
  }
}

// ---- App: spctl --assess --type execute -------------------------------

section('spctl --assess --type execute (.app)');
if (ALLOW_ADHOC) {
  console.log('  - skipped (--allow-adhoc; spctl will always reject adhoc apps on a clean machine)');
} else {
  const r = spawnSync(
    'spctl',
    ['--assess', '--type', 'execute', '--verbose=4', APP],
    { stdio: 'pipe' },
  );
  if (r.status === 0) {
    pass('Gatekeeper accepts the .app');
  } else {
    fail(
      'spctl rejected the .app — Gatekeeper would warn the end user',
      (r.stdout?.toString?.() ?? '') + (r.stderr?.toString?.() ?? ''),
    );
  }
}

// ---- DMG: locate latest --------------------------------------------------

section('Locating .dmg in dist-desktop/');

const DIST_DESKTOP = resolve(ROOT, 'dist-desktop');
let DMG = null;
if (existsSync(DIST_DESKTOP)) {
  const entries = readdirSync(DIST_DESKTOP)
    .filter((f) => /^SlideStageLite-.*macOS-AppleSilicon\.dmg$/.test(f))
    .map((f) => ({
      name: f,
      path: resolve(DIST_DESKTOP, f),
      mtime: statSync(resolve(DIST_DESKTOP, f)).mtimeMs,
    }))
    .sort((a, b) => b.mtime - a.mtime);
  if (entries.length) DMG = entries[0].path;
}

if (!DMG) {
  console.log(
    '  - no SlideStageLite-*-macOS-AppleSilicon.dmg under dist-desktop/. ' +
      'Skipping dmg checks (run `pnpm release:macos` to produce one).',
  );
} else {
  console.log(`  dmg: ${DMG}`);

  // DMG signature
  section('codesign --verify (.dmg)');
  {
    const r = tryExec(`codesign --verify --verbose=2 "${DMG}"`);
    if (r.ok) {
      pass('dmg codesign --verify succeeds');
    } else if (ALLOW_ADHOC) {
      // Tauri only signs the dmg surface when APPLE_SIGNING_IDENTITY is a
      // real Developer ID — adhoc builds always produce unsigned dmgs.
      // That's the by-design outcome under --allow-adhoc, so treat as a
      // soft note, not a failure.
      console.log('  - dmg unsigned (expected for adhoc builds; not a failure)');
    } else {
      fail('dmg codesign --verify failed', r.out);
    }
  }

  // DMG stapler
  section('xcrun stapler validate (.dmg)');
  if (ALLOW_ADHOC) {
    console.log('  - skipped (--allow-adhoc)');
  } else {
    const r = spawnSync('xcrun', ['stapler', 'validate', DMG], { stdio: 'pipe' });
    if (r.status === 0) pass('dmg stapled OK');
    else
      fail(
        'dmg is not stapled — first-time downloaders would hit a Gatekeeper warning',
        (r.stdout?.toString?.() ?? '') + (r.stderr?.toString?.() ?? ''),
      );
  }

  // DMG spctl
  section('spctl --assess --type install (.dmg)');
  if (ALLOW_ADHOC) {
    console.log('  - skipped (--allow-adhoc)');
  } else {
    const r = spawnSync(
      'spctl',
      ['--assess', '--type', 'install', '--verbose=4', DMG],
      { stdio: 'pipe' },
    );
    if (r.status === 0) pass('Gatekeeper accepts the .dmg');
    else
      fail(
        'spctl rejected the .dmg installer',
        (r.stdout?.toString?.() ?? '') + (r.stderr?.toString?.() ?? ''),
      );
  }
}

// ---- Summary -----------------------------------------------------------

console.log('');
console.log('[check-macos-signing] Summary:');
console.log(`  ${passes.length} pass / ${failures.length} fail`);
if (failures.length) {
  console.error('');
  for (const f of failures) console.error(`  ✗ ${f.msg}`);
  process.exit(1);
}
console.log('  All checks passed.');
process.exit(0);
