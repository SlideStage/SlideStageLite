# Changesets

This directory tracks version bumps + release notes for the three publishable
Lite packages:

- `@slidestage/core`
- `@slidestage/ui`
- `@slidestage/lite-preset`

The root `slidestage-lite` app is **not** released to npm — it is the
end-user-deployable Cloudflare Workers app (see `wrangler.jsonc` +
`pnpm deploy:cloudflare`). It is excluded from the workspace glob
(`pnpm-workspace.yaml` only declares `packages/*`), so changesets never
considers it for versioning.

## Release Triad Policy

All three packages release in lockstep through the `fixed` group in
`.changeset/config.json`. This keeps Pro's dependency surface trivial:

```jsonc
"dependencies": {
  "@slidestage/core":        "^0.1.0",
  "@slidestage/ui":          "^0.1.0",
  "@slidestage/lite-preset": "^0.1.0"
}
```

If you mark a change as patch / minor / major against any single package, the
other two get the **same** bump.

## Pro Must Use Semver, Not Source

Pro **must** depend on these packages by their published npm version. Any
`file:../SlideStageLite` or `link:../SlideStageLite` pinning is rejected by
`pnpm check:boundaries` (`scripts/check-boundaries.mjs`) and would also
prevent us from ever moving the Lite repo independently.

## Workflow

1. Make code changes inside the workspace.
2. `pnpm changeset` — answer the wizard, pick the bump level, write a summary.
   A new `.changeset/*.md` is created; commit it alongside your PR.
3. After merge, run `pnpm version-packages`. This consumes all pending
   `.changeset/*.md` files, bumps each fixed-triad package, regenerates
   `CHANGELOG.md` per package, and commits.
4. `pnpm release` — runs `pnpm -r build` (so each package's `dist/` is fresh)
   then `changeset publish` against the npm registry. The pre-build step is
   required because `files: ["dist", ...]` means the tarball is empty
   without it.

## Initial 0.1.0

The first publish does not need a changeset: the three packages were
hand-stamped at `0.1.0` during Phase 5B. Just run:

```bash
pnpm -r build
pnpm exec changeset publish
```

Subsequent releases follow the wizard-driven workflow above.
