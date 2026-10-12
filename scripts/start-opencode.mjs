// @ts-check
/** 手动运行源码游戏接收端；插件不调用此入口。 */
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { checkUpstream } from './check-upstream.mjs'

checkUpstream()
const desktop = fileURLToPath(new URL('../apps/desktop/', import.meta.url))
const executable = createRequire(new URL('../apps/desktop/package.json', import.meta.url))('electron')
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
const child = spawn(executable, [desktop, '--opencode', ...process.argv.slice(2)], { stdio: 'inherit', env })
child.on('error', error => { console.error(`opencode-piggy start failed: ${error.message}`); process.exitCode = 1 })
child.on('exit', code => { process.exitCode = code ?? 1 })
