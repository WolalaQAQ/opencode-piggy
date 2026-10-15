# OpenCode Piggy

中文 | [English](README.en.md)

OpenCode Piggy 是一个自包含的 OpenCode V2 插件，让 [dsh-piggy](https://github.com/CLICGGER-TYPES/dsh-piggy) 桌宠随你在 OpenCode 里的工作成长。

插件订阅 OpenCode 服务端的公共事件，把工作记录映射成带稳定 ID 的事件，先异步写入本地持久发件箱，再通过 HTTP 投递给游戏的官方工作事件接口。服务端事件对 OpenCode Desktop 和 TUI 一视同仁，两者共用同一个插件。

插件不注册模型工具，也不改动模型上下文。小猪由你自己启动；玩法、数值和存档都由游戏管理。

| 组件 | 要求 |
|---|---|
| OpenCode | V2，2.0.26 或以上 |
| dsh-piggy | 包含主线提交 `8f72f17` 的工作事件接口，并以 `--work-events` 启动 |
| 插件版本 | 0.2.0-rc.1 |

## 快速开始

### 1. 获取插件

在本仓库的 [Releases](https://github.com/WolalaQAQ/opencode-piggy/releases) 下载 `opencode-piggy-0.2.0-rc.1.tgz` 或 `.zip`，两者内容相同，解压后顶层都是 `package/`。把它解压到一个长期保留的目录。macOS 和 Linux：

```sh
mkdir -p ~/opencode-plugins/opencode-piggy
tar -xzf opencode-piggy-0.2.0-rc.1.tgz -C ~/opencode-plugins/opencode-piggy
```

Windows PowerShell 直接解压 `.zip`：

```powershell
Expand-Archive opencode-piggy-0.2.0-rc.1.zip -DestinationPath $HOME\opencode-plugins\opencode-piggy
```

解压后的插件目录是目标目录下的 `package/`，例如 `~/opencode-plugins/opencode-piggy/package`。

### 2. 在 OpenCode 中启用

在项目的 `opencode.jsonc` 里加入插件项，全局的 `opencode.jsonc` 写法相同：

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    { "package": "/home/me/opencode-plugins/opencode-piggy/package" }
  ]
}
```

路径要写绝对路径，并指向 `package/` 目录。重新加载项目后插件生效，Desktop 和 TUI 都不需要额外设置。插件只使用 Node 内置模块，不需要你另外安装 Node。

### 3. 启动游戏

插件只负责投递，游戏需要你自己打开。工作事件接口默认关闭，启动官方 dsh-piggy 时加上 `--work-events`；如果你从官方仓库的源码运行，在安装好依赖的 `apps/desktop` 目录执行：

```sh
npm run pack-game
npx electron . --work-events
```

使用安装版时，在应用的启动参数里加入 `--work-events` 即可。游戏需要包含接口所在的主线提交 `8f72f17`，获取方式见[官方仓库](https://github.com/CLICGGER-TYPES/dsh-piggy)。

之后正常使用 OpenCode，你的工作会被投递给小猪。

## 离线与重试

事件先落盘再投递，已持久化的记录在游戏没打开时会保留，游戏重新启动后自动补投。插件每 5 秒重试一次；游戏的接收窗口是 7 天，超过窗口的事件会保留在磁盘上并停止自动投递。事件只有在游戏返回 `applied`、`duplicate` 或 `ignored` 之后才会从发件箱移除，重试始终使用原来的事件 ID，不会重复计数。

同一个 OpenCode 服务里的多个项目共用一个投递器，最后一个项目卸载插件时才停止。

## 目录与数据

插件默认在配置根目录下发现游戏的 `dsh-piggy/work-endpoint`，找不到时再尝试源码版的 `dsh-piggy-desktop/work-endpoint`；事件队列默认保存在配置根目录下的 `opencode-piggy-plugin/`。Windows 的配置根目录是 `%APPDATA%`，macOS 是 `~/Library/Application Support`，Linux 是 `$XDG_CONFIG_HOME` 或 `~/.config`。

队列的 `events/` 里只保存事件 ID、类型和时间，不含聊天内容、代码或工具输出。游戏自定义了数据目录，或想改队列位置时，参见[使用指南](https://github.com/WolalaQAQ/opencode-piggy/blob/main/docs/guides/opencode.md#配置游戏目录与队列)。反馈问题时请不要分享游戏 `work-endpoint/endpoint.json`，其中含本机认证令牌。

## 使用指南

[使用指南](https://github.com/WolalaQAQ/opencode-piggy/blob/main/docs/guides/opencode.md)涵盖手工配置、安装脚本、目录选项、停用和排障；[发布指南](https://github.com/WolalaQAQ/opencode-piggy/blob/main/docs/guides/releasing.md)说明如何打包与发布。

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
