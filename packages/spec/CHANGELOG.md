# @slidestage/spec — Changelog

## 0.1.1

### Patch Changes

- 4811496: Ship `packages/spec/fixtures/sources/reveal-basic/dist/reveal.js` inside
  the npm tarball.

  The repo-root `.gitignore` has a wildcard `dist/` rule (line 11) that's
  correct for build artefacts (every `packages/*/dist/`, every
  `apps/*/dist/`, the root vite build), but it also matched the _fixture_
  subdirectory `packages/spec/fixtures/sources/reveal-basic/dist/`.
  reveal-basic happens to vendor its runtime under reveal.js's official
  `dist/reveal.js` path, so the wildcard silently dropped `reveal.js`
  from the tracked tree. Since `npm pack` honours `.gitignore` even when
  the path is listed under the package's `files: ["dist", "fixtures",
...]`, the missing file _also_ never made it into `@slidestage/spec@0.1.0`'s
  tarball — downstream consumers who copy reveal-basic into a browser
  saw a 404 for `dist/reveal.js`.

  The fix is two narrow lines in `.gitignore`:

  ```
  !packages/spec/fixtures/sources/*/dist/
  !packages/spec/fixtures/sources/*/dist/**
  ```

  and re-committing `reveal.js`. impress-basic / html-ppt / huashu-\* /
  plain-html lay their JS flat next to `index.html`, so this carve-out is
  reveal-shaped and stays as narrow as possible. The wildcard `dist/`
  above the negation is untouched — `packages/ui/dist/`, `packages/core/dist/`,
  the root `dist/`, etc. still stay out of git.

  No schema change. No API change. Adds one 2.3kB file to the npm tarball.

  Functional impact for slidestage-pack: zero — the `@slidestage/core@0.1.2`
  sniffer already recognises reveal-basic via the `<div class="reveal">
  <div class="slides">` DOM markers, independent of whether the JS file
  exists. This patch only restores the deck-runnable-in-a-browser story
  for whoever directly copies the spec fixture.

See the root [`CHANGELOG.md`](../../CHANGELOG.md) of the SlideStage Lite
repository for the human-readable narrative of each release. This file
exists so the npm tarball ships a per-package changelog stub.

## 0.1.0

- Initial publication. Extracts the `.stage` (`slidestage@1.0`) container
  contract — Zod manifest schema, package-path safety, capability registry,
  error codes, and size limits — into a single source of truth that the
  Lite app, the Pro server, and the standalone `slidestage-pack` skill all
  consume.
