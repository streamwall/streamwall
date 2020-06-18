const path = require('path')
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
  resolve: {
    extensions: ['.jsx', '.js'],
    alias: {
      react: 'preact/compat',
      'react-dom': 'preact/compat',
    },
  },
}

const nodeConfig = {
  ...baseConfig,
  target: 'electron-main',
  entry: {
    index: './src/node/index.js',
  },
  externals: {
    consolidate: 'commonjs consolidate',
  },
}

const browserConfig = {
  ...baseConfig,
  devtool: 'cheap-source-map',
  target: 'electron-renderer',
  entry: {
    overlay: './src/browser/overlay.js',
  },
  plugins: [
    new CopyPlugin({
      patterns: [{ from: 'src/browser/overlay.html', to: '[name].html' }],
    }),
  ],
}

const webConfig = {
  ...baseConfig,
  devtool: 'cheap-source-map',
  target: 'web',
  entry: {
    control: './src/web/control.js',
  },
  output: {
    path: path.resolve(__dirname, 'dist/web'),
  },
  plugins: [
    new CopyPlugin({
      patterns: [{ from: 'src/web/*.ejs', to: '[name].ejs' }],
    }),
  ],
}

module.exports = [nodeConfig, browserConfig, webConfig]
