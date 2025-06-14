import preact from '@preact/preset-vite'
import { resolve } from 'path'
import { defineConfig } from 'vite'

// https://vitejs.dev/config
export default defineConfig({
  base: process.env.STREAMWALL_CONTROL_URL ?? '/',

  build: {
    sourcemap: true,
  },

  resolve: {
    alias: {
      // Necessary for vite to watch the package dir
      'streamwall-control-ui': resolve(__dirname, '../streamwall-control-ui'),
      'streamwall-shared': resolve(__dirname, '../streamwall-shared'),
    },
  },

  plugins: [
    // FIXME: working around TS error: "Type 'Plugin<any>' is not assignable to type 'PluginOption'"
    ...(preact() as Plugin[]),
  ],
})
