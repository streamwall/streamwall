const path = require('path');
const baseConfig = require('./webpack.base.config');

module.exports = {
  ...baseConfig({
    babel: {
      presets: [['@babel/preset-env', { targets: { electron: '31.3' } }]],
      plugins: [
        ['@babel/plugin-transform-react-jsx', { pragma: 'h', pragmaFrag: 'Fragment' }],
        '@babel/plugin-proposal-class-properties',
        '@babel/plugin-proposal-object-rest-spread'
      ]
    },
  }),
  entry: {
    background: './src/renderer/background.js',
    overlay: './src/renderer/overlay.js',
    playHLS: './src/renderer/playHLS.js'
  },
  output: {
    path: path.resolve(__dirname, 'dist/renderer'),
    filename: '[name].js'
  }
}
