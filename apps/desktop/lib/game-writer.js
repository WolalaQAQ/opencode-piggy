// @ts-check
/** 游戏应用确认前同步存档目录；原 writer 已同步文件，POSIX rename 还需要目录落盘。 */
import { closeSync, fsyncSync, openSync } from 'node:fs'
import { dirname } from 'node:path'

/** @param {(path:string,state:any)=>void} writer @param {string} path @param {any} state */
export function persistGameState(writer, path, state) {
  writer(path, state)
  if (process.platform === 'win32') return
  const directory = openSync(dirname(path), 'r')
  try { fsyncSync(directory) } finally { closeSync(directory) }
}
