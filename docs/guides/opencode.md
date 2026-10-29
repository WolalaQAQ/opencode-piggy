# OpenCode 插件使用指南

OpenCode Piggy 运行在 OpenCode V2 服务里（2.0.26 或以上）。它订阅服务端公共事件，把工作记录映射成带稳定 ID 的事件，先写入自己的持久发件箱，再通过 HTTP 投递给 dsh-piggy 的官方工作事件接口。Desktop 和 TUI 连接的是同一个服务，因此共用同一个插件，不需要按客户端分别安装。

插件不注册模型工具，不改动模型上下文，也不会替你打开游戏。

## 准备游戏

推荐使用[官方 0.37.2-rc.5](https://github.com/CLICGGER-TYPES/dsh-piggy/releases/tag/v0.37.2-rc.5)，配套桌面外壳为 0.6.8-rc.3，已包含工作事件接口。启动时加上 `--work-events`，接口默认关闭。发布附件名使用桌面外壳版本，不是游戏版本。

从官方源码运行时，在安装好依赖的 `apps/desktop` 目录执行：

```sh
npm run pack-game
npx electron . --work-events
```

使用官方安装版时，把 `--work-events` 加到应用的启动参数里。接口只监听本机随机端口并要求令牌认证，发现文件位于游戏数据目录下的 `work-endpoint/endpoint.json`。

## 安装插件

插件只依赖 Node 内置模块，不需要游戏源码、Electron 或另外安装的 Node。下面的安装方式选一种即可，同时配置多份会让插件重复加载。

### 用命令行安装

`opencode plugin add` 支持 npm 和 Git 目标。从 npm 安装正式版：

```sh
opencode plugin add opencode-piggy@latest
```

命令默认把插件安装为全局插件并写入配置。配置会自动重载；需要手动重新加载时，在 OpenCode 中执行 `/reload`。

`latest` 跟随正式版本。需要固定版本时安装精确版本，固定版本不会自动跳到下一个版本：

```sh
opencode plugin add opencode-piggy@0.2.0
```

更新、查看和移除都使用安装时的同一个目标：

```sh
opencode plugin list
opencode plugin update opencode-piggy@latest
opencode plugin remove opencode-piggy@latest
```

要从固定版本换到新版本，先 `remove` 旧目标，再用新的版本号 `add`。

此前安装了预发布通道 `@next` 的，切换到正式通道：

```sh
opencode plugin remove opencode-piggy@next
opencode plugin add opencode-piggy@latest
```

固定 RC 版本用它原来的目标执行 `remove`。移除不会删除插件队列；若在配置文件里设置了 `options`，只替换 `package` 目标并保留选项。

### 不使用 npm 时

插件也可以直接从 GitHub 仓库的子目录安装，标签、分支和 `::path:` 子目录选择器都可以使用：

```sh
opencode plugin add "github:WolalaQAQ/opencode-piggy#v0.2.0::path:packages/opencode-piggy"
```

`list` 和 `remove` 同样传这个完整目标：

```sh
opencode plugin remove "github:WolalaQAQ/opencode-piggy#v0.2.0::path:packages/opencode-piggy"
```

标签固定了版本，不会自动跳到下一个标签；换版本时先移除旧目标，再用新标签安装。

### 在项目配置里启用

只想在某个项目里启用，或者需要给插件设置[选项](#配置游戏目录与队列)时，在配置文件里写同样的目标。项目的 `opencode.jsonc` 如下：

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    { "package": "opencode-piggy@latest" }
  ]
}
```

全局配置文件的写法相同。已经用命令行全局安装的话，不要再在项目里写一份。

### 离线安装发布包

没有 GitHub 或 npm 访问条件时，可以使用 [Releases](https://github.com/WolalaQAQ/opencode-piggy/releases) 里的归档。`opencode-piggy-0.2.0.tgz` 和 `opencode-piggy-0.2.0.zip` 内容相同，顶层目录都是 `package/`。选一个稳定的位置解压，之后 OpenCode 会一直从这里加载插件。macOS 和 Linux：

```sh
mkdir -p /path/to/plugins/opencode-piggy
tar -xzf opencode-piggy-0.2.0.tgz -C /path/to/plugins/opencode-piggy
```

Windows PowerShell 可以直接解压 `.zip`：

```powershell
Expand-Archive opencode-piggy-0.2.0.zip -DestinationPath C:\path\to\plugins\opencode-piggy
```

也可以用系统自带的解压工具。无论哪种方式，插件目录都是解压位置下的 `package/`。`plugin add` 不接受 tarball，所以需要在配置文件里写这个绝对路径：

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    { "package": "/path/to/plugins/opencode-piggy/package" }
  ]
}
```

更新时解压新版本到新的目录并修改配置中的路径，保存后自动重载。需要手动重新加载时，在 OpenCode 中执行 `/reload`。

### 跟踪主线（开发者）

想使用主线上尚未发布的改动时，用 Git 目标的 `#main` 分支：

```sh
opencode plugin add "github:WolalaQAQ/opencode-piggy#main::path:packages/opencode-piggy"
```

分支目标可以用 `plugin check` 和 `plugin update` 管理，参数同样传完整目标：

```sh
opencode plugin check
opencode plugin update "github:WolalaQAQ/opencode-piggy#main::path:packages/opencode-piggy"
```

主线可能包含未发布的改动，日常使用请安装 `latest` 或带版本号的正式发布。

### 从源码启用（开发者）

在仓库根目录用脚本生成自动发现入口，需要 Node.js 22.15 或以上：

```sh
node scripts/install-opencode.mjs --project="/path/to/your-project"
```

全局启用改用 `--global`。脚本只维护自己创建的 `opencode-piggy.js`，不改写你的 JSON/JSONC 配置或其他插件，也不会覆盖同名的非托管文件。入口写在项目的 `.opencode/plugins/`，全局入口写在 OpenCode 配置目录的 `plugins/` 下（遵循 `OPENCODE_CONFIG_DIR`，否则为 `$XDG_CONFIG_HOME/opencode`，默认 `~/.config/opencode`）。入口引用仓库里的插件目录，启用后不要移动它。

## 配置游戏目录与队列

插件有两个可选的路径设置，都用绝对路径。`plugin add` 不接受选项，所以需要设置时在配置文件里写插件项：

| 插件选项 | 安装脚本参数 | 用途 |
|---|---|---|
| `gameDirectory` | `--game-endpoint` | 游戏的 `work-endpoint/` 目录，也就是 `endpoint.json` 所在目录，不是存档目录 |
| `directory` | `--directory` | 插件自己的队列目录，事件保存在其中的 `events/` |

配置示例：

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    {
      "package": "opencode-piggy@latest",
      "options": {
        "gameDirectory": "/path/to/game-data/work-endpoint",
        "directory": "/path/to/plugin-data"
      }
    }
  ]
}
```

用安装脚本时对应写成：

```sh
node scripts/install-opencode.mjs --project="/path/to/your-project" --game-endpoint="/path/to/game-data/work-endpoint" --directory="/path/to/plugin-data"
```

### 默认位置

不设置选项时，插件优先发现官方统一的 `piggy/work-endpoint` 目录，安装版和源码版使用相同位置。插件队列不随游戏迁移：

| 系统 | 游戏接口目录 | 插件队列目录 |
|---|---|---|
| Windows | `%APPDATA%/piggy/work-endpoint` | `%APPDATA%/opencode-piggy-plugin` |
| macOS | `~/Library/Application Support/piggy/work-endpoint` | `~/Library/Application Support/opencode-piggy-plugin` |
| Linux | `$XDG_DATA_HOME/piggy/work-endpoint`，默认 `~/.local/share/piggy/work-endpoint` | `$XDG_CONFIG_HOME/opencode-piggy-plugin`，默认 `~/.config/opencode-piggy-plugin` |

Linux 的 `XDG_DATA_HOME` 仅在值为绝对路径时生效，相对路径按未设置处理。新目录下的 `endpoint.json` 不存在时，插件依次回退到旧配置根目录下的 `dsh-piggy/work-endpoint` 和 `dsh-piggy-desktop/work-endpoint`。旧配置根目录在 Windows、macOS 上分别是 `%APPDATA%`、`~/Library/Application Support`，Linux 上是 `$XDG_CONFIG_HOME` 或默认的 `~/.config`。

多个版本同时运行时优先连接新目录的游戏；想连接另一个实例，请明确设置 `gameDirectory`。显式的 `gameDirectory`（或 `--game-endpoint`）总是优先于所有自动发现。已有配置如果仍指向旧目录，游戏迁移后需将它改为实际的 `work-endpoint` 目录，或移除这个选项以恢复自动发现。

### 自定义游戏数据目录

游戏通过环境变量 `PIGGY_USERDATA` 指定数据目录。OpenCode 服务的环境里也能读到这个变量时，插件会使用 `$PIGGY_USERDATA/work-endpoint`。只在启动游戏的终端里设置变量不会改变已经运行的 OpenCode 服务，这种情况请用 `gameDirectory`。

若用游戏的 `--user-data-dir` 参数指定目录，也请把 `gameDirectory` 设置为该目录下的 `work-endpoint`。

例如在 PowerShell 中用自定义目录运行官方源码版：

```powershell
$env:PIGGY_USERDATA = 'C:\path\to\game-data'
npx electron . --work-events
```

macOS 和 Linux 写作 `PIGGY_USERDATA=/path/to/game-data npx electron . --work-events`。然后把插件的 `gameDirectory` 指向 `/path/to/game-data/work-endpoint`。

## 投递与离线

插件先把事件写进队列，再投递，所以游戏没有运行时已持久化的记录依然保留。投递失败会每 5 秒重试一次，游戏重新打开后自动补投。官方接收窗口为 7 天，超过窗口的事件会停止自动投递，文件仍留在 `events/` 供检查。

只有游戏返回 `applied`、`duplicate` 或 `ignored` 时，事件才会从队列移除。重试沿用原来的事件 ID 和时间，同一件事不会被重复计数；事件是否带来成长由游戏规则决定。

同一个 OpenCode 服务里，使用相同队列和游戏目录的多个项目共用一个投递器，最后一个项目卸载插件时才停止。新项目恰好在上一个投递器关闭期间加载时，会等待关闭完成再接手。一个队列目录对应一套游戏目录，要连接不同的游戏，请为它们设置不同的 `directory`。关闭 Desktop 窗口或 TUI 不一定会停止后台服务，插件停止时尚未投递的事件会留在磁盘上。

## 隐私

`events/` 里的文件只记录事件 ID、类型和时间，不含聊天内容、代码或工具输出。游戏存档及其收据完全由游戏管理，插件不会读写。`work-endpoint/endpoint.json` 包含本机认证令牌，反馈问题时请不要分享它或整个游戏数据目录。

## 停用

用命令行安装的插件用 `opencode plugin remove` 移除，传入安装时的同一个目标（如 `opencode-piggy@latest`），见[用命令行安装](#用命令行安装)。写在配置文件里的，删除对应的插件项。从源码用脚本启用的，用同样的范围参数加上 `--uninstall`：

```sh
node scripts/install-opencode.mjs --project="/path/to/your-project" --uninstall
```

全局入口使用 `--global --uninstall`。重新加载对应项目后生效。停用不会关闭小猪，也不会删除队列或游戏存档。

## 小猪没有收到工作事件

按下面的顺序检查：

1. **游戏接口**：推荐官方 0.37.2-rc.5（桌面外壳 0.6.8-rc.3），并以 `--work-events` 启动。
2. **发现目录**：游戏数据目录下是否有 `work-endpoint/endpoint.json`。`gameDirectory` 应指向它所在的目录，而不是 JSON 文件或存档目录。
3. **插件加载**：OpenCode 是否为 V2 的 2.0.26 或以上，用 `opencode plugin list` 确认插件已安装，项目是否已重新加载，有没有同时存在的全局、项目或脚本重复入口。OpenCode 日志中以 `[opencode-piggy]` 开头的行来自插件。
4. **待投事件**：队列目录的 `events/` 下是否还有事件文件。游戏打开后等一个重试周期；已过 7 天接收窗口的事件不会再自动投递。

插件没有独立的后台进程，排障时只需关注 OpenCode 服务、游戏和队列目录。
