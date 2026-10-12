// @ts-check
/** 插件启动的纯 Node 守护进程；生产者租约归零只关闭桥，不干预桌宠。 */
import { isAbsolute } from 'node:path'
import { bridgeDirectory } from './paths.js'
import { startStandaloneBridge } from './server.js'

let bridge = null
let stopping = false

/** @param {number} [exitCode] */
async function stop(exitCode = 0) {
  if (stopping) return
  stopping = true
  process.exitCode = exitCode
  try { await bridge?.close() } catch {
    process.stderr.write('独立桥关闭失败\n')
    process.exitCode = 1
  }
}

async function main() {
  const args = process.argv.slice(2)
  if (args.length > 1 || args.some(arg => !arg.startsWith('--directory='))) throw new Error('只接受 --directory=<绝对路径>')
  const supplied = args[0]?.slice('--directory='.length)
  if (supplied !== undefined && (!supplied || !isAbsolute(supplied))) throw new Error('桥目录必须是绝对路径')
  const directory = supplied ?? bridgeDirectory()
  process.on('SIGINT', () => { void stop() })
  process.on('SIGTERM', () => { void stop() })
  if (process.platform === 'win32') process.on('SIGBREAK', () => { void stop() })
  bridge = await startStandaloneBridge({ directory,
    log: message => process.stderr.write(`${message}\n`),
    onIdle: () => { process.exitCode = 0 },
  })
  if (stopping) await bridge.close()
}

main().catch(error => {
  if (error?.code === 'BRIDGE_ALREADY_RUNNING') return
  process.stderr.write(`独立桥启动失败：${error.message}\n`)
  void stop(1)
})
