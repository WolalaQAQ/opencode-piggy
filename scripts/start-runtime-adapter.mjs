// @ts-check
/** 手动运行原型适配器；现有插件、桥和已安装桌宠不自动切换。 */
import { resolve } from 'node:path'
import { createRuntimeAdapter } from '../packages/opencode-piggy/runtime-adapter.js'
import { bridgeDirectory } from '../packages/opencode-bridge/paths.js'

const value = key => process.argv.find(arg => arg.startsWith(`--${key}=`))?.slice(key.length + 3)
const gameDirectory = value('game-endpoint')
const bridgeHome = value('bridge-home')
if (!gameDirectory || !bridgeHome) throw new Error('use --game-endpoint=/path/to/work-endpoint --bridge-home=/path/to/isolated-bridge')
const adapter = createRuntimeAdapter({ gameDirectory: resolve(gameDirectory),
  bridgeDirectory: bridgeDirectory({ directory: bridgeHome }), log: message => console.warn(`[opencode-adapter] ${message}`) })
adapter.start()
const keepAlive = setInterval(() => {}, 60000)
let closing
const close = () => closing ??= adapter.close().then(() => clearInterval(keepAlive))
process.on('SIGINT', close)
process.on('SIGTERM', close)
