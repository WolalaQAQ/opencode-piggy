// @ts-check
/** 从固定子模块和已准备的运行时构建 Windows 安装包，不修改上游，不发布。 */
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { GAME_FILES } from '../upstream/dsh-piggy/apps/desktop/scripts/pack-game.mjs'
import { checkUpstream } from './check-upstream.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const upstream = join(root, 'upstream/dsh-piggy')
const desktop = join(root, 'apps/desktop')
const requireDesktop = createRequire(join(desktop, 'package.json'))
const readJSON = path => JSON.parse(readFileSync(path, 'utf8'))

/** @param {string} command @param {string[]} args */
function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', windowsHide: true })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} 退出码 ${result.status}`)
}

/** 保留依赖包自己的解析层级和许可，不把构建依赖带入产物。 */
function copyDependency(name, parentRequire, modules) {
  const source = dirname(parentRequire.resolve(`${name}/package.json`))
  const target = join(modules, name)
  cpSync(source, target, { recursive: true,
    filter: path => !relative(source, path).split(sep).some(part => ['node_modules', 'test', 'tests'].includes(part)) })
  const metadata = readJSON(join(source, 'package.json'))
  const requirePackage = createRequire(join(source, 'package.json'))
  for (const dependency of Object.keys(metadata.dependencies ?? {})) {
    copyDependency(dependency, requirePackage, join(target, 'node_modules'))
  }
}

async function main() {
  if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('当前构建入口需要 Windows x64 Node')
  checkUpstream()
  const game = readJSON(join(upstream, 'package.json'))
  const adapter = readJSON(join(desktop, 'package.json'))
  const compatibility = readJSON(join(root, 'package.json'))
  const output = join(root, 'dist')
  const stage = join(output, 'win-x64-unpacked')
  const marker = join(stage, 'opencode-piggy-install.json')
  if (existsSync(stage)) {
    if (!existsSync(marker)) throw new Error(`不覆盖未知目录：${stage}`)
    rmSync(stage, { recursive: true })
  }
  mkdirSync(output, { recursive: true })
  const electron = requireDesktop('electron')
  cpSync(dirname(electron), stage, { recursive: true })
  rmSync(join(stage, 'resources/default_app.asar'))
  renameSync(join(stage, 'electron.exe'), join(stage, 'OpenCodePiggy.exe'))
  writeFileSync(marker, JSON.stringify({ product: 'opencode-piggy', game: game.version,
    compatibility: compatibility.version, shell: adapter.version, node: process.version }, null, 2) + '\n')

  const app = join(stage, 'resources/app')
  mkdirSync(app, { recursive: true })
  writeFileSync(join(app, 'package.json'), JSON.stringify({ name: 'opencode-piggy-desktop',
    version: adapter.version, private: true, type: 'module', main: 'apps/desktop/main.js' }, null, 2) + '\n')
  const copy = (sourceRoot, entries, targetRoot) => {
    for (const entry of entries) cpSync(join(sourceRoot, entry), join(targetRoot, entry), { recursive: true })
  }
  copy(root, ['LICENSE', 'THIRD-PARTY.md', 'packages/opencode-piggy', 'packages/opencode-bridge',
    'apps/desktop/main.js', 'apps/desktop/integrate-main.js', 'apps/desktop/lib',
    'scripts/install-opencode.mjs'], app)
  copy(upstream, [...GAME_FILES, 'LICENSE', 'apps/desktop/main.js', 'apps/desktop/preload.cjs',
    'apps/desktop/first-run.js', 'apps/desktop/first-run-preload.cjs', 'apps/desktop/lib',
    'apps/desktop/renderer', 'apps/desktop/build'], join(app, 'upstream/dsh-piggy'))
  copyDependency('electron-updater', requireDesktop, join(app, 'apps/desktop/node_modules'))

  // 桥使用真正的独立 Node，而不是以小猪可执行文件冒充 Node。
  const nodeDirectory = join(stage, 'resources/bridge-node')
  mkdirSync(nodeDirectory)
  cpSync(process.execPath, join(nodeDirectory, 'node.exe'))
  const license = await fetch(`https://raw.githubusercontent.com/nodejs/node/${process.version}/LICENSE`)
  if (!license.ok) throw new Error(`Node 许可下载失败：HTTP ${license.status}`)
  writeFileSync(join(nodeDirectory, 'LICENSE'), await license.text())
  run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
    join(root, 'scripts/windows-icon.ps1'), '-Source', join(upstream, 'apps/desktop/build/icon.png'),
    '-Target', join(stage, 'icon.ico')])

  const installer = join(output, `opencode-piggy-setup-game-${game.version}-${compatibility.version}-x64.exe`)
  run(process.env.MAKENSIS || 'makensis.exe', ['/V2', '/INPUTCHARSET', 'UTF8', `/DSTAGE=${stage}`, `/DOUTPUT=${installer}`,
    `/DGAME_VERSION=${game.version}`, `/DCOMPAT_VERSION=${compatibility.version}`,
    join(root, 'apps/desktop/installer/windows.nsi')])
  console.log(`安装包：${installer}（${(statSync(installer).size / 1024 / 1024).toFixed(1)} MiB）`)
}

try { await main() } catch (error) { console.error(`Windows 打包失败：${error.message}`); process.exitCode = 1 }
