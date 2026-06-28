import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    // Give jsdom a concrete (non-opaque) origin so it exposes a working
    // `window.localStorage`. Without a real URL jsdom defaults to the
    // `about:blank` opaque origin and omits Storage entirely; on Node 22+
    // `window.localStorage` then falls through to Node's native
    // localStorage, which is gated behind `--localstorage-file` and so
    // reads back as `undefined` (breaking every test that clears storage
    // in `beforeEach`).
    environmentOptions: {
      jsdom: {
        url: 'http://localhost/',
      },
    },
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    globals: false,
  },
});
