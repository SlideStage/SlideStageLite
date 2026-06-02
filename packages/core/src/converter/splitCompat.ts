import type { TrustCapability } from '../deck/types';

/**
 * Shared trust-metadata detection for the split converters
 * (DSS-CAND-009/010/013/014/015).
 *
 * Every split mode copies author markup — the preserved `<head>`, inline
 * `<script>` blocks, and any non-runtime `<script src>` — into the
 * generated per-slide pages. Only the framework runtime scripts
 * (reveal.js / impress.js / deck-stage.js / fx-runtime.js) are stripped.
 * Anything left is author code that will execute inside the platform
 * iframe, so the produced `.stage` MUST declare the trust capability it
 * needs, exactly like the wrap/single converters already do. Declaring
 * too little is the bug: the deck silently runs in the base sandbox and
 * the host never prompts, leaving the consent/policy metadata inaccurate.
 */

const SCRIPT_TAG_RE = /<script\b/i;

/**
 * True when `html` still contains a `<script>` tag after runtime-script
 * stripping. Used on the generated slide markup (head + body) so split
 * converters can decide whether to emit `compat.requires`.
 */
export function htmlRetainsScript(html: string): boolean {
  return SCRIPT_TAG_RE.test(html);
}

export interface SplitScriptCompat {
  requires: TrustCapability[];
  notes: string;
}

/**
 * Trust capabilities a split slide must declare when it retains author
 * scripts. Aligned with the reveal/impress split converters
 * (`same-origin-storage`) so all split modes are consistent.
 */
export const SPLIT_SCRIPT_TRUST_CAPABILITIES: TrustCapability[] = ['same-origin-storage'];

/** Build the `compat` block declared when a split slide retains author scripts. */
export function splitScriptCompat(): SplitScriptCompat {
  return {
    requires: [...SPLIT_SCRIPT_TRUST_CAPABILITIES],
    notes:
      'One or more split slides retain author <script> blocks (inline, external, ' +
      'or in the preserved <head>). Granting same-origin-storage lets that author ' +
      'code run inside the platform iframe.',
  };
}
