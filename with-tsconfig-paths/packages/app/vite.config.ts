import { defineConfig } from 'vite'
// @ts-ignore
import { fileURLToPath } from 'node:url'

export default defineConfig({
  resolve: {
    alias: {
      '@test/lib': fileURLToPath(new URL('../lib/src', import.meta.url))
    }
  }
})
