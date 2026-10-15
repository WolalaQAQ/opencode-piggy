// @ts-check
/** 插件队列与官方游戏发现目录各自独立。 */
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

/** @typedef {{platform?:string,env?:NodeJS.ProcessEnv,home?:string}} PlatformOptions */

/** @param {string} name @param {PlatformOptions} options */
function configurationDirectory(name, options) {
  const env = options.env ?? process.env
  const home = options.home ?? homedir()
  const platform = options.platform ?? process.platform
  if (platform === 'win32') return join(env.APPDATA || join(home, 'AppData', 'Roaming'), name)
  if (platform === 'darwin') return join(home, 'Library', 'Application Support', name)
  return join(env.XDG_CONFIG_HOME || join(home, '.config'), name)
}

/** @param {PlatformOptions & {directory?:string}} [options] */
export function pluginDirectory(options = {}) {
  return options.directory ? resolve(options.directory) : configurationDirectory('opencode-piggy-plugin', options)
}

/** 显式目录优先；默认只尝试官方安装版和源码版的已知目录，不扫描用户文件。
 * @param {PlatformOptions & {gameDirectory?:string}} [options]
 */
export function gameDirectories(options = {}) {
  if (options.gameDirectory) return [resolve(options.gameDirectory)]
  const env = options.env ?? process.env
  if (env.PIGGY_USERDATA) return [join(resolve(env.PIGGY_USERDATA), 'work-endpoint')]
  return ['dsh-piggy', 'dsh-piggy-desktop'].map(name => join(configurationDirectory(name, options), 'work-endpoint'))
}
