import { build } from 'esbuild'
import { fileURLToPath } from 'url'
import path from 'path'

const here = path.dirname(fileURLToPath(import.meta.url))

// Every ~system module call is forwarded to the host that owns the vm context the bundle runs in.
const systemProxy = `module.exports = Object.fromEntries(
  Object.keys(globalThis.__host).map((key) => [key, (...args) => globalThis.__host[key](...args)])
)`

await build({
  entryPoints: [path.join(here, 'instance.ts')],
  outfile: path.join(here, 'instance.bundle.js'),
  bundle: true,
  platform: 'neutral',
  format: 'iife',
  mainFields: ['module', 'main'],
  logLevel: 'warning',
  plugins: [
    {
      name: 'system-proxy',
      setup(b) {
        b.onResolve({ filter: /^~system\// }, (args) => ({ path: args.path, namespace: 'system' }))
        b.onLoad({ filter: /.*/, namespace: 'system' }, () => ({ contents: systemProxy, loader: 'js' }))
      }
    }
  ]
})

await build({
  entryPoints: [path.join(here, 'run.ts')],
  outfile: path.join(here, 'out.cjs'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  logLevel: 'warning'
})
