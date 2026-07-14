/**
 * Desktop-only "unsaved edits" exit interception.
 *
 * Two OS entry points are guarded while a deck with unexported edits is
 * open:
 *   - window close (red traffic-light button / Cmd+W / Alt+F4) through
 *     the webview window's close-requested event;
 *   - app quit (macOS App menu "Quit …" / Cmd+Q) through the custom
 *     `quit` menu item: the Rust side exits natively when the
 *     `set_unsaved_edits` flag is down and forwards `app:confirm-quit`
 *     to this module when it is raised.
 *
 * Dock-icon → Quit and OS shutdown/logout cannot be intercepted (tao
 * implements `applicationWillTerminate:` only, which is not
 * preventable); edits persist in localStorage so nothing is lost on
 * those paths — the user just misses the reminder.
 *
 * All Tauri imports are dynamic so the web bundle never pulls them in.
 * Callers must gate on `isTauri()`.
 */

export interface UnsavedExitGuardLabels {
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel: string;
}

export interface AttachUnsavedExitGuardOptions {
  /** Live check — read at the moment the close/quit request arrives. */
  isUnsaved: () => boolean;
  /** Resolved lazily so language switches don't need a re-attach. */
  getLabels: () => UnsavedExitGuardLabels;
}

/**
 * Mirror the "unexported edits exist" flag to the Rust side. The custom
 * quit menu item reads it to decide between exiting immediately and
 * asking this window for confirmation first.
 */
export async function setDesktopUnsavedFlag(unsaved: boolean): Promise<void> {
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('set_unsaved_edits', { unsaved });
}

/**
 * Attach the close/quit interception for the current (main) window.
 * Returns a detach handle; callers also lower the Rust flag on detach.
 */
export async function attachUnsavedExitGuard(
  opts: AttachUnsavedExitGuardOptions,
): Promise<{ detach(): void }> {
  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  const { listen } = await import('@tauri-apps/api/event');

  let promptOpen = false;

  const confirmExit = async (): Promise<boolean> => {
    // A second close/quit request while the dialog is up must not stack
    // another dialog (repeated Cmd+Q, close button spam).
    if (promptOpen) return false;
    promptOpen = true;
    try {
      const labels = opts.getLabels();
      const dlg = await import('@tauri-apps/plugin-dialog');
      return await dlg.ask(labels.body, {
        title: labels.title,
        kind: 'warning',
        okLabel: labels.confirmLabel,
        cancelLabel: labels.cancelLabel,
      });
    } catch {
      // Dialog unavailable — never trap the user inside the app.
      return true;
    } finally {
      promptOpen = false;
    }
  };

  const exitApp = async (): Promise<void> => {
    try {
      await setDesktopUnsavedFlag(false);
    } catch {
      // ignore — the flag only matters while the app keeps running
    }
    try {
      const { exit } = await import('@tauri-apps/plugin-process');
      await exit(0);
    } catch {
      // Last resort: at least tear down this window.
      try {
        await getCurrentWindow().destroy();
      } catch {
        // ignore
      }
    }
  };

  const unlistenClose = await getCurrentWindow().onCloseRequested(async (event) => {
    if (!opts.isUnsaved()) return;
    event.preventDefault();
    if (await confirmExit()) {
      // Exit the whole app (not just this window) so an open audience
      // window never survives as an orphan.
      await exitApp();
    }
  });

  const unlistenQuit = await listen('app:confirm-quit', async () => {
    // Rust only emits this when the flag is raised, but the state may
    // have changed while the event was in flight — re-check.
    if (!opts.isUnsaved() || (await confirmExit())) {
      await exitApp();
    }
  });

  return {
    detach() {
      try {
        unlistenClose();
      } catch {
        // ignore
      }
      try {
        unlistenQuit();
      } catch {
        // ignore
      }
    },
  };
}
