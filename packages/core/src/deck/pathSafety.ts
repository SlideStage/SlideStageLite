// Re-exported from `@slidestage/spec`, the single source of truth for the
// `.stage` container contract. Kept as a stub here so existing imports
// (`@slidestage/core/deck/pathSafety`) keep working — see Phase B of
// `docs/ECOSYSTEM_IMPROVEMENT_PLAN.md`.
//
// Named re-exports are required (not `export *`) so esbuild can statically
// resolve each binding through this stub; `@slidestage/spec` is declared
// `external` in `tsup.config.ts`, and esbuild won't follow `export *`
// across an external boundary.
export {
  assertSafePath,
  isExternalReference,
  normalizePackagePath,
  resolvePackageReference,
  splitReferenceSuffix,
} from '@slidestage/spec/pathSafety';
