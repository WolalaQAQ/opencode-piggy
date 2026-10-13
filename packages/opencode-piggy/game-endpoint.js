// @ts-check
/** 通用游戏协议的本机客户端；不加载游戏模块、不读写游戏存档。 */
import { join } from 'node:path'
import { readFile, lstat } from 'node:fs/promises'
import { verifyPrivateWorkFileAsync } from '../opencode-bridge/files.js'

/** @param {{directory:string}} options */
export function createGameEndpoint(options) {
  let identity = ''

  async function discover() {
    const path = join(options.directory, 'endpoint.json')
    const stat = await lstat(path)
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024) throw new Error('invalid game endpoint discovery')
    const nextIdentity = `${stat.dev}:${stat.ino}:${stat.mtimeMs}:${stat.ctimeMs}:${stat.size}`
    if (identity !== nextIdentity) { await verifyPrivateWorkFileAsync(path); identity = nextIdentity }
    const value = JSON.parse(await readFile(path, 'utf8'))
    if (value.version !== 1 || value.role !== 'piggy-work-events' || !Number.isInteger(value.port) ||
        value.port < 1 || value.port > 65535 || !/^[a-f0-9]{64}$/.test(value.token)) throw new Error('invalid game endpoint discovery')
    return value
  }

  return {
    async receive(event) {
      const endpoint = await discover()
      const response = await fetch(`http://127.0.0.1:${endpoint.port}/events`, {
        method: 'POST', headers: { authorization: `Bearer ${endpoint.token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ version: 1, source: 'opencode', ...event }), signal: AbortSignal.timeout(10000), redirect: 'error',
      })
      const value = await response.json()
      if (response.status !== 200 || value.ok !== true || !['applied', 'duplicate', 'ignored'].includes(value.status)) {
        throw new Error('game did not acknowledge work commit')
      }
      return value
    },
  }
}
