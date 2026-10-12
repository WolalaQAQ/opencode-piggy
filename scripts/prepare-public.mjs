// @ts-check
/** 按公开文件清单准备独立仓库，不复制旧历史、子模块源码或本机开发资料。 */
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const destination = resolve(root, process.argv[2] ?? '.local/public/opencode-piggy')
const entries = [
  '.gitattributes', '.gitignore', '.gitmodules', '.github/workflows/release.yml',
  'LICENSE', 'THIRD-PARTY.md', 'README.md', 'README.en.md',
  'CHANGELOG.md', 'CHANGELOG.en.md', 'package.json',
  'core.js', 'store.js', 'store/state-file.js',
  'docs/README.md', 'docs/guides/opencode.md', 'docs/guides/releasing.md',
  'apps/desktop/.gitignore', 'apps/desktop/package.json', 'apps/desktop/main.js',
  'apps/desktop/integrate-main.js', 'apps/desktop/lib', 'apps/desktop/installer',
  'packages/opencode-piggy', 'packages/opencode-bridge',
  'scripts/build-windows.mjs', 'scripts/check-upstream.mjs', 'scripts/install-opencode.mjs',
  'scripts/start-opencode.mjs', 'scripts/typecheck.mjs', 'scripts/windows-icon.ps1',
  'scripts/prepare-release.mjs', 'scripts/release-dependencies.json',
  'scripts/release-notes.mjs', 'scripts/prepare-public.mjs',
]
const files = []

/** @param {string} directory @param {string[]} args @returns {string} */
function git(directory, args) {
  const result = spawnSync('git', args, { cwd: directory, encoding: 'utf8', windowsHide: true })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(result.stderr.trim())
  return result.stdout.trim()
}

/** @param {string} entry */
function copy(entry) {
  const source = join(root, entry)
  const info = lstatSync(source)
  if (info.isSymbolicLink()) throw new Error(`公开文件清单不接受符号链接：${entry}`)
  if (info.isDirectory()) {
    for (const name of readdirSync(source)) {
      if (['node_modules', 'test', 'tests', 'AGENTS.md', 'CLAUDE.md', 'lessons.md'].includes(name)) continue
      copy(`${entry}/${name}`)
    }
  } else {
    mkdirSync(dirname(join(destination, entry)), { recursive: true })
    copyFileSync(source, join(destination, entry))
    files.push(entry)
  }
}

try {
  if (existsSync(destination)) throw new Error(`暂存目录已存在，请选择新的目录：${destination}`)
  const link = git(root, ['ls-files', '--stage', 'upstream/dsh-piggy']).split(/\s+/)
  if (link[0] !== '160000') throw new Error('上游必须是已跟踪的 Git submodule')
  mkdirSync(destination, { recursive: true })
  for (const entry of entries) copy(entry)
  git(destination, ['init', '--initial-branch=main'])
  git(destination, ['add', '.'])
  git(destination, ['update-index', '--add', '--cacheinfo', `160000,${link[1]},upstream/dsh-piggy`])
  console.log(`公开源码已准备：${destination}`)
  console.log(`文件 ${files.length} 个，另保留固定上游 gitlink；无提交、无远端、未推送。`)
} catch (error) { console.error(error.message); process.exitCode = 1 }
