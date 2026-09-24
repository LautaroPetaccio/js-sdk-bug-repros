import { build } from 'esbuild'
import { fileURLToPath } from 'url'
import path from 'path'

const here = path.dirname(fileURLToPath(import.meta.url))
const shim = (name) => path.join(here, 'shims', name)

await build({
  entryPoints: [path.join(here, 'run.ts')],
  outfile: path.join(here, 'out.cjs'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  logLevel: 'warning',
  plugins: [
    {
      name: 'scene-runtime-shims',
      setup(b) {
        b.onResolve({ filter: /^~system\/SignedFetch$/ }, () => ({ path: shim('signed-fetch.ts') }))
        b.onResolve({ filter: /^~system\/Runtime$/ }, () => ({ path: shim('runtime.ts') }))
        // @dcl/sdk/server/utils imports '../network' only for isServer(); the real module boots comms.
        b.onResolve({ filter: /^\.\.\/network$/ }, (args) =>
          args.importer.includes(`${path.sep}sdk${path.sep}server${path.sep}`) ? { path: shim('network.ts') } : undefined
        )
      }
    }
  ]
})
