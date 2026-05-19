/**
 * Monitor enumeration for the audience-window placement UI.
 *
 * We prefer the Rust-side `invoke('list_monitors')` command because it
 * always sees the OS list even before any non-main window exists, but we
 * fall back to the pure-JS `availableMonitors()` so the front-end never
 * gates on a Rust release of a particular commit.
 *
 * Returned monitors are deduplicated by `id` (Rust list wins on
 * collision) and sorted with the primary display first.
 */
export interface MonitorInfo {
  id: number;
  name: string;
  width: number;
  height: number;
  x: number;
  y: number;
  scaleFactor: number;
  isPrimary: boolean;
}

interface RustMonitor {
  id: number;
  name: string;
  width: number;
  height: number;
  x: number;
  y: number;
  scale_factor: number;
  is_primary: boolean;
}

function normalize(rust: RustMonitor): MonitorInfo {
  return {
    id: rust.id,
    name: rust.name,
    width: rust.width,
    height: rust.height,
    x: rust.x,
    y: rust.y,
    scaleFactor: rust.scale_factor,
    isPrimary: rust.is_primary,
  };
}

async function fromRust(): Promise<MonitorInfo[] | null> {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const list = await invoke<RustMonitor[]>('list_monitors');
    if (!Array.isArray(list)) return null;
    return list.map(normalize);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('list_monitors invoke failed, falling back to JS API', err);
    return null;
  }
}

async function fromJsApi(): Promise<MonitorInfo[]> {
  const { availableMonitors, primaryMonitor } = await import(
    '@tauri-apps/api/window'
  );
  const [monitors, primary] = await Promise.all([
    availableMonitors(),
    primaryMonitor(),
  ]);
  const primaryKey = primary
    ? `${primary.position.x},${primary.position.y}`
    : '0,0';
  return monitors.map((m, idx) => ({
    id: idx,
    name: m.name ?? `Display ${idx + 1}`,
    width: m.size.width,
    height: m.size.height,
    x: m.position.x,
    y: m.position.y,
    scaleFactor: m.scaleFactor,
    isPrimary: `${m.position.x},${m.position.y}` === primaryKey,
  }));
}

export async function listMonitors(): Promise<MonitorInfo[]> {
  const rust = await fromRust();
  const list = rust && rust.length > 0 ? rust : await fromJsApi();
  // Sort: primary first, then by x ascending so multi-monitor layouts
  // read left-to-right in the picker UI.
  return [...list].sort((a, b) => {
    if (a.isPrimary === b.isPrimary) return a.x - b.x;
    return a.isPrimary ? -1 : 1;
  });
}

export function defaultAudienceMonitor(monitors: MonitorInfo[]): MonitorInfo | null {
  if (monitors.length === 0) return null;
  // Prefer the first non-primary monitor; this matches the typical
  // "presenter screen vs projector" setup. Fall back to the primary
  // when only one display is attached.
  const secondary = monitors.find((m) => !m.isPrimary);
  return secondary ?? monitors[0];
}
