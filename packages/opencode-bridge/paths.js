// @ts-check
/** 桥的通信与队列目录独立于小猪存档，不把旧游戏桥误认为独立桥。 */
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

/** @param {{directory?:string,platform?:string,env?:NodeJS.ProcessEnv,home?:string}} [options] */
export function bridgeDirectory(options = {}) {
  const env = options.env ?? process.env
  if (options.directory || env.PIGGY_BRIDGE_HOME) return resolve(options.directory || env.PIGGY_BRIDGE_HOME)
  const home = options.home ?? homedir()
  const platform = options.platform ?? process.platform
  if (platform === 'win32') return join(env.APPDATA || join(home, 'AppData', 'Roaming'), 'opencode-piggy-bridge')
  if (platform === 'darwin') return join(home, 'Library', 'Application Support', 'opencode-piggy-bridge')
  return join(env.XDG_CONFIG_HOME || join(home, '.config'), 'opencode-piggy-bridge')
}
