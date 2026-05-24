/**
 * Imperative "Check for Updates…" flow for the macOS native menu trigger.
 *
 * Why a separate module:
 *   `UpdateBanner` is a React view that only mounts on the landing
 *   (deck-closed) shell. The menu can fire any time — including while
 *   a deck is open and the banner does not exist — so we need an
 *   imperative entry point that drives the same updater plumbing
 *   without depending on the React tree.
 *
 * Flow (decision X1 + D1 + S1):
 *   1. Toggle the menu item to "Checking for Updates…" (disabled) via
 *      the Rust `set_check_update_menu_state` command. Gives the user
 *      immediate feedback in the place they clicked, mirroring Safari /
 *      Xcode / Sparkle.
 *   2. Probe the updater. On error, surface a native message dialog and
 *      stop. The error dialog is sticky-but-dismissible (one OK button).
 *   3. On "no update", surface a native message dialog with the current
 *      version so the user sees a confirmation that the probe ran.
 *   4. On "update available", surface a native confirm dialog (Install /
 *      Later). This intentionally does NOT auto-start the download; the
 *      banner flow is reserved for the silent boot probe.
 *   5. On "install", call `installUpdate()` and let Tauri's plugin
 *      relaunch the process. The menu item stays disabled / labelled
 *      "Checking…" during this window — finally{} only fires on the
 *      error path because the success path replaces the process.
 *
 * i18n contract:
 *   Strings are passed in by the caller (typically `LiteApp` via
 *   `useI18n`). Keeping translation out of this module means it has no
 *   React or context dependency, can run from any imperative trigger,
 *   and stays testable. `{version}` / `{message}` placeholders are
 *   interpolated via a tiny inline formatter — we deliberately do not
 *   re-import `i18n/messages` here because that would create a circular
 *   build dependency when this module is moved into `desktop/`.
 *
 * Web safety:
 *   The whole entry point bails out via `isTauri()` so the web bundle
 *   never imports `@tauri-apps/*`. All Tauri imports are dynamic.
 */
import { isTauri } from './env';
import {
  checkForUpdate,
  getCurrentDesktopVersion,
  installUpdate,
} from './updateCheck';

export interface ManualUpdateCheckLabels {
  /** Dialog title shown when no newer release is available. */
  upToDateTitle: string;
  /** Dialog body. `{version}` is interpolated with the running version. */
  upToDateBody: string;
  /** Dialog title shown when an update is available. */
  availableTitle: string;
  /** Dialog body. `{version}` is interpolated with the new release version. */
  availableBody: string;
  /** Confirm-dialog "OK" label, e.g. "Install Now". */
  installButton: string;
  /** Confirm-dialog "Cancel" label, e.g. "Later". */
  laterButton: string;
  /** Dialog title shown when the manifest probe itself failed. */
  errorTitle: string;
  /** Dialog body for probe failures. `{message}` is interpolated. */
  errorBody: string;
  /** Dialog title shown when downloadAndInstall failed mid-flight. */
  installErrorTitle: string;
  /** Dialog body for install failures. `{message}` is interpolated. */
  installErrorBody: string;
}

/**
 * Drive the manual update check end-to-end. Safe to call multiple
 * times — the Rust menu-state command is idempotent and the JS
 * dialogs queue if the user manages to fire two checks in flight.
 */
export async function runManualUpdateCheck(
  labels: ManualUpdateCheckLabels,
): Promise<void> {
  if (!isTauri()) return;

  // Load the Tauri core module dynamically so the web bundle never
  // hits this code path. If the import fails (shouldn't, since we
  // guard with isTauri above) we degrade silently rather than throwing
  // — the user just gets no dialog feedback, which is no worse than
  // before this menu item existed.
  let core: typeof import('@tauri-apps/api/core') | null = null;
  try {
    core = await import('@tauri-apps/api/core');
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('manualUpdateCheck: failed to load @tauri-apps/api/core', err);
    return;
  }

  await core
    .invoke('set_check_update_menu_state', { checking: true })
    .catch(() => {
      // Menu may not exist on Windows / Linux — never treat this as fatal.
    });

  try {
    let release: Awaited<ReturnType<typeof checkForUpdate>>;
    try {
      release = await checkForUpdate();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await showMessage(
        labels.errorTitle,
        formatLabel(labels.errorBody, { message }),
        'error',
      );
      return;
    }

    if (!release) {
      const current = await getCurrentDesktopVersion();
      await showMessage(
        labels.upToDateTitle,
        formatLabel(labels.upToDateBody, { version: current ?? '?' }),
        'info',
      );
      return;
    }

    const wantsInstall = await confirmDialog(
      labels.availableTitle,
      formatLabel(labels.availableBody, { version: release.version }),
      labels.installButton,
      labels.laterButton,
    );

    if (!wantsInstall) return;

    try {
      await installUpdate();
      // installUpdate already calls relaunch() — the process is about
      // to be replaced and finally{} below will not run on this path.
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await showMessage(
        labels.installErrorTitle,
        formatLabel(labels.installErrorBody, { message }),
        'error',
      );
    }
  } finally {
    await core
      .invoke('set_check_update_menu_state', { checking: false })
      .catch(() => {
        // ignore — same fallthrough as above
      });
  }
}

function formatLabel(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => vars[key] ?? `{${key}}`);
}

async function showMessage(
  title: string,
  body: string,
  kind: 'info' | 'error',
): Promise<void> {
  // Access via namespace (not destructuring) so the imported `message`
  // / `confirm` names don't collide with the DOM `confirm` global in
  // strict TypeScript builds, which otherwise narrows the binding to
  // `never`.
  try {
    const dlg = await import('@tauri-apps/plugin-dialog');
    await dlg.message(body, { title, kind });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('manualUpdateCheck: failed to show message dialog', err);
  }
}

async function confirmDialog(
  title: string,
  body: string,
  okLabel: string,
  cancelLabel: string,
): Promise<boolean> {
  try {
    const dlg = await import('@tauri-apps/plugin-dialog');
    return await dlg.confirm(body, {
      title,
      kind: 'info',
      okLabel,
      cancelLabel,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('manualUpdateCheck: failed to show confirm dialog', err);
    return false;
  }
}
