/**
 * Speaker-notes extraction shared by every converter dispatch path.
 *
 * The runtime contract is intentionally convention-over-configuration so that
 * existing decks (huashu-design, html-ppt-skill, plain HTML…) drop in without
 * the author editing anything. We look for a slide's prose in four places,
 * in priority order, and the first non-empty hit wins:
 *
 *   1. `speaker-notes/<basename>.md`        (huashu-design convention)
 *   2. `notes/<basename>.md`                (common alternative)
 *   3. `<slide-dir><basename>.notes.md`     (co-located attachment)
 *   4. `<aside class="notes">` / `<template id="speaker-notes">` inside the
 *      slide HTML itself                    (reveal.js / scripted variants)
 *
 * Results are trimmed and capped at MAX_NOTES_CHARS so a runaway markdown
 * file can't bloat the manifest.
 */

// `MAX_NOTES_CHARS` is the .stage container's speaker-notes length cap
// (~16 KB UTF-8). It belongs in `@slidestage/spec`, the format SoT
// introduced in Phase B of `docs/ECOSYSTEM_IMPROVEMENT_PLAN.md`. We
// re-export it here so existing imports
// (`MAX_NOTES_CHARS` from `@slidestage/core/converter/speakerNotes`)
// keep working.
import { MAX_NOTES_CHARS } from '@slidestage/spec/constants';
export { MAX_NOTES_CHARS };

const textDecoder = new TextDecoder('utf-8', { fatal: false });

function decodeUtf8(bytes: Uint8Array): string {
  return textDecoder.decode(bytes);
}

function trimNotes(raw: string): string | null {
  const normalized = raw.replace(/\r\n/g, '\n').trim();
  if (!normalized) return null;
  return normalized.length > MAX_NOTES_CHARS
    ? normalized.slice(0, MAX_NOTES_CHARS)
    : normalized;
}

function basenameWithoutExt(filePath: string): string {
  const last = filePath.split('/').pop() ?? filePath;
  return last.replace(/\.[^./]+$/, '');
}

function dirnameWithSlash(filePath: string): string {
  const idx = filePath.lastIndexOf('/');
  return idx === -1 ? '' : filePath.slice(0, idx + 1);
}

export function extractInlineNotes(html: string): string | null {
  const candidates: RegExp[] = [
    /<aside[^>]*class\s*=\s*["'][^"']*\b(?:speaker-)?notes\b[^"']*["'][^>]*>([\s\S]*?)<\/aside>/i,
    /<template[^>]*id\s*=\s*["'](?:speaker-notes|notes)["'][^>]*>([\s\S]*?)<\/template>/i,
  ];
  for (const rx of candidates) {
    const match = rx.exec(html);
    if (!match) continue;
    const stripped = match[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    const trimmed = trimNotes(stripped);
    if (trimmed) return trimmed;
  }
  return null;
}

export function findSlideNotes(
  entries: Map<string, Uint8Array>,
  slideFile: string,
): string | null {
  const base = basenameWithoutExt(slideFile);
  const dir = dirnameWithSlash(slideFile);

  const sidecarPaths = [
    `speaker-notes/${base}.md`,
    `notes/${base}.md`,
    `${dir}${base}.notes.md`,
  ];
  for (const path of sidecarPaths) {
    const bytes = entries.get(path);
    if (!bytes) continue;
    const text = trimNotes(decodeUtf8(bytes));
    if (text) return text;
  }

  const html = entries.get(slideFile);
  if (html) {
    const inline = extractInlineNotes(decodeUtf8(html));
    if (inline) return inline;
  }

  return null;
}
