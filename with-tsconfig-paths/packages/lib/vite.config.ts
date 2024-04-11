import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    lib: {
      entry: 'src/index.ts',
      fileName: 'lib',
      formats: ['es']
    }
  }
})
