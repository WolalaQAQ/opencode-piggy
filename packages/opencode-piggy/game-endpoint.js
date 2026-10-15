// @ts-check
/** 通用游戏协议的本机客户端；不加载游戏模块、不读写游戏存档。 */
import { join } from 'node:path'
import { constants } from 'node:fs'
import { lstat, open } from 'node:fs/promises'
import { request } from 'node:http'
import { verifyPrivateWorkFileAsync } from './work-files.js'

const JSON_LIMIT = 1024
const REQUEST_MS = 10000

/** @param {{directory:string|string[]}} options */
export function createGameEndpoint(options) {
  let identity = ''
  const directories = Array.isArray(options.directory) ? options.directory : [options.directory]

  async function readDiscovery(directory) {
    const path = join(directory, 'endpoint.json')
    const stat = await lstat(path)
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > JSON_LIMIT) throw new Error('invalid game endpoint discovery')
    const nextIdentity = `${path}:${stat.dev}:${stat.ino}:${stat.mtimeMs}:${stat.ctimeMs}:${stat.size}`
    if (identity !== nextIdentity) { await verifyPrivateWorkFileAsync(path); identity = nextIdentity }
    const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
    let value
    try {
      const data = Buffer.alloc(JSON_LIMIT + 1)
      const { bytesRead } = await file.read(data, 0, data.length, 0)
      if (bytesRead > JSON_LIMIT) throw new Error('invalid game endpoint discovery')
      value = JSON.parse(data.subarray(0, bytesRead).toString('utf8'))
    } finally { await file.close() }
    if (!value || value.version !== 1 || value.role !== 'piggy-work-events' || !Number.isInteger(value.port) ||
        value.port < 1 || value.port > 65535 || typeof value.token !== 'string' || !/^[a-f0-9]{64}$/.test(value.token)) {
      throw new Error('invalid game endpoint discovery')
    }
    return value
  }

  async function discover() {
    for (let index = 0; index < directories.length; index++) {
      try { return await readDiscovery(directories[index]) } catch (error) {
        if (error.code !== 'ENOENT' || index === directories.length - 1) throw error
      }
    }
  }

  return {
    /** 固定回环、禁用连接复用；超时覆盖响应正文，只有游戏提交确认才算成功。
     * @param {import('./protocol.js').WorkEvent} event
     */
    async receive(event) {
      const endpoint = await discover()
      const payload = JSON.stringify({ version: 1, source: 'opencode', id: event.id, type: event.type, at: event.at })
      let deadline
      return new Promise((resolve, reject) => {
        const req = request({ hostname: '127.0.0.1', port: endpoint.port, path: '/events', method: 'POST',
          agent: false, maxHeaderSize: 4096,
          headers: { authorization: `Bearer ${endpoint.token}`, 'content-type': 'application/json',
            'content-length': Buffer.byteLength(payload) } }, response => {
          const chunks = []
          let size = 0
          response.on('data', chunk => {
            size += chunk.length
            if (size > JSON_LIMIT) { req.destroy(new Error('invalid game response')); return }
            chunks.push(chunk)
          })
          response.on('error', reject)
          response.on('end', () => {
            if (response.statusCode !== 200) return reject(new Error(`game status ${response.statusCode}`))
            try {
              const value = JSON.parse(Buffer.concat(chunks).toString('utf8'))
              if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(response.headers['content-type'] ?? '') ||
                  !value || value.ok !== true || !['applied', 'duplicate', 'ignored'].includes(value.status)) {
                throw new Error('invalid game response')
              }
              resolve(value)
            } catch (error) { reject(new Error('invalid game response')) }
          })
        })
        deadline = setTimeout(() => req.destroy(new Error('game timeout')), REQUEST_MS)
        req.once('close', () => clearTimeout(deadline))
        req.on('error', reject)
        req.end(payload)
      }).finally(() => clearTimeout(deadline))
    },
  }
}
