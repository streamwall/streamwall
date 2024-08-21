module.exports = {
  packagerConfig: { extraResource: './dist/web' },
  rebuildConfig: {},
  makers: [
    {
      name: '@electron-forge/maker-squirrel',
      config: {},
    },
    {
      name: '@electron-forge/maker-zip',
      platforms: ['darwin'],
    },
    {
      name: '@electron-forge/maker-deb',
      config: {},
    },
    {
      name: '@electron-forge/maker-rpm',
      config: {},
    },
  ],
  plugins: [
    {
      name: '@electron-forge/plugin-webpack',
      devServer: {
        stats: 'verbose'
      },
      devContentSecurityPolicy: 'default-src \'self\' \'unsafe-inline\' data:; script-src \'self\' \'unsafe-eval\' \'unsafe-inline\' data:',
      config: {
        mainConfig: './webpack.main.config.js',
        renderer: {
          config: './webpack.renderer.config.js',
          entryPoints: [
            {
              name: 'background',
              html: './src/renderer/background.html',
              js: './src/renderer/background.js',
              preload: {
                js: './src/renderer/layerPreload.js',
              },
            },
            {
              name: 'overlay',
              html: './src/renderer/overlay.html',
              js: './src/renderer/overlay.js',
              preload: {
                js: './src/renderer/layerPreload.js',
              },
            },
            {
              name: 'playHLS',
              html: './src/renderer/playHLS.html',
              js: './src/renderer/playHLS.js',
            },
            {
              name: 'media',
              preload: {
                js: './src/renderer/mediaPreload.js',
              },
            },
          ],
        },
      },
    },
  ],
  hooks: {
    // HACK: monkeypatch in extra webpack config to build control site
    generateAssets: (forgeConfig) => {
      const { configGenerator } = forgeConfig.pluginInterface.plugins[0]
      const origGetRendererConfig = configGenerator.getRendererConfig
      configGenerator.getRendererConfig = async (entryPoints) => {
        const config = await origGetRendererConfig.call(
          configGenerator,
          entryPoints,
        )
        config.push(require('./webpack.web.config'))
        return config
      }
    },
  },
}
