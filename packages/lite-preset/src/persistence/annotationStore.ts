import type { Stroke } from '@slidestage/ui/presenter/types';

const keyPrefix = 'slidestage-lite:annotations:';

type StoredAnnotations = Record<string, Stroke[]>;

function storageKey(fingerprint: string): string {
  return `${keyPrefix}${fingerprint}`;
}

function isStroke(value: unknown): value is Stroke {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const stroke = value as Partial<Stroke>;
  return (
    (stroke.tool === 'pen' || stroke.tool === 'highlighter') &&
    typeof stroke.color === 'string' &&
    typeof stroke.width === 'number' &&
    Array.isArray(stroke.points)
  );
}

export function loadAnnotations(fingerprint: string): Record<number, Stroke[]> {
  const raw = localStorage.getItem(storageKey(fingerprint));
  if (!raw) {
    return {};
  }

  try {
    const parsed = JSON.parse(raw) as StoredAnnotations;
    return Object.fromEntries(
      Object.entries(parsed)
        .map(([slideIndex, strokes]) => [
          Number(slideIndex),
          Array.isArray(strokes) ? strokes.filter(isStroke) : [],
        ])
        .filter(([slideIndex]) => Number.isInteger(slideIndex)),
    ) as Record<number, Stroke[]>;
  } catch {
    return {};
  }
}

export function saveAnnotations(fingerprint: string, annotations: Record<number, Stroke[]>) {
  localStorage.setItem(storageKey(fingerprint), JSON.stringify(annotations));
}

export function clearAnnotations(fingerprint: string) {
  localStorage.removeItem(storageKey(fingerprint));
}
