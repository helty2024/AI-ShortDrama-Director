import { defineConfig } from '@playwright/test'
export default defineConfig({ testDir: './tests', outputDir: 'test-results/automated-smoke', testMatch: ['electron.spec.ts', 'alpha.spec.ts', 'settings.spec.ts', 'production-services.spec.ts'], workers: 1, timeout: 60000 })
