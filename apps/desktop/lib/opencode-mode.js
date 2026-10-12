// @ts-check
/** 手动运行的游戏接收适配只主动连接桥，不启动桥或管理其生命周期。 */
import { piggyDirectory } from './opencode-paths.js'
import { bridgeDirectory } from '../../../packages/opencode-bridge/paths.js'
import { createReceiverClient } from '../../../packages/opencode-piggy/receiver-client.js'
import { createWorkLedger, recoverWorkLedger } from './work-ledger.js'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { persistGameState } from './game-writer.js'

/** @param {string[]} args */
export function opencodeMode(args) {
  const isEnabled = args.includes('--opencode')
  const directory = args.find(arg => arg.startsWith('--piggy-opencode-home='))?.split('=').slice(1).join('=')
  const bridgeHome = args.find(arg => arg.startsWith('--piggy-bridge-home='))?.split('=').slice(1).join('=')
  return { isEnabled, directory: piggyDirectory({ directory }),
    bridgeDirectory: bridgeDirectory({ directory: bridgeHome }),
    shouldExit: args.includes('--piggy-exit-disconnected') }
}

/** 恢复必须早于打开 Store，否则旧的内存快照可能覆盖已重放的存档。 */
export async function recoverOpenCodeWork(options) {
  const { writeStateFile: originalWriter } = await import(pathToFileURL(join(options.gameDir, 'store/state-file.js')).href)
  const writeStateFile = (path, state) => persistGameState(originalWriter, path, state)
  return recoverWorkLedger({ directory: options.directory, statePath: options.statePath, writeStateFile })
}

/** @param {{directory:string,bridgeDirectory?:string,statePath:string,host:any,announce:()=>void,log:(message:string)=>void}} options */
export async function startOpenCodeWork(options) {
  const ledger = createWorkLedger({ directory: options.directory, statePath: options.statePath,
    store: options.host.store, feed: options.host.feedCore, settleAchievements: options.host.settleAchievements,
    log: options.log, writeStateFile: options.host.writeStateFile })
  const client = createReceiverClient({ directory: options.bridgeDirectory ?? bridgeDirectory(), log: options.log,
    receive: event => {
      const result = ledger.receive(event)
      if (!result.duplicate) options.announce()
      return result
    } })
  client.start()
  return { close: () => client.close() }
}
