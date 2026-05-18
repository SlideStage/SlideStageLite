import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:5173',
    trace: 'on-first-retry',
  },
  webServer: {
    command: 'pnpm dev --host 127.0.0.1',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: !process.env.CI,
    // Pin the dev server's beian env to empty so e2e tests run against a
    // deterministic baseline even when a developer has a populated local
    // `.env`/`.env.local`. Tests that need populated values can override
    // VITE_BEIAN_* per-run, but our current e2e suite only verifies the
    // default-empty contract.
    env: {
      VITE_BEIAN_ICP_TEXT: '',
      VITE_BEIAN_ICP_URL: '',
      VITE_BEIAN_MPS_TEXT: '',
      VITE_BEIAN_MPS_URL: '',
    },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
