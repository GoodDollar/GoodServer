/* eslint-disable import/no-extraneous-dependencies */
const path = require('path')
const webpack = require('webpack')

module.exports = {
  entry: {
    main: [
      '@babel/polyfill',
      'webpack-hot-middleware/client?path=/__webpack_hmr&reload=true&timeout=20000',
      './src/client/index.js'
    ]
  },
  resolve: {
    extensions: ['.ts', '.js', '.json', '.htm']
  },
  output: {
    path: path.join(__dirname, 'dist'),
    publicPath: '/',
    filename: '[name].js'
  },
  mode: 'development',
  target: 'web',
  devtool: '#source-map',
  node: {
    fs: 'empty'
  },
  optimization: {
    nodeEnv: false
  },
  module: {
    rules: [
      // {
      //   enforce: "pre",
      //   test: /\.js$/,
      //   exclude: /node_modules/,
      //   loader: "eslint-loader",
      //   options: {
      //     emitWarning: true,
      //     failOnError: false,
      //     failOnWarning: false
      //   }
      // },
      {
        test: /\.js$/,
        exclude: /node_modules/,
        loader: 'babel-loader'
      }
    ]
  },
  plugins: [
    new webpack.DefinePlugin({
      PRODUCTION: JSON.stringify(false),
      NETWORK: JSON.stringify('kovan'),
      'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV)
    }),
    new webpack.HotModuleReplacementPlugin(),
    new webpack.NoEmitOnErrorsPlugin()
  ]
}
