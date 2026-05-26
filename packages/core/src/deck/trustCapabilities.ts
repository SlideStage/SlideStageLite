// Re-exported from `@slidestage/spec`, the single source of truth for the
// `.stage` container contract. The original implementation now lives in
// `@slidestage/spec/trustCapabilities` and `@slidestage/spec/constants`
// (for `BASE_SANDBOX_TOKEN`). See Phase B of
// `docs/ECOSYSTEM_IMPROVEMENT_PLAN.md`.
//
// Named re-exports are required (not `export *`) so esbuild can statically
// resolve each binding through this stub; `@slidestage/spec` is declared
// `external` in `tsup.config.ts`, and esbuild won't follow `export *`
// across an external boundary.
export {
  CAPABILITY_REGISTRY,
  capabilitiesEqual,
  describeCapability,
  normalizeCapabilities,
  sandboxAllowsSameOrigin,
  sandboxTokensFor,
  type TrustCapabilityInfo,
} from '@slidestage/spec/trustCapabilities';
export { BASE_SANDBOX_TOKEN } from '@slidestage/spec/constants';
