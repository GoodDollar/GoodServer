/* eslint-disable import/no-extraneous-dependencies */
/* This config file is only for transpiling the Express server file.
 * You need webpack-node-externals to transpile an express file
 * but if you use it on your regular React bundle, then all the
 * node modules your app needs to function get stripped out.
 *
 * Note: that prod and dev mode are set in npm scripts.
 */
const path = require('path')
const nodeExternals = require('webpack-node-externals')
const NodemonPlugin = require('nodemon-webpack-plugin')
const SentryCliPlugin = require('@sentry/webpack-plugin')
const webpack = require('webpack')
const { version } = require('./package.json')

module.exports = (_, argv) => {
  const isProductionMode = argv.mode === 'production'
  const SERVER_PATH = `./src/server/${isProductionMode ? 'index-prod' : 'index-dev'}.js`
  const { VERSION, NODE_ENV, TRAVIS } = process.env
  const externals = []
  const plugins = [new webpack.DefinePlugin({})]
  if(isProductionMode === false)
  {
    externals.push(nodeExternals())
    plugins.push(new NodemonPlugin())
  }
  if (isProductionMode && TRAVIS !== 'true') {
    plugins.push(
      new SentryCliPlugin({
        rewrite: true,
        release: VERSION || version,
        deploy: { env: NODE_ENV || 'development' },
        configFile: './sentry.properties',

        include: ['./dist'],
        ignoreFile: '.gitignore',
        ignore: ['node_modules', 'webpack.*.config.js']
      })
    )
  }

  return {
    entry: {
      server: ['@babel/polyfill', SERVER_PATH]
    },
    output: {
      publicPath: '/',
      filename: '[name].js',
      path: path.join(__dirname, 'dist')
    },
    devtool: 'source-map',
    mode: argv.mode,
    target: 'node',
    node: {
      // Need this when working with express, otherwise the build fails
      __dirname: false, // if you don't put this is, __dirname
      __filename: false // and __filename return blank or /
    },
    optimization: {
      nodeEnv: false
    },
    externals, // Need this for dev mode
    plugins,
    module: {
      rules: [
        {
          // Transpiles ES6-8 into ES5
          test: /\.js$/,
          exclude: /node_modules/,
          use: {
            loader: 'babel-loader'
          }
        }
      ]
    }
  }
}

// Webpack 4 basic tutorial:
// https://www.valentinog.com/blog/webpack-4-tutorial/#webpack_4_production_and_development_mode

// eslint-disable-next-line max-len
// Development mode is optimized for build speed and does nothing more than providing an un-minified bundle.
// eslint-disable-next-line max-len
// Production mode enables all sorts of optimizations like minification, scope hoisting, tree-shaking and more.
