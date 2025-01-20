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
      config: {
        devContentSecurityPolicy: 'default-src \'self\' \'unsafe-inline\' data:; script-src \'self\' \'unsafe-eval\' \'unsafe-inline\' data:',
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
              nodeIntegration: true,
            },
            {
              name: 'overlay',
              html: './src/renderer/overlay.html',
              js: './src/renderer/overlay.js',
              preload: {
                js: './src/renderer/layerPreload.js',
              },
              nodeIntegration: true,
            },
            {
              name: 'playHLS',
              html: './src/renderer/playHLS.html',
              js: './src/renderer/playHLS.js',
              nodeIntegration: true,
            },
            {
              name: 'media',
              preload: {
                js: './src/renderer/mediaPreload.js',
              },
              nodeIntegration: true,
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
