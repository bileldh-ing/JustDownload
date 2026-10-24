// Bundles the worker (and the shared core package) into dist/main.js for the Docker image.
import { build } from "esbuild";
await build({
  entryPoints: ["src/main.ts"],
  outfile: "dist/main.js",
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  sourcemap: true,
  packages: "external",
  external: [],
  plugins: [{
    // Inline the workspace core package (TypeScript sources) but keep npm deps external.
    name: "inline-core",
    setup(b) {
      b.onResolve({ filter: /^@justdownload\/core(\/node)?$/ }, (args) => ({ path: new URL(args.path.endsWith("/node") ? "../../packages/core/src/node/index.ts" : "../../packages/core/src/index.ts", import.meta.url).pathname }));
    },
  }],
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
});
console.log("built dist/main.js");
