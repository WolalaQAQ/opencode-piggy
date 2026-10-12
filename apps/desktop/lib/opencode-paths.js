// @ts-check
/** OpenCode 模式的用户目录独立于原桌面版；随外壳打包，插件复用这一个定义。 */
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

/** @param {{ directory?: string, platform?: string, env?: NodeJS.ProcessEnv, home?: string }} [options] */
export function piggyDirectory(options = {}) {
  const env = options.env ?? process.env
  if (options.directory || env.PIGGY_OPENCODE_HOME) return resolve(options.directory || env.PIGGY_OPENCODE_HOME)
  const home = options.home ?? homedir()
  const platform = options.platform ?? process.platform
  if (platform === 'win32') return join(env.APPDATA || join(home, 'AppData', 'Roaming'), 'opencode-piggy')
  if (platform === 'darwin') return join(home, 'Library', 'Application Support', 'opencode-piggy')
  return join(env.XDG_CONFIG_HOME || join(home, '.config'), 'opencode-piggy')
}
