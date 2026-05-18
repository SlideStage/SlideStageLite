import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Tauri requires a fixed port and disables polyfills for performance.
// We honor `TAURI_DEV_HOST` so `tauri dev` can talk to its renderer on
// hot-reload, but leave the defaults intact when running `vite dev` for
// the pure Web build.
const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [react()],
  // Vite picks up VITE_* and TAURI_ENV_* env vars at build time; keep both
  // namespaces public so the renderer can branch on `import.meta.env.TAURI_*`.
  envPrefix: ['VITE_', 'TAURI_ENV_'],
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
    host: host || false,
    hmr: host
      ? { protocol: 'ws', host, port: 5174 }
      : undefined,
    watch: {
      // Don't reload the Vite dev server when the Rust side changes.
      ignored: ['**/src-tauri/**'],
    },
  },
});
