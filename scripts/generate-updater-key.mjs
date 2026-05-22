#!/usr/bin/env node
/**
 * One-time helper that wraps `tauri signer generate` and prints copy-
 * paste-ready instructions for wiring the resulting keypair into the
 * Lite repository.
 *
 * Tauri's updater needs a minisign-style keypair:
 *
 *   - The PUBLIC key is embedded into `tauri.conf.json > plugins.updater.pubkey`.
 *     It's safe to commit (and we do commit it — it's what every shipped
 *     binary trusts).
 *   - The PRIVATE key signs each `.app.tar.gz` produced at release time.
 *     It MUST stay secret. Lose it and you can never ship a binary the
 *     existing fleet will accept again.
 *
 * What this script does:
 *
 *   1. Refuses to overwrite an existing keypair unless `--force` is set.
 *   2. Runs `pnpm tauri signer generate` to produce
 *        ~/.tauri/slidestage-lite-updater.key       (private)
 *        ~/.tauri/slidestage-lite-updater.key.pub   (public, base64)
 *      You will be prompted for a password — that password becomes
 *      TAURI_SIGNING_PRIVATE_KEY_PASSWORD at release time.
 *   3. Prints the base64 public key and exact next steps:
 *        a. Paste pubkey into tauri.conf.json > plugins.updater.pubkey
 *        b. Fill TAURI_SIGNING_PRIVATE_KEY / _PASSWORD into .env.local
 *        c. Commit the conf change (pubkey is public; the key file is not).
 *
 * This script DOES NOT mutate tauri.conf.json — pasting the pubkey is a
 * manual step on purpose so you can eyeball the value before committing.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';

const FORCE = process.argv.includes('--force');

const KEY_NAME = 'slidestage-lite-updater';
const KEY_DIR = resolve(homedir(), '.tauri');
const PRIVATE_KEY_PATH = resolve(KEY_DIR, `${KEY_NAME}.key`);
const PUBLIC_KEY_PATH = resolve(KEY_DIR, `${KEY_NAME}.key.pub`);

function info(msg) {
  console.log(`[updater-keygen] ${msg}`);
}

function warn(msg) {
  console.warn(`[updater-keygen] ⚠  ${msg}`);
}

function die(msg) {
  console.error(`\n[updater-keygen] ✖ ${msg}\n`);
  process.exit(1);
}

if (existsSync(PRIVATE_KEY_PATH) && !FORCE) {
  warn(`A private key already exists at ${PRIVATE_KEY_PATH}.`);
  warn(
    'Refusing to overwrite — losing the previous key would invalidate every shipped build.',
  );
  warn('Pass --force ONLY if you have a real reason to rotate.');
  if (existsSync(PUBLIC_KEY_PATH)) {
    const pub = readFileSync(PUBLIC_KEY_PATH, 'utf8').trim();
    info('');
    info('Existing public key (paste this into tauri.conf.json):');
    info('');
    info(pub);
    info('');
  }
  process.exit(0);
}

info(`Generating updater keypair at ${PRIVATE_KEY_PATH}`);
info('You will be prompted for a password.');
info(
  'Choose a password you can store in 1Password — losing it = losing the ability to ship updates.',
);

// IMPORTANT: use `pnpm exec` instead of `pnpm tauri`. The latter routes
// through `pnpm run`, which eats unknown flags (like `--write-keys`) as
// pnpm's own arguments before they ever reach the Tauri CLI. `pnpm exec`
// just runs the binary directly with the args we hand it.
const result = spawnSync(
  'pnpm',
  [
    'exec',
    'tauri',
    'signer',
    'generate',
    '--write-keys',
    PRIVATE_KEY_PATH,
    ...(FORCE ? ['--force'] : []),
  ],
  { stdio: 'inherit' },
);

if (result.status !== 0) {
  die(
    `tauri signer generate failed (exit ${result.status}). ` +
      "If you don't have @tauri-apps/cli installed yet, run `pnpm install` first.",
  );
}

if (!existsSync(PUBLIC_KEY_PATH)) {
  die(`expected public key at ${PUBLIC_KEY_PATH}, but it was not created.`);
}

const pubkey = readFileSync(PUBLIC_KEY_PATH, 'utf8').trim();

info('');
info('Keypair generated.');
info('');
info('Next steps:');
info('');
info('  1. Paste the PUBLIC key below into');
info('       src-tauri/tauri.conf.json > plugins.updater.pubkey');
info('     (it replaces the REPLACE_WITH_BASE64_PUBKEY_FROM_pnpm_signer_generate stub).');
info('');
info('     PUBLIC KEY:');
info('');
info(`     ${pubkey}`);
info('');
info('  2. Add to .env.local (gitignored):');
info('');
info(`       TAURI_SIGNING_PRIVATE_KEY=${PRIVATE_KEY_PATH}`);
info('       TAURI_SIGNING_PRIVATE_KEY_PASSWORD=<the password you just chose>');
info('');
info('  3. Commit the tauri.conf.json change.');
info('     DO NOT commit ~/.tauri/ — the private key file MUST stay off-repo.');
info('');
info(
  '  4. Run `pnpm release:macos` to produce a signed .app.tar.gz + .sig + latest.json.',
);
info('');
