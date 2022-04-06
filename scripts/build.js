const { build } = require("esbuild");

const makeAllPackagesExternalPlugin = {
    name: 'make-all-packages-external',
    setup(build) {
      let filter = /^[^.\/]|^\.[^.\/]|^\.\.[^\/]/ // Must not start with "/" or "./" or "../"
      build.onResolve({ filter }, args => ({ path: args.path, external: true }))
    },
}

build({
    bundle: true,
    minify: true,
    target: "node10",
    platform: "node",
    entryPoints: ["./src/index.js"],
    outfile: "./dist/bundle.js",
    plugins: [
        makeAllPackagesExternalPlugin,
    ],
});