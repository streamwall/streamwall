const baseConfig = require('./webpack.base.config')

module.exports = {
  ...baseConfig({
    babel: {
      presets: [['@babel/preset-env', { targets: { electron: '24' } }]],
    },
  }),
}
