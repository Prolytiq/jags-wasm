// Bundle the PRODUCTION biostatistics session code (fts-app src/lib/biostatistics)
// into a browser ESM file, so the e2e page runs exactly what the app runs:
// R_BOOTSTRAP, runCode, installPackage, persist/restore workspace.
// Usage: node build-bundle.mjs [/path/to/fts-app]   (default ~/fts-app)
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const app = path.resolve(process.argv[2] || process.env.FTS_APP_DIR || path.join(os.homedir(), 'fts-app'))
const lib = path.join(app, 'src/lib/biostatistics')
const entry = path.join(here, 'app-entry.ts')
fs.writeFileSync(entry, `export * from ${JSON.stringify(path.join(lib, 'session.ts'))}
export * from ${JSON.stringify(path.join(lib, 'workspace-persist.ts'))}
export * from ${JSON.stringify(path.join(lib, 'files.ts'))}
`)
const esbuild = path.join(app, 'node_modules/.bin/esbuild')
execFileSync(esbuild, [entry, '--bundle', '--format=esm', '--platform=browser', '--target=es2022',
  `--outfile=${path.join(here, 'app-bundle.js')}`, '--log-level=warning'], { stdio: 'inherit' })
console.log('bundled', lib, '->', path.join(here, 'app-bundle.js'))
