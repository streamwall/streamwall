import { defineConfig } from 'vite'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// https://vitejs.dev/config
export default defineConfig({
  resolve: {
    alias: {
      // Allow importing the control server from the monorepo during main build
      'streamwall-control-server': path.resolve(
        __dirname,
        '../streamwall-control-server/src/index.ts',
      ),
    },
  },
  build: {
    sourcemap: true,
  },
})
