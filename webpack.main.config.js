const path = require('path');
const baseConfig = require('./webpack.base.config')

module.exports = {
  ...baseConfig({
    babel: {
      presets: [
        [
          '@babel/preset-env',
          {
            modules: 'commonjs',
            targets: { electron: '31.3' }
          },
        ],
      ],
    },
  }),
  target: 'electron-main',
  entry: './src/node/main.js',
  output: {
    path: path.resolve(__dirname, 'dist/main'),
    filename: 'main.js'
  }
}
