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
  entry: './src/node/main.js',
  output: {
    path: path.resolve(__dirname, '.webpack/main'),
    filename: 'index.js'
  },
}
