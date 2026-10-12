// @ts-check
/** 只在加载时接入兼容层；原版主进程及其相对资源仍从子模块读取。 */
import * as nodeModule from 'node:module'
import { app } from 'electron'
import { integrateDesktopMain, upstreamMainURL } from './integrate-main.js'

// 安装版双击进入接收模式；源码仍由启动参数选择。
if (app.isPackaged && !process.argv.includes('--opencode')) process.argv.push('--opencode')

// 兼容现有 Node 20 类型声明；运行时能力由实际 Electron 的 Node 版本决定。
const registerHooks = Reflect.get(nodeModule, 'registerHooks')
if (typeof registerHooks !== 'function') throw new Error('Electron runtime requires node:module.registerHooks')

registerHooks({
  resolve(specifier, context, nextResolve) {
    // 桌面运行依赖装在兼容入口旁，原版模块仍保留自己的相对路径。
    const parentURL = context.parentURL === upstreamMainURL && specifier === 'electron-updater'
      ? import.meta.url : context.parentURL
    return nextResolve(specifier, { ...context, parentURL })
  },
  load(url, context, nextLoad) {
    const loaded = nextLoad(url, context)
    if (url !== upstreamMainURL) return loaded
    if (loaded.source === null || loaded.source === undefined) throw new Error('upstream desktop source unavailable')
    return { ...loaded, source: integrateDesktopMain(Buffer.from(loaded.source).toString('utf8')) }
  },
})

await import(upstreamMainURL)
