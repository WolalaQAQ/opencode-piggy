// @ts-check
/** 检查插件与开发、发布工具的 JavaScript 类型。 */
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
    if (entry.name === 'node_modules') return []
    const path = join(directory, entry.name)
    return entry.isDirectory() ? sources(path) : /\.(js|mjs)$/.test(entry.name) ? [path] : []
  })
}

const files = ['packages/opencode-piggy', 'scripts'].flatMap(path => sources(join(root, path)))
const run = spawnSync(process.execPath, [require.resolve('typescript/bin/tsc'), '--noEmit', '--allowJs', '--checkJs',
  '--target', 'es2022', '--module', 'esnext', '--moduleResolution', 'bundler', '--lib', 'es2022,dom',
  '--skipLibCheck', '--noImplicitAny', 'false', '--typeRoots', join(root, 'node_modules/@types'), '--types', 'node',
  ...files], { stdio: 'inherit', cwd: root })
process.exit(run.status ?? 1)
