// @ts-check
/** 验证插件版本与发布标签，输出双语变更记录及下载说明。 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const readJSON = path => JSON.parse(readFileSync(join(root, path), 'utf8'))
const version = readJSON('package.json').version
const plugin = readJSON('packages/opencode-piggy/package.json')
const tag = process.argv[2]
const repository = 'https://github.com/WolalaQAQ/opencode-piggy'

/** @param {string} path */
function changelogSection(path) {
  const sections = readFileSync(join(root, path), 'utf8').split(/^## /m).slice(1)
  const section = sections.find(text => text.startsWith(`[${version}] - `))
  if (!section) throw new Error(`${path} 缺少版本 ${version}`)
  return `## ${section.trim()}`
}

try {
  if (tag !== `v${version}`) throw new Error(`标签须与 package.json 一致：v${version}`)
  if (plugin.version !== version) throw new Error('根目录与插件的 package.json 版本不一致')
  const chinese = changelogSection('CHANGELOG.md')
  const english = changelogSection('CHANGELOG.en.md')
  const base = `${plugin.name}-${version}`
  const downloads = ['tgz', 'zip'].map(extension => {
    const name = `${base}.${extension}`
    return `- [${name}](${repository}/releases/download/${tag}/${name})`
  }).join('\n')
  console.log(`# 中文\n\n${chinese}\n\n### 下载与使用\n\n${downloads}\n\n` +
    '下载任一压缩包并解压，将 OpenCode 配置中插件项的 `package` 指向解压后 `package/` 目录的绝对路径。\n\n' +
    `游戏要求与配置方法见 [README](${repository}/blob/${tag}/README.md)。\n\n---\n\n` +
    `# English\n\n${english}\n\n### Download and use\n\n${downloads}\n\n` +
    'Extract either archive and set the plugin entry’s `package` in your OpenCode configuration to the absolute path of the extracted `package/` directory.\n\n' +
    `See the [README](${repository}/blob/${tag}/README.en.md) for game requirements and configuration.`)
} catch (error) { console.error(error.message); process.exitCode = 1 }
