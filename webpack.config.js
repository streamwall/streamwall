const CopyPlugin = require('copy-webpack-plugin')

const baseConfig = {
  mode: 'development',
  module: {
    rules: [
      {
        test: /\.jsx?$/,
        exclude: /node_modules/,
        loader: 'babel-loader',
      },
      {
        test: /\.css$/i,
        use: ['style-loader', 'css-loader'],
      },
      {
        test: /\.ttf$/,
        loader: 'file-loader',
        options: {
          name: '[name].[ext]',
        },
      },
      {
        test: /\.svg$/,
        loader: '@svgr/webpack',
        options: {
          replaceAttrValues: {
            '#333': 'currentColor',
            '#555': '{props.color}',
          },
        },
      },
    ],
  },
}

const nodeConfig = {
  ...baseConfig,
  target: 'electron-main',
  entry: {
    index: './src/node/index.js',
  },
}

const browserConfig = {
  ...baseConfig,
  devtool: 'cheap-source-map',
  target: 'electron-renderer',
  entry: {
    control: './src/browser/control.js',
    overlay: './src/browser/overlay.js',
  },
  resolve: {
    extensions: ['.jsx', '.js'],
    alias: {
      react: 'preact/compat',
      'react-dom': 'preact/compat',
    },
  },
  plugins: [
    new CopyPlugin({
      patterns: [
        { from: 'src/**/*.html', to: '[name].html' },
        { from: 'src/**/*.ttf', to: '[name].ttf' },
      ],
    }),
  ],
}

module.exports = [nodeConfig, browserConfig]
