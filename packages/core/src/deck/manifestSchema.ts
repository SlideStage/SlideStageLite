// The Zod manifest schema and warning-callback contract are owned by
// `@slidestage/spec` (the format SoT introduced in Phase B of
// `docs/ECOSYSTEM_IMPROVEMENT_PLAN.md`). The spec's `parseManifest` does
// not touch `console` so it stays platform-agnostic; here we re-export
// it with the legacy `@slidestage/core` behavior: every warning fires
// BOTH the user-supplied `onWarning` (if any) AND `console.warn`. This
// matches the pre-spec implementation that did both side-effects, so
// existing tests and consumers (`@slidestage/core/deck/manifestSchema`)
// see no observable change.

import type { Manifest } from '@slidestage/spec/types';
import {
  parseManifest as parseManifestSpec,
  logManifestWarningToConsole,
  type ManifestWarning,
  type ParseManifestOptions,
} from '@slidestage/spec/manifestSchema';

export {
  manifestSchema,
  logManifestWarningToConsole,
  type ManifestWarning,
  type ParseManifestOptions,
} from '@slidestage/spec/manifestSchema';

export function parseManifest(value: unknown, options: ParseManifestOptions = {}): Manifest {
  const userOnWarning = options.onWarning;
  return parseManifestSpec(value, {
    onWarning: (warning: ManifestWarning) => {
      userOnWarning?.(warning);
      logManifestWarningToConsole(warning);
    },
  });
}
