// @ts-check
/** 只检查兼容层；原版源码、已有验收脚本及本机生成入口各有自己的边界。 */
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)

/** @param {string} directory @returns {string[]} */
function sources(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    if (['node_modules', 'test', 'game', 'dist', 'dist-game'].includes(entry.name)) return []
    const path = join(directory, entry.name)
    return entry.isDirectory() ? sources(path) : /\.(js|mjs)$/.test(entry.name) ? [path] : []
  })
}

const files = ['packages/opencode-piggy', 'packages/opencode-bridge', 'apps/desktop', 'scripts'].flatMap(path => sources(join(root, path)))
const run = spawnSync(process.execPath, [require.resolve('typescript/bin/tsc'), '--noEmit', '--allowJs', '--checkJs',
  '--target', 'es2022', '--module', 'esnext', '--moduleResolution', 'bundler', '--lib', 'es2022,dom',
  '--skipLibCheck', '--noImplicitAny', 'false', '--typeRoots', join(root, 'node_modules/@types'), '--types', 'node',
  ...files], { stdio: 'inherit', cwd: root })
process.exit(run.status ?? 1)
