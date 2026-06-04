# Mirror External Assets for Offline Playback

Some HTML decks reference external images, fonts, CSS, or media. The mirror pass folds reachable external assets into a `.stage` file so the deck can play without network access.

## When to mirror

Use mirror when a deck:

- Depends on CDN assets.
- Must play in an offline room.
- Is being archived.
- Will be uploaded to a network-restricted Pro instance.

## 1. Create a `.stage`

```bash
pnpm convert pack ./my-deck --out ./my-deck.stage
```

## 2. Run mirror

```bash
pnpm mirror ./my-deck.stage -o ./my-deck.offline.stage
```

## 3. Adjust budgets

```bash
pnpm mirror ./my-deck.stage \
  -o ./my-deck.offline.stage \
  --max-asset-bytes 10485760 \
  --max-total-bytes 209715200
```

Prefer reducing source asset size before raising budgets.

## 4. Scripts and iframes

Only include external scripts or iframes for trusted sources:

```bash
pnpm mirror ./my-deck.stage \
  -o ./my-deck.offline.stage \
  --include-scripts \
  --include-iframes
```

## 5. Generate a report

```bash
pnpm mirror ./my-deck.stage \
  -o ./my-deck.offline.stage \
  --report ./mirror-report.md
```

Review mirrored and skipped URLs before publishing.

## Security notes

Mirror should deny localhost, private networks, link-local addresses, and cloud metadata hosts by default.

JavaScript-generated URLs are not guaranteed to be discovered.
