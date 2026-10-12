// @ts-check
/** 插件只唤醒独立 Node 桥；跨进程排他由桥自身负责，不叠加目录锁。 */
import childProcess from 'node:child_process'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { secureWorkDirectoryAsync } from '../opencode-bridge/files.js'

const DAEMON = fileURLToPath(new URL('../opencode-bridge/daemon.js', import.meta.url))
const LAUNCH_MS = 15000
const launches = new Map()

/** @param {{directory:string,nodeExecutable?:string,autoStart?:boolean}} options */
export function createBridgeLauncher(options) {
  const directory = resolve(options.directory)
  return () => {
    if (options.autoStart === false) return Promise.resolve()
    if (launches.has(directory)) return launches.get(directory)
    const launching = launchBridge({ ...options, directory })
    launches.set(directory, launching)
    void launching.then(() => {
      const timer = setTimeout(() => { if (launches.get(directory) === launching) launches.delete(directory) }, LAUNCH_MS)
      timer.unref()
    }, () => { if (launches.get(directory) === launching) launches.delete(directory) })
    return launching
  }
}

async function launchBridge(options) {
  await secureWorkDirectoryAsync(options.directory)
  // OpenCode 可以运行于 Bun/打包可执行文件，不能把其 execPath 当成 Node。
  const executable = options.nodeExecutable || process.env.PIGGY_BRIDGE_NODE ||
    (Reflect.get(process.versions, 'bun') || process.versions.electron ? 'node' : process.execPath)
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  const child = childProcess.spawn(executable, [DAEMON, `--directory=${options.directory}`],
    { detached: true, stdio: 'ignore', windowsHide: true, env })
  await new Promise((done, reject) => { child.once('spawn', done); child.once('error', reject) })
  child.unref()
}
