// @ts-check
/** 只在桥接离线时启动原版 Electron；短期启动锁避免多个项目同时唤醒。 */
import childProcess from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { createRequire } from 'node:module'
import { lstat, mkdir, open, rmdir, unlink, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { secureWorkDirectoryAsync } from '../../apps/desktop/lib/work-files.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const LAUNCH_MS = 15000
const STALE_MS = 30000

/** @param {{directory:string, executable?:string, autoStart?:boolean, exitWhenDisconnected?:boolean}} options */
export function createLauncher(options) {
  const directory = resolve(options.directory)
  return async () => {
    if (options.autoStart === false) return
    await secureWorkDirectoryAsync(directory)
    const lock = join(directory, 'launch.lock')
    const owner = randomBytes(32).toString('hex')
    if (!(await acquire(lock, owner))) return
    let hasSpawned = false
    try {
      const executable = options.executable || createRequire(join(root, 'apps/desktop/package.json'))('electron')
      const args = options.executable ? [] : [join(root, 'apps/desktop')]
      args.push('--opencode', `--piggy-opencode-home=${directory}`)
      if (options.exitWhenDisconnected) args.push('--piggy-exit-disconnected')
      const env = { ...process.env }
      delete env.ELECTRON_RUN_AS_NODE
      const child = childProcess.spawn(executable, args, { detached: true, stdio: 'ignore', windowsHide: true, env })
      await new Promise((done, reject) => { child.once('spawn', done); child.once('error', reject) })
      hasSpawned = true
      child.unref()
    } finally {
      if (!hasSpawned) await release(lock, owner)
      // 成功后留十五秒启动窗口；Electron 自身的 userData 单实例锁才是唯一写档保障。
      else {
        const timer = setTimeout(() => release(lock, owner).catch(() => console.warn('[opencode-piggy] launch lock cleanup failed')), LAUNCH_MS)
        timer.unref()
      }
    }
  }
}

async function acquire(lock, owner) {
  let hasCreated = false
  try {
    await mkdir(lock, { mode: 0o700 })
    hasCreated = true
    await writeFile(join(lock, 'owner'), owner, { mode: 0o600 })
    await writeFile(join(lock, 'time'), String(Date.now()), { mode: 0o600 })
    return true
  } catch (error) {
    if (hasCreated) {
      await release(lock, owner)
      throw error
    }
    if (error.code !== 'EEXIST') throw error
    const info = await lstat(lock)
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('invalid launch lock')
    const time = Number(await readLock(join(lock, 'time'), String(info.mtimeMs)))
    if (!Number.isFinite(time) || Date.now() - time <= STALE_MS) return false
    const previous = await readLock(join(lock, 'owner'), '')
    await release(lock, previous)
    return acquire(lock, owner)
  }
}

async function release(lock, owner) {
  try {
    const current = await readLock(join(lock, 'owner'), '')
    if (current !== owner) return
    if (owner) await unlink(join(lock, 'owner'))
    await unlink(join(lock, 'time')).catch(error => { if (error.code !== 'ENOENT') throw error })
    await rmdir(lock)
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
}

/** 锁是固定短元数据；损坏文件不能让共享服务读入任意大小的内容。 */
async function readLock(path, fallback) {
  try {
    const info = await lstat(path)
    if (!info.isFile() || info.isSymbolicLink() || info.size > 128) throw new Error('invalid launch lock')
    const file = await open(path, 'r')
    try {
      const data = Buffer.alloc(129)
      const { bytesRead } = await file.read(data, 0, data.length, 0)
      if (bytesRead > 128) throw new Error('invalid launch lock')
      return data.subarray(0, bytesRead).toString('utf8')
    } finally { await file.close() }
  } catch (error) {
    if (error.code === 'ENOENT') return fallback
    throw error
  }
}
