import { build } from 'esbuild'
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

async function writeThirdPartyNotices(dist, metafiles) {
  const packages = new Map()
  for (const metafile of metafiles) {
    for (const input of Object.keys(metafile.inputs)) {
      if (!input.includes('node_modules/')) continue
      let directory = dirname(resolve(input))
      while (directory !== dirname(directory)) {
        try {
          const metadata = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'))
          if (metadata.name && metadata.version) {
            packages.set(directory, metadata)
            break
          }
        } catch {}
        directory = dirname(directory)
      }
    }
  }
  let notices = 'zcode-context-insight — bundled dependency notices\n\n'
  for (const [directory, metadata] of [...packages.entries()].sort((a, b) =>
    a[1].name.localeCompare(b[1].name),
  )) {
    let license = ''
    for (const name of ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'LICENSE-MIT', 'license', 'license.md']) {
      try {
        license = await readFile(join(directory, name), 'utf8')
        break
      } catch {}
    }
    if (!license) throw new Error('Missing bundled dependency license: ' + metadata.name)
    notices += '===== ' + metadata.name + ' ' + metadata.version + ' =====\n' + license + '\n\n'
    try {
      notices += await readFile(join(directory, 'NOTICE'), 'utf8')
      notices += '\n\n'
    } catch {}
  }
  await writeFile(join(dist, 'THIRD_PARTY_NOTICES.txt'), notices, 'utf8')
}

export async function buildAll({ quiet = false } = {}) {
  const dist = join(ROOT, 'dist')
  await rm(dist, { recursive: true, force: true })
  await mkdir(dist, { recursive: true })
  const logLevel = quiet ? 'silent' : 'info'

  const serverBuild = await build({
    entryPoints: [join(ROOT, 'src/server.mjs')],
    outfile: join(dist, 'server.mjs'),
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node24',
    sourcemap: false,
    legalComments: 'none',
    metafile: true,
    logLevel,
  })
  const workerBuild = await build({
    entryPoints: [join(ROOT, 'src/worker.mjs')],
    outfile: join(dist, 'worker.mjs'),
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node24',
    sourcemap: false,
    legalComments: 'none',
    metafile: true,
    logLevel,
  })
  const bundle = await build({
    entryPoints: [join(ROOT, 'ui/app.mjs')],
    bundle: true,
    platform: 'browser',
    format: 'iife',
    target: 'chrome120',
    write: false,
    minify: true,
    charset: 'utf8',
    legalComments: 'none',
    loader: { '.svg': 'text' },
    metafile: true,
    logLevel,
  })
  const app = bundle.outputFiles[0].text.replace(/<\/script/gi, '<\\/script')
  const css = await readFile(join(ROOT, 'ui/styles.css'), 'utf8')
  const template = await readFile(join(ROOT, 'ui/index.html'), 'utf8')
  const html = template
    .replace('/*__STYLE__*/', () => css.replace(/<\/style/gi, '<\\/style'))
    .replace('/*__APP__*/', () => app)
  await writeFile(join(dist, 'context.html'), html, 'utf8')
  await writeThirdPartyNotices(dist, [serverBuild.metafile, workerBuild.metafile, bundle.metafile])

  // In the marketplace layout the manifest lives in the install directory, not
  // next to the build source; the host build passes that directory explicitly.
  const installDir = process.env.ZCODE_PLUGIN_INSTALL_DIR?.trim()
  const manifestPath = installDir
    ? join(installDir, '.zcode-plugin/plugin.json')
    : join(ROOT, '.zcode-plugin/plugin.json')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  await writeFile(
    join(dist, 'build.json'),
    JSON.stringify({ name: manifest.name, version: manifest.version, builtAt: new Date().toISOString() }, null, 2),
  )
  if (!quiet) console.log(`built ${manifest.name}@${manifest.version}: dist/server.mjs, dist/worker.mjs, dist/context.html`)
  return manifest
}

/** Copy the freshly built runtime into the dev plugin's installed cache, when present. */
export async function syncInstalled() {
  const configured = process.env.ZCODE_STORAGE_DIR?.trim()
  const storage = configured || join(homedir(), '.zcode')
  const cliRoot = basename(storage) === 'cli' ? storage : join(storage, 'cli')
  const installed = join(cliRoot, 'plugins', 'installed_plugins.json')
  if (!existsSync(installed)) return null
  let parsed
  try {
    parsed = JSON.parse(await readFile(installed, 'utf8'))
  } catch {
    return null
  }
  const entry = parsed?.plugins?.find(
    (plugin) => plugin.name === 'zcode-context-insight' && plugin.marketplace === 'dev-zcode-context-insight',
  )
  if (!entry?.installPath || !existsSync(entry.installPath)) return null
  const target = join(entry.installPath, 'dist')
  await mkdir(target, { recursive: true })
  for (const file of ['server.mjs', 'worker.mjs', 'context.html', 'build.json', 'THIRD_PARTY_NOTICES.txt']) {
    await cp(join(ROOT, 'dist', file), join(target, file))
  }
  return entry.installPath
}
