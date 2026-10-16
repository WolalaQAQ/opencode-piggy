# OpenCode Piggy

中文 | [English](README.en.md)

OpenCode Piggy 是一个自包含的 OpenCode V2 插件，让 [dsh-piggy](https://github.com/CLICGGER-TYPES/dsh-piggy) 桌宠随你在 OpenCode 里的工作成长。

插件订阅 OpenCode 服务端的公共事件，把工作记录映射成带稳定 ID 的事件，先异步写入本地持久发件箱，再通过 HTTP 投递给游戏的官方工作事件接口。服务端事件对 OpenCode Desktop 和 TUI 一视同仁，两者共用同一个插件。

插件不注册模型工具，也不改动模型上下文。小猪由你自己启动；玩法、数值和存档都由游戏管理。

| 组件 | 要求 |
|---|---|
| OpenCode | V2，2.0.26 或以上 |
| dsh-piggy | 包含主线提交 `8f72f17` 的工作事件接口，并以 `--work-events` 启动 |
| 插件版本 | 0.2.0-rc.2 |

## 快速开始

### 1. 安装插件

用 OpenCode V2 的命令行从 npm 安装预发布通道 `next`：

```sh
opencode plugin add opencode-piggy@next
```

命令默认安装为全局插件并写入配置，不需要手动下载、解压或修改 JSON。重新加载项目后插件生效，Desktop 和 TUI 都不需要额外设置。插件只使用 Node 内置模块。

`next` 是预发布通道，随新的预发布版本前移；要固定版本，安装 `opencode-piggy@0.2.0-rc.2`。固定版本不会自动跳到下一个版本。不使用 npm 时，可以改用 GitHub 目标 `github:WolalaQAQ/opencode-piggy#v0.2.0-rc.2::path:packages/opencode-piggy`，见[使用指南](https://github.com/WolalaQAQ/opencode-piggy/blob/main/docs/guides/opencode.md#用命令行安装)。

### 2. 启动游戏

插件只负责投递，游戏需要你自己打开。工作事件接口默认关闭，启动官方 dsh-piggy 时加上 `--work-events`；如果你从官方仓库的源码运行，在安装好依赖的 `apps/desktop` 目录执行：

```sh
npm run pack-game
npx electron . --work-events
```

使用安装版时，在应用的启动参数里加入 `--work-events` 即可。游戏需要包含接口所在的主线提交 `8f72f17`，获取方式见[官方仓库](https://github.com/CLICGGER-TYPES/dsh-piggy)。

之后正常使用 OpenCode，你的工作会被投递给小猪。只想在某个项目里启用、离线安装发布包或自定义目录时，参见[使用指南](https://github.com/WolalaQAQ/opencode-piggy/blob/main/docs/guides/opencode.md)。

## 离线与重试

事件先落盘再投递，已持久化的记录在游戏没打开时会保留，游戏重新启动后自动补投。插件每 5 秒重试一次；游戏的接收窗口是 7 天，超过窗口的事件会保留在磁盘上并停止自动投递。事件只有在游戏返回 `applied`、`duplicate` 或 `ignored` 之后才会从发件箱移除，重试始终使用原来的事件 ID，不会重复计数。

同一个 OpenCode 服务里的多个项目共用一个投递器，最后一个项目卸载插件时才停止。

## 目录与数据

插件默认在配置根目录下发现游戏的 `dsh-piggy/work-endpoint`，找不到时再尝试源码版的 `dsh-piggy-desktop/work-endpoint`；事件队列默认保存在配置根目录下的 `opencode-piggy-plugin/`。Windows 的配置根目录是 `%APPDATA%`，macOS 是 `~/Library/Application Support`，Linux 是 `$XDG_CONFIG_HOME` 或 `~/.config`。

队列的 `events/` 里只保存事件 ID、类型和时间，不含聊天内容、代码或工具输出。游戏自定义了数据目录，或想改队列位置时，参见[使用指南](https://github.com/WolalaQAQ/opencode-piggy/blob/main/docs/guides/opencode.md#配置游戏目录与队列)。反馈问题时请不要分享游戏 `work-endpoint/endpoint.json`，其中含本机认证令牌。

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
