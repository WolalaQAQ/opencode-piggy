// @ts-check
/** 下载固定版本的构建依赖及 Electron，直接解包，不运行依赖安装脚本。 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const downloads = join(root, '.local/release-downloads')
const readJSON = path => JSON.parse(readFileSync(path, 'utf8'))
const dependencies = readJSON(join(root, 'scripts/release-dependencies.json'))

/** @param {string} command @param {string[]} args */
function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit', windowsHide: true })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} 退出码 ${result.status}`)
}

/** @param {string} url @param {string} target */
async function download(url, target) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`下载失败：HTTP ${response.status} ${url}`)
  writeFileSync(target, Buffer.from(await response.arrayBuffer()))
}

/** @param {string} name @param {string} version @param {string} modules */
async function installPackage(name, version, modules) {
  const target = join(modules, name)
  if (existsSync(target)) {
    if (readJSON(join(target, 'package.json')).version !== version) {
      throw new Error(`依赖版本不符：${name}，请在干净目录准备发布依赖`)
    }
    return
  }
  const basename = name.split('/').at(-1)
  const archive = join(downloads, `${name.replace('/', '-')}-${version}.tgz`)
  await download(`https://registry.npmjs.org/${name}/-/${basename}-${version}.tgz`, archive)
  mkdirSync(target, { recursive: true })
  run('tar', ['-xf', archive, '--strip-components', '1', '-C', target])
  console.log(`已准备 ${name}@${version}`)
}

async function main() {
  if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('发布依赖需要 Windows x64')
  const desktop = readJSON(join(root, 'apps/desktop/package.json'))
  const project = readJSON(join(root, 'package.json'))
  for (const [name, version] of Object.entries(project.devDependencies)) {
    if (dependencies.root[name] !== version) throw new Error(`请同步发布依赖版本：${name}`)
  }
  for (const [name, version] of Object.entries({ ...desktop.devDependencies, ...desktop.dependencies, ...desktop.overrides })) {
    if (dependencies.desktop[name] !== version) throw new Error(`请同步发布依赖版本：${name}`)
  }
  mkdirSync(downloads, { recursive: true })
  for (const [name, version] of Object.entries(dependencies.root)) await installPackage(name, String(version), join(root, 'node_modules'))
  const modules = join(root, 'apps/desktop/node_modules')
  for (const [name, version] of Object.entries(dependencies.desktop)) await installPackage(name, String(version), modules)
  const electron = join(modules, 'electron')
  if (!existsSync(join(electron, 'dist/electron.exe'))) {
    const archive = join(downloads, `electron-${dependencies.desktop.electron}-win32-x64.zip`)
    await download(`https://github.com/electron/electron/releases/download/v${dependencies.desktop.electron}/electron-v${dependencies.desktop.electron}-win32-x64.zip`, archive)
    // Electron 包入口通过 path.txt 定位运行时；下载内容单独放入 dist。
    const result = spawnSync('powershell.exe', ['-NoProfile', '-Command',
      'Expand-Archive -LiteralPath $env:PIGGY_ELECTRON_ARCHIVE -DestinationPath $env:PIGGY_ELECTRON_DIST -Force'],
    { stdio: 'inherit', windowsHide: true, env: { ...process.env,
      PIGGY_ELECTRON_ARCHIVE: archive, PIGGY_ELECTRON_DIST: join(electron, 'dist') } })
    if (result.error) throw result.error
    if (result.status !== 0) throw new Error(`Electron 解包失败：${result.status}`)
  }
  writeFileSync(join(electron, 'path.txt'), 'electron.exe')
  console.log('Windows 发布依赖已准备')
}

try { await main() } catch (error) { console.error(error.message); process.exitCode = 1 }
