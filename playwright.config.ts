import { defineConfig } from '@playwright/test'
export default defineConfig({ testDir: './tests', testMatch: ['electron.spec.ts', 'alpha.spec.ts', 'settings.spec.ts'], workers: 1, timeout: 60000 })
