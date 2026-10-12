// @ts-check
/** 复用原版路由宿主，只补充工作账本所需的原 core 和存档 writer。 */
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { startHost as startOriginalHost } from '../../../upstream/dsh-piggy/apps/desktop/lib/host.js'
import { persistGameState } from './game-writer.js'

/** @param {string} gameDir @param {string} statePath
 * @param {{fetch?:typeof globalThis.fetch,onSnapshot?:(view:any)=>void}} [options] */
export async function startHost(gameDir, statePath, options = {}) {
  const { feed: feedCore, settleAchievements } = await import(pathToFileURL(join(gameDir, 'core.js')).href)
  const { writeStateFile: originalWriter } = await import(pathToFileURL(join(gameDir, 'store/state-file.js')).href)
  const writeStateFile = (path, state) => persistGameState(originalWriter, path, state)
  const host = await startOriginalHost(gameDir, statePath, options)
  return { ...host, feedCore, settleAchievements, writeStateFile }
}
