const webpack = require("webpack");
const path = require("path");
const TerserPlugin = require('terser-webpack-plugin');

module.exports = {
  mode: "production",
  entry: "./src/index.js",
  target: "node",
  output: {
    path: path.resolve(__dirname, "dist"),
    filename: "./bundle.js",
    libraryTarget: "commonjs2",
    library: "thundra"
  },
  resolve: {
    modules: ["node_modules"],
    extensions: [".js", ".jsx"]
  },
  plugins: [
    new TerserPlugin({
      terserOptions: {
        compress: {
          warnings: false
        }
      },
      sourceMap: true,
      parallel: true
    }),
    new webpack.optimize.ModuleConcatenationPlugin()
  ]
};
