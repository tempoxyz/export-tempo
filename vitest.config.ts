import path from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    alias: {
      'export-wallet': path.resolve(import.meta.dirname, 'src'),
    },
    globals: true,
    globalSetup: [path.resolve(import.meta.dirname, 'test/setup.global.ts')],
    setupFiles: [path.resolve(import.meta.dirname, 'test/setup.ts')],
    hookTimeout: 60_000,
    testTimeout: 30_000,
  },
})
