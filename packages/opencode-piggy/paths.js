// @ts-check
/** 插件队列与官方游戏发现目录各自独立。 */
import { lstat, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path'

/** @typedef {{platform?:string,env?:NodeJS.ProcessEnv,home?:string}} PlatformOptions */
/** @typedef {{directory:string}|{userData:string[]}} GameDiscovery */

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

/** 显式接口目录优先；默认先找官方统一数据目录，再回退到旧版已知目录。
 * @param {PlatformOptions & {gameDirectory?:string}} [options]
 * @returns {GameDiscovery}
 */
export function gameDiscovery(options = {}) {
  if (options.gameDirectory) return { directory: resolve(options.gameDirectory) }
  const env = options.env ?? process.env
  if (env.PIGGY_USERDATA) return { userData: [resolve(env.PIGGY_USERDATA)] }
  const platform = options.platform ?? process.platform
  const home = options.home ?? homedir()
  const dataRoot = env.XDG_DATA_HOME && isAbsolute(env.XDG_DATA_HOME) ? env.XDG_DATA_HOME : join(home, '.local', 'share')
  const directory = platform === 'linux' ? join(dataRoot, 'piggy') : configurationDirectory('piggy', options)
  return { userData: [directory, ...['dsh-piggy', 'dsh-piggy-desktop'].map(name => configurationDirectory(name, options))] }
}

/** @param {string} userData */
async function activeArchiveEndpoint(userData) {
  const file = join(userData, 'owner-archive-selection.json')
  try {
    const info = await lstat(file)
    if (!info.isFile() || info.size > 4096) return
    const selection = JSON.parse(await readFile(file, 'utf8'))
    const document = selection?.active?.ownerDocumentPath
    if (selection?.version !== 1 || typeof document !== 'string' || !isAbsolute(document) || document.includes('\0')) return
    const archive = relative(join(userData, 'owner-archives'), document)
    if (isAbsolute(archive) || archive.startsWith(`..${sep}`) || basename(archive) !== 'owner-document.json') return
    return `${resolve(document)}.work-events`
  } catch (error) {
    if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error
  }
}

/** 每次发现只读取已生效的存档选择，不绑定启动时的存档。
 * @param {GameDiscovery} discovery
 */
export async function* gameDirectories(discovery) {
  if ('directory' in discovery) {
    yield discovery.directory
    return
  }
  for (const userData of discovery.userData) {
    const archiveEndpoint = await activeArchiveEndpoint(userData)
    if (archiveEndpoint) yield archiveEndpoint
    yield join(userData, 'work-endpoint')
  }
}
