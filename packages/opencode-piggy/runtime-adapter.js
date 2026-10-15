// @ts-check
/** OpenCode 桥到通用游戏接口的适配器，游戏不反向导入 OpenCode 代码。 */
import { createReceiverClient } from './receiver-client.js'
import { createGameEndpoint } from './game-endpoint.js'

/** @param {{bridgeDirectory:string,gameDirectory:string,log?:(message:string)=>void}} options */
export function createRuntimeAdapter(options) {
  const endpoint = createGameEndpoint({ directory: options.gameDirectory })
  return createReceiverClient({ directory: options.bridgeDirectory,
    receive: event => endpoint.receive(event), log: options.log })
}

const sharedAdapters = new Map()

/** 同一 OpenCode 服务中的多个项目共用一个 HTTP 接收者。
 * @param {{bridgeDirectory:string,gameDirectory:string,log?:(message:string)=>void}} options
 */
export function retainRuntimeAdapter(options) {
  const key = JSON.stringify([options.bridgeDirectory, options.gameDirectory])
  let shared = sharedAdapters.get(key)
  if (!shared) {
    const adapter = createRuntimeAdapter(options)
    adapter.start()
    shared = { adapter, users: 0 }
    sharedAdapters.set(key, shared)
  }
  shared.users++
  return async () => {
    if (--shared.users === 0) {
      sharedAdapters.delete(key)
      await shared.adapter.close()
    }
  }
}
