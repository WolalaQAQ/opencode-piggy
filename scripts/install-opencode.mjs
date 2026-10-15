// @ts-check
/** 安装仅写自己的插件入口；不解析、覆盖用户的 JSONC 配置，也不删除存档。 */
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const marker = '// opencode-piggy managed entry v1'

/** @param {{target:string,uninstall?:boolean,options?:object}} input */
export function installOpenCode(input) {
  const entry = join(input.target, 'opencode-piggy.js')
  const plugin = pathToFileURL(join(root, 'packages/opencode-piggy/index.js')).href
  if (existsSync(entry) && !readFileSync(entry, 'utf8').startsWith(marker)) {
    throw new Error(`不覆盖非托管插件入口：${entry}`)
  }
  if (input.uninstall) {
    if (existsSync(entry)) unlinkSync(entry)
    return entry
  }
  const text = `${marker}\n// @ts-check\n// 本入口只加载本机适配代码，不修改模型上下文。\nimport plugin from ${JSON.stringify(plugin)}\nexport default { ...plugin, setup: ctx => plugin.setup({ ...ctx, options: { ...ctx.options, ...${JSON.stringify(input.options ?? {})} } }) }\n`
  mkdirSync(input.target, { recursive: true })
  writeFileSync(entry, text)
  return entry
}

function main() {
  const args = process.argv.slice(2)
  const value = name => args.find(arg => arg.startsWith(`${name}=`))?.slice(name.length + 1)
  const project = value('--project')
  for (const arg of args) {
    if (!['--global', '--uninstall'].includes(arg) && !/^--(?:project|directory|game-endpoint)=.+$/.test(arg)) {
      throw new Error(`未知安装参数：${arg}`)
    }
  }
  if (!project && !args.includes('--global')) throw new Error('请选择 --project=/path/to/project 或 --global')
  const configHome = process.env.OPENCODE_CONFIG_DIR || join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'opencode')
  const target = project ? join(resolve(project), '.opencode/plugins') : join(configHome, 'plugins')
  const options = {
    ...(value('--directory') ? { directory: resolve(value('--directory')) } : {}),
    ...(value('--game-endpoint') ? { gameDirectory: resolve(value('--game-endpoint')) } : {}),
  }
  console.log(installOpenCode({ target, uninstall: args.includes('--uninstall'), options }))
  console.log(args.includes('--uninstall') ? '插件停用处理完成；存档保留。' : '插件入口已安装；重新加载 OpenCode 项目后生效。')
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try { main() } catch (error) { console.error(`opencode-piggy 安装失败：${error.message}`); process.exitCode = 1 }
}
