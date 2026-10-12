// @ts-check
/** 验证发布标签并输出 CHANGELOG 对应版本及下载说明。 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const readJSON = path => JSON.parse(readFileSync(join(root, path), 'utf8'))
const version = readJSON('package.json').version
const tag = process.argv[2]

try {
  if (tag !== `v${version}`) throw new Error(`标签须与 package.json 一致：v${version}`)
  for (const path of ['packages/opencode-piggy/package.json', 'packages/opencode-bridge/package.json']) {
    if (readJSON(path).version !== version) throw new Error(`兼容层版本不一致：${path}`)
  }
  const changelog = readFileSync(join(root, 'CHANGELOG.md'), 'utf8')
  const sections = changelog.split(/^## /m).slice(1)
  const section = sections.find(text => text.startsWith(`[${version}] - `))
  if (!section) throw new Error(`CHANGELOG 缺少版本 ${version}`)
  const game = readJSON('upstream/dsh-piggy/package.json').version
  const installer = `opencode-piggy-setup-game-${game}-${version}-x64.exe`
  console.log(`## ${section.trim()}\n\n### 下载与使用\n\n` +
    `Windows x64：下载 \`${installer}\`，双击安装。需要 OpenCode V2 2.0.26 或以上；不需要另装 Node.js。\n\n` +
    '安装后重新加载 OpenCode 项目，从桌面快捷方式打开小猪。插件只启动后台桥，不自动启动小猪。\n\n' +
    '升级前退出小猪并停止使用插件的 OpenCode 后台服务，再运行新安装包。卸载保留存档与桥队列。\n\n' +
    '安装包未签名，包含固定 dsh-piggy 游戏及 OpenCode 接收适配。')
} catch (error) { console.error(error.message); process.exitCode = 1 }
