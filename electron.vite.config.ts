import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'electron-vite'

const buildMetadata = JSON.stringify({
  revision: execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
    encoding: 'utf8',
    windowsHide: true,
  }).trim(),
  builtAt: new Date().toISOString(),
})
export default defineConfig({
  main: {
    define: { __DIRECTOR_BUILD__: JSON.stringify(buildMetadata) },
    build: { rollupOptions: { input: resolve('electron/main/index.ts') } },
  },
  preload: {
    build: {
      rollupOptions: {
        input: resolve('electron/preload/index.ts'),
        output: { format: 'cjs', entryFileNames: 'index.cjs' },
      },
    },
  },
  renderer: {
    root: '.',
    plugins: [
      react(),
      {
        name: 'development-csp',
        apply: 'serve',
        transformIndexHtml(html) {
          return html.replace(
            "script-src 'self'",
            "script-src 'self' 'unsafe-inline'",
          )
        },
      },
    ],
    server: { host: '127.0.0.1' },
    build: { rollupOptions: { input: resolve('index.html') } },
  },
})
