# OpenCode Piggy

中文 | [English](README.en.md)

OpenCode Piggy 是一个自包含的 OpenCode V2 插件，让 [dsh-piggy](https://github.com/CLICGGER-TYPES/dsh-piggy) 桌宠随你在 OpenCode 里的工作成长。

插件订阅 OpenCode 服务端的公共事件，把工作记录映射成带稳定 ID 的事件，先异步写入本地持久发件箱，再通过 HTTP 投递给游戏的官方工作事件接口。服务端事件对 OpenCode Desktop 和 TUI 一视同仁，两者共用同一个插件。

插件不注册模型工具，也不改动模型上下文。小猪由你自己启动；玩法、数值和存档都由游戏管理。

| 组件 | 要求 |
|---|---|
| OpenCode | V2，2.0.26 或以上 |
| dsh-piggy | 推荐 0.37.2-rc.5（桌面外壳 0.6.8-rc.3），以 `--work-events` 启动 |
| 插件版本 | 0.2.1 |

## 快速开始

### 1. 安装插件

用 OpenCode V2 的命令行从 npm 安装正式版：

```sh
opencode plugin add opencode-piggy@latest
```

命令默认安装为全局插件并写入配置，不需要手动下载、解压或修改 JSON。重新加载项目后插件生效，Desktop 和 TUI 都不需要额外设置。插件只使用 Node 内置模块。

`latest` 跟随正式版本；要固定版本，安装 `opencode-piggy@0.2.1`。固定版本不会自动跳到下一个版本。从 `@next` 或固定 RC 版本升级时，先移除旧安装目标，再添加 `@latest`，队列会保留。不使用 npm 时，可以改用 GitHub 目标 `github:WolalaQAQ/opencode-piggy#v0.2.1::path:packages/opencode-piggy`，见[使用指南](https://github.com/WolalaQAQ/opencode-piggy/blob/main/docs/guides/opencode.md#用命令行安装)。

### 2. 启动游戏

插件只负责投递，游戏需要你自己打开。工作事件接口默认关闭，启动官方 dsh-piggy 时加上 `--work-events`；如果你从官方仓库的源码运行，在安装好依赖的 `apps/desktop` 目录执行：

```sh
npm run pack-game
npx electron . --work-events
```

使用安装版时，在应用的启动参数里加入 `--work-events` 即可。[官方 0.37.2-rc.5](https://github.com/CLICGGER-TYPES/dsh-piggy/releases/tag/v0.37.2-rc.5) 已包含所需接口；下载文件名中的 `0.6.8-rc.3` 是桌面外壳版本。

之后正常使用 OpenCode，你的工作会被投递给小猪。只想在某个项目里启用、离线安装发布包或自定义目录时，参见[使用指南](https://github.com/WolalaQAQ/opencode-piggy/blob/main/docs/guides/opencode.md)。

## 离线与重试

事件先落盘再投递，已持久化的记录在游戏没打开时会保留，游戏重新启动后自动补投。插件每 5 秒重试一次；游戏的接收窗口是 7 天，超过窗口的事件会保留在磁盘上并停止自动投递。事件只有在游戏返回 `applied`、`duplicate` 或 `ignored` 之后才会从发件箱移除，重试始终使用原来的事件 ID，不会重复计数。

同一个 OpenCode 服务里的多个项目共用一个投递器，最后一个项目卸载插件时才停止。

## 目录与数据

插件优先在官方 `piggy` 数据目录中查找游戏接口。使用「独立完整存档」时，插件会根据当前存档选择自动找到接口，无需配置 `gameDirectory`；找不到该接口时再检查下表中的默认目录。事件队列保持原位置：

| 系统 | 游戏接口目录 | 插件队列目录 |
|---|---|---|
| Windows | `%APPDATA%/piggy/work-endpoint` | `%APPDATA%/opencode-piggy-plugin` |
| macOS | `~/Library/Application Support/piggy/work-endpoint` | `~/Library/Application Support/opencode-piggy-plugin` |
| Linux | `$XDG_DATA_HOME/piggy/work-endpoint`，默认 `~/.local/share/piggy/work-endpoint` | `$XDG_CONFIG_HOME/opencode-piggy-plugin`，默认 `~/.config/opencode-piggy-plugin` |

Linux 的 `XDG_DATA_HOME` 仅在值为绝对路径时生效。统一数据目录没有接口时，插件会继续检查旧数据目录 `dsh-piggy` 和 `dsh-piggy-desktop`。显式设置的 `gameDirectory` 优先；如果它仍指向旧接口，可以移除该选项以恢复自动发现。

队列的 `events/` 里只保存事件 ID、类型和时间，不含聊天内容、代码或工具输出。游戏自定义了数据目录，或想改队列位置时，参见[使用指南](https://github.com/WolalaQAQ/opencode-piggy/blob/main/docs/guides/opencode.md#配置游戏目录与队列)。反馈问题时请不要分享游戏接口目录中的 `endpoint.json`，其中含本机认证令牌。

## 使用指南

[使用指南](https://github.com/WolalaQAQ/opencode-piggy/blob/main/docs/guides/opencode.md)涵盖 CLI 安装与停用、项目级配置、离线安装、目录选项和排障；[发布指南](https://github.com/WolalaQAQ/opencode-piggy/blob/main/docs/guides/releasing.md)说明如何打包与发布。

## 开发

仓库只包含插件本身：

| 路径 | 内容 |
|---|---|
| `packages/opencode-piggy/` | 插件：事件映射、持久发件箱、官方接口发现与 HTTP 投递 |
| `scripts/` | 安装脚本、类型检查与打包 |

开发依赖只有 TypeScript 和 Node 类型，源码工具使用 Node.js 22.15 或以上：

```sh
npm install --ignore-scripts
npm run check
```

从源码直接启用插件时，可以在仓库根目录运行 `node scripts/install-opencode.mjs --global`，或用 `--project="/path/to/project"` 只为一个项目启用。版本变化见 [CHANGELOG](https://github.com/WolalaQAQ/opencode-piggy/blob/main/CHANGELOG.md)。

## 许可

[MIT](https://github.com/WolalaQAQ/opencode-piggy/blob/main/LICENSE)。
