import type { TrustCapability } from '@slidestage/core/deck/types';
import {
  capabilitiesEqual,
  normalizeCapabilities,
} from '@slidestage/core/deck/trustCapabilities';

const keyPrefix = 'slidestage-lite:trust:';

export interface TrustGrant {
  status: 'granted';
  fingerprint: string;
  capabilities: TrustCapability[];
  grantedAt: string;
}

function storageKey(fingerprint: string): string {
  return `${keyPrefix}${fingerprint}`;
}

function isCapabilityArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string');
}

/**
 * Read the persisted grant for this fingerprint. Returns the record only
 * when it covers the *exact* capability set the caller is about to ask
 * for. Mismatched / outdated records resolve to `null` so the caller
 * always re-prompts on capability drift.
 */
export function loadTrustGrant(
  fingerprint: string,
  required: ReadonlyArray<TrustCapability>,
): TrustGrant | null {
  if (typeof window === 'undefined') return null;

  const raw = window.localStorage.getItem(storageKey(fingerprint));
  if (!raw) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== 'object') return null;
  const record = parsed as Partial<TrustGrant>;
  if (record.status !== 'granted') return null;
  if (record.fingerprint !== fingerprint) return null;
  if (!isCapabilityArray(record.capabilities)) return null;

  const normalized = normalizeCapabilities(record.capabilities);
  const requiredNormalized = normalizeCapabilities(required);

  if (!capabilitiesEqual(normalized, requiredNormalized)) {
    return null;
  }

  return {
    status: 'granted',
    fingerprint,
    capabilities: normalized,
    grantedAt: typeof record.grantedAt === 'string' ? record.grantedAt : '',
  };
}

export function saveTrustGrant(
  fingerprint: string,
  capabilities: ReadonlyArray<TrustCapability>,
): TrustGrant {
  const normalized = normalizeCapabilities(capabilities);
  const grant: TrustGrant = {
    status: 'granted',
    fingerprint,
    capabilities: normalized,
    grantedAt: new Date().toISOString(),
  };

  if (typeof window === 'undefined') return grant;
  try {
    window.localStorage.setItem(storageKey(fingerprint), JSON.stringify(grant));
  } catch {
    // localStorage may be unavailable / over quota; intentionally silent —
    // the grant remains valid for the lifetime of the current tab.
  }
  return grant;
}

export function clearTrustGrant(fingerprint: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(storageKey(fingerprint));
  } catch {
    // ignore
  }
}
