module.exports = ({ babel }) => ({
  module: {
    rules: [
      {
        test: /\.jsx?$/,
        exclude: /node_modules/,
        use: {
          loader: 'babel-loader',
          options: babel,
        },
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
  stats: {
    colors: true,
    modules: true,
    reasons: true,
    errorDetails: true,
    warnings: true,
  }
})
