// @ts-check
/** 带进程出生标识的目录锁；只移除已证实死亡的所有者，不能覆盖活跃实例。 */
import { execFile } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { lstat, mkdir, open, readFile, readdir, rename, rmdir, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { secureWorkDirectory, verifyPrivateWorkFile } from './files.js'

/** @typedef {{version:1, pid:number, started:string, nonce:string}} LockOwner */

/** @param {string} command @param {string[]} args @param {NodeJS.ProcessEnv} [env] */
function run(command, args, env = process.env) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { env, windowsHide: true, timeout: 10000, maxBuffer: 16 * 1024 },
      (error, stdout) => error ? reject(error) : resolve(stdout.trim()))
  })
}

/** @param {number} pid @returns {Promise<string|null>} */
async function processIdentity(pid) {
  try { process.kill(pid, 0) } catch (error) {
    if (error?.code === 'ESRCH') return null
    throw error
  }
  try {
    if (process.platform === 'win32') {
      const result = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
        '$ErrorActionPreference = "Stop"; try { $p = [System.Diagnostics.Process]::GetProcessById([int]$env:PIGGY_BRIDGE_PID); $p.StartTime.ToUniversalTime().Ticks.ToString() } catch [System.ArgumentException] { "missing" }'],
      { ...process.env, PIGGY_BRIDGE_PID: String(pid) })
      if (result === 'missing') return null
      if (!/^\d+$/.test(result)) throw new Error('无法核对桥进程出生标识')
      return `win32:${result}`
    }
    if (process.platform === 'linux') {
      const stat = await readFile(`/proc/${pid}/stat`, 'utf8')
      const started = stat.slice(stat.lastIndexOf(')') + 2).trim().split(/\s+/)[19]
      if (!/^\d+$/.test(started ?? '')) throw new Error('无法核对桥进程出生标识')
      return `linux:${started}`
    }
    const result = await run('ps', ['-p', String(pid), '-o', 'lstart='], { ...process.env, LC_ALL: 'C', TZ: 'UTC' })
    if (!result) return null
    return `${process.platform}:${result}`
  } catch (error) {
    try { process.kill(pid, 0) } catch (probeError) {
      if (probeError?.code === 'ESRCH') return null
    }
    throw error
  }
}

/** @param {string} directory */
async function checkDirectory(directory) {
  const stat = await lstat(directory)
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('桥进程锁不是普通目录')
  if (process.platform !== 'win32' && (stat.uid !== process.getuid() || (stat.mode & 0o077) !== 0)) {
    throw new Error('桥进程锁目录不私有')
  }
}

/** @param {string} directory @returns {Promise<{owner:LockOwner,name:string}|null>} */
async function readOwner(directory) {
  try { await checkDirectory(directory) } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw error
  }
  let names
  try { names = await readdir(directory) } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw error
  }
  if (!names.length) return { owner: null, name: '' }
  if (names.length !== 1 || !/^[a-f0-9]{32}\.json$/.test(names[0])) throw new Error('桥进程锁损坏，保留原目录')
  const path = join(directory, names[0])
  try {
    verifyPrivateWorkFile(path)
    const stat = await lstat(path)
    if (stat.size > 1024) throw new Error('桥进程锁文件过大')
    const value = JSON.parse(await readFile(path, 'utf8'))
    if (!value || Object.keys(value).sort().join(',') !== 'nonce,pid,started,version' || value.version !== 1 ||
        !Number.isSafeInteger(value.pid) || value.pid <= 0 || typeof value.started !== 'string' || !value.started ||
        value.nonce !== names[0].slice(0, -5)) throw new Error('桥进程锁结构无效，保留原目录')
    return { owner: value, name: names[0] }
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw error
  }
}

/** @param {string} directory @returns {Promise<()=>Promise<void>>} */
export async function acquireBridgeLock(directory) {
  secureWorkDirectory(directory)
  const started = await processIdentity(process.pid)
  if (!started) throw new Error('无法建立当前桥进程标识')
  const nonce = randomBytes(16).toString('hex')
  const name = `${nonce}.json`
  const fixed = join(directory, 'daemon.lock')
  const candidate = join(directory, `daemon.lock.${nonce}.tmp`)
  const owner = /** @type {LockOwner} */ ({ version: 1, pid: process.pid, started, nonce })
  await mkdir(candidate, { mode: 0o700 })
  let published = false
  try {
    const handle = await open(join(candidate, name), 'wx', 0o600)
    try { await handle.writeFile(JSON.stringify(owner)); await handle.sync() } finally { await handle.close() }
    // 完整且非空的目录一次发布；回收者的 rmdir 永远不能移除新实例。
    for (let attempt = 0; attempt < 32; attempt++) {
      try { await rename(candidate, fixed); published = true; break } catch (error) {
        if (!['EEXIST', 'ENOTEMPTY', 'EPERM', 'EACCES'].includes(error?.code)) throw error
        const current = await readOwner(fixed)
        if (current?.owner) {
          const identity = await processIdentity(current.owner.pid)
          if (identity === current.owner.started) {
            throw Object.assign(new Error('独立桥已在运行'), { code: 'BRIDGE_ALREADY_RUNNING' })
          }
          // 文件名绑定随机所有者；迟到的回收只能删除旧标记，不能删新标记。
          try { await unlink(join(fixed, current.name)) } catch (removeError) {
            if (removeError?.code !== 'ENOENT') throw removeError
          }
        }
        try { await rmdir(fixed) } catch (removeError) {
          if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(removeError?.code)) throw removeError
        }
      }
    }
    if (!published) throw new Error('桥进程锁竞争过多')
  } finally {
    if (!published) {
      try { await unlink(join(candidate, name)) } catch (error) { if (error?.code !== 'ENOENT') throw error }
      try { await rmdir(candidate) } catch (error) { if (error?.code !== 'ENOENT') throw error }
    }
  }
  let released = false
  return async () => {
    if (released) return
    released = true
    try { await unlink(join(fixed, name)) } catch (error) { if (error?.code !== 'ENOENT') throw error }
    try { await rmdir(fixed) } catch (error) {
      if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(error?.code)) throw error
    }
  }
}
