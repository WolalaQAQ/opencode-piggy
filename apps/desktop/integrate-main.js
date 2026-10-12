// @ts-check
/** 固定上游版本上的最小接入点。片段必须唯一匹配，更新上游时不能静默漏掉适配。 */
export const upstreamMainURL = new URL('../../upstream/dsh-piggy/apps/desktop/main.js', import.meta.url).href

const modeURL = new URL('./lib/opencode-mode.js', import.meta.url).href
const hostURL = new URL('./lib/work-host.js', import.meta.url).href

/** @param {string} source @param {string} before @param {string} after */
function replaceOnce(source, before, after) {
  const index = source.indexOf(before)
  if (index < 0 || source.indexOf(before, index + before.length) >= 0) {
    throw new Error(`upstream desktop integration mismatch: ${before.split('\n')[0]}`)
  }
  return source.slice(0, index) + after + source.slice(index + before.length)
}

/** @param {string} source @returns {string} */
export function integrateDesktopMain(source) {
  let text = source.replace(/\r\n/g, '\n')
  const edits = [
    ['const HERE = dirname(fileURLToPath(import.meta.url))',
      `import { opencodeMode } from ${JSON.stringify(modeURL)}
import { startWorkHost } from ${JSON.stringify(hostURL)}

const HERE = dirname(fileURLToPath(import.meta.url))
const workMode = opencodeMode(process.argv)`],
    ["if (process.env.PIGGY_USERDATA) app.setPath('userData', resolve(process.env.PIGGY_USERDATA))",
      `if (workMode.isEnabled) {
  mkdirSync(workMode.directory, { recursive: true, mode: 0o700 })
  app.setPath('userData', workMode.directory)
}
else if (process.env.PIGGY_USERDATA) app.setPath('userData', resolve(process.env.PIGGY_USERDATA))`],
    ["return app.isPackaged ? join(process.resourcesPath, 'game') : join(HERE, 'game')",
      "return resolve(HERE, '../..')"],
    ['mode: shellUpdateMode({ platform: process.platform, packaged: app.isPackaged,',
      "mode: workMode.isEnabled ? 'manual' : shellUpdateMode({ platform: process.platform, packaged: app.isPackaged,"],
    ["  if (!fromPage(event) || shellUpdates === null) return { ok: false, reason: '桌面外壳更新不可用' }",
      "  if (workMode.isEnabled) return { ok: false, reason: 'OpenCode 接收适配请使用配套安装包更新' }\n  if (!fromPage(event) || shellUpdates === null) return { ok: false, reason: '桌面外壳更新不可用' }"],
    ['  host.dispose()\n  const target = statePath()',
      '  await host.dispose()\n  const target = statePath()'],
    ['function restartGame() {', 'async function restartGame() {'],
    ['  try { host?.dispose() } catch { /* best effort */ }\n  // Testing runs one launch at a time;',
      `  try { await host?.dispose() } catch (error) { log('host shutdown failed', String(error)); quitting = false; return }
  // Testing runs one launch at a time;`],
    ["  host = await startHost(gameDir, statePath(), { fetch: net.fetch.bind(net), onSnapshot: view => toPages('piggy:state-changed', view) })",
      `  const hostOptions = { fetch: net.fetch.bind(net), onSnapshot: view => toPages('piggy:state-changed', view) }
  host = workMode.isEnabled
    ? await startWorkHost({ ...hostOptions, directory: workMode.directory,
      bridgeDirectory: workMode.bridgeDirectory, statePath: statePath(), gameDir,
      announce: announceStateChanged, log: message => log('opencode', message) })
    : await startHost(gameDir, statePath(), hostOptions)`],
    ['  createTray(gameDir)\n', "  createTray(gameDir)\n  if (workMode.isEnabled) log('opencode receiver ready')\n"],
    ['  pushGeometry()\n})\n\n/**',
      `  pushGeometry()
}).catch(error => {
  log('startup failed', error instanceof Error ? error.message : String(error))
  app.quit()
})

/**`],
    ["app.on('second-instance', () => win?.showInactive())\napp.on('before-quit', () => { quitting = true; stopDrag(); if (hitTimer !== null) clearInterval(hitTimer); try { host?.dispose() } catch { /* best effort */ } })",
      `app.on('second-instance', () => { if (!workMode.isEnabled) win?.showInactive() })
let isHostClosed = false
let hostClosing = null
app.on('before-quit', event => {
  quitting = true
  stopDrag()
  if (hitTimer !== null) clearInterval(hitTimer)
  if (workMode.isEnabled && host && !isHostClosed) {
    event.preventDefault()
    if (!hostClosing) hostClosing = host.dispose().then(() => {
      isHostClosed = true
      app.quit()
    }).catch(error => {
      log('host shutdown failed', error.message)
      hostClosing = null
      quitting = false
    })
    return
  }
  try { host?.dispose() } catch (error) { log('host dispose failed', String(error)) }
})`],
  ]
  for (const [before, after] of edits) text = replaceOnce(text, before, after)
  return text
}
