import { defineConfig, devices } from '@playwright/test'

// Playwright specs live only under tests/e2e/. Vitest collects tests/** minus e2e/.
export default defineConfig({
  testDir: './tests/e2e',
  globalSetup: './tests/e2e/global-setup.ts',
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  reporter: 'list',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run dev',
    // The auth specs need the real guard even if .env.local has the dev bypass on.
    env: { NEXT_PUBLIC_AUTH_BYPASS: 'false' },
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
})
