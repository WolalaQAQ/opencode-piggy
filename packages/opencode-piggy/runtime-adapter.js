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
