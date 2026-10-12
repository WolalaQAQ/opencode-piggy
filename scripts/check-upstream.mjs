// @ts-check
/** 检查子模块是否就绪及启动接入点能否匹配；不生成或复制原版文件。 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { integrateDesktopMain, upstreamMainURL } from '../apps/desktop/integrate-main.js'

/** @returns {string} */
export function checkUpstream() {
  let source
  try { source = readFileSync(fileURLToPath(upstreamMainURL), 'utf8') } catch (error) {
    throw new Error('dsh-piggy submodule unavailable; run git submodule update --init --recursive', { cause: error })
  }
  integrateDesktopMain(source)
  return upstreamMainURL
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try { checkUpstream(); console.log('dsh-piggy submodule and desktop integration ready') }
  catch (error) { console.error(error.message); process.exitCode = 1 }
}
