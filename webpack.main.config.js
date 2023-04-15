const baseConfig = require('./webpack.base.config')

module.exports = {
  ...baseConfig({
    babel: {
      presets: [
        [
          '@babel/preset-env',
          {
            modules: 'commonjs',
            targets: { node: true },
          },
        ],
      ],
    },
  }),
  entry: './src/node/main.js',
  externals: {
    consolidate: 'commonjs consolidate',
    fsevents: 'commonjs fsevents',
  },
}
