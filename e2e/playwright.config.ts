import { defineConfig } from '@playwright/test'

// Suite E2E contre la stack docker compose DEV déjà lancée :
// - app  : http://localhost:3001 (Vite)
// - api  : http://localhost:8001 (uvicorn, rate limits Redis — persistants,
//   purgés par le FLUSHALL exécuté en tête du global-setup)
// workers: 1 OBLIGATOIRE : les specs partagent un compte/org/bot créés par le
// global-setup et l'API rate-limite l'auth (10 login+register+password / 15 min / IP).
export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  retries: 1,
  reporter: 'list',
  globalSetup: './global-setup.ts',
  globalTeardown: './global-teardown.ts',
  timeout: 45_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: 'http://localhost:3001',
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
  ],
})
