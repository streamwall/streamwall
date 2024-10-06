const path = require('path')
const CopyPlugin = require('copy-webpack-plugin')
const baseConfig = require('./webpack.base.config')

module.exports = {
  ...baseConfig({
    babel: {
      presets: [
        [
          '@babel/preset-env',
          {
            modules: 'commonjs',
            targets: '> 0.25%, not dead',
          },
        ],
      ],
    },
  }),
  devtool: 'cheap-source-map',
  target: 'web',
  entry: {
    control: './src/web/entrypoint.js',
  },
  output: {
    path: path.resolve(__dirname, '.webpack/main/web'),
  },
  plugins: [
    new CopyPlugin({
      patterns: [{ from: 'src/web/*.ejs', to: '[name].ejs' }],
    }),
  ],
}
