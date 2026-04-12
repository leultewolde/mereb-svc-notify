import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.integration.ts'],
    passWithNoTests: true,
    fileParallelism: false,
    testTimeout: 300_000,
    hookTimeout: 300_000
  }
})
