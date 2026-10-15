// @ts-check
/** 按插件白名单生成自包含的 tgz 与 ZIP 发布包。 */
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pluginRoot = join(root, 'packages/opencode-piggy')
const tar = process.platform === 'win32' ? 'tar.exe' : process.platform === 'darwin' ? 'tar' : 'bsdtar'

/** @param {string[]} args */
function archive(args) {
  const run = spawnSync(tar, args, { stdio: 'inherit' })
  if (run.error) throw run.error
  if (run.status !== 0) throw new Error(`归档失败：${tar}，退出码 ${run.status}`)
}

try {
  const project = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  const plugin = JSON.parse(readFileSync(join(pluginRoot, 'package.json'), 'utf8'))
  if (project.version !== plugin.version) throw new Error('根目录与插件的 package.json 版本不一致')

  const tool = spawnSync(tar, ['--version'], { encoding: 'utf8' })
  if (tool.error || tool.status !== 0 || !tool.stdout.includes('bsdtar')) {
    throw new Error('打包需要 libarchive/bsdtar：Windows 使用系统 tar.exe，macOS 使用系统 tar，Linux 请安装 libarchive-tools 并提供 bsdtar')
  }

  const tempRoot = join(tmpdir(), 'opencode')
  mkdirSync(tempRoot, { recursive: true })
  const stage = mkdtempSync(join(tempRoot, 'piggy-pack-'))
  try {
    const packageDirectory = join(stage, 'package')
    mkdirSync(packageDirectory)
    for (const file of new Set([...plugin.files, 'package.json', 'LICENSE'])) {
      mkdirSync(dirname(join(packageDirectory, file)), { recursive: true })
      copyFileSync(join(pluginRoot, file), join(packageDirectory, file))
    }
    for (const file of ['README.md', 'README.en.md']) {
      copyFileSync(join(root, file), join(packageDirectory, file))
    }

    const base = `${plugin.name}-${plugin.version}`
    const tgz = join(stage, `${base}.tgz`)
    const zip = join(stage, `${base}.zip`)
    archive(['-c', '--format=ustar', '-z', '-f', tgz, '-C', stage, 'package'])
    archive(['-c', '--format=zip', '-f', zip, '-C', stage, 'package'])

    const dist = join(root, 'dist')
    mkdirSync(dist, { recursive: true })
    for (const extension of ['tgz', 'zip']) {
      const name = `${base}.${extension}`
      const destination = join(dist, name)
      copyFileSync(join(stage, name), destination)
      console.log(`已生成 ${destination}（${statSync(destination).size} 字节）`)
    }
  } finally {
    rmSync(stage, { recursive: true, force: true })
  }
} catch (error) {
  console.error(`插件打包失败：${error.message}`)
  process.exitCode = 1
}
