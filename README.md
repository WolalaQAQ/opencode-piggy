# OpenCode Piggy

中文 | [English](README.en.md)

OpenCode Piggy 让 [dsh-piggy](https://github.com/CLICGGER-TYPES/dsh-piggy) 桌宠随 OpenCode 的工作成长。OpenCode V2 插件捕获工作事件，交给一个没有窗口的独立后台桥，游戏再按原规则应用这些事件。窗口、玩法、数值、存档、客户端和素材都来自原版 dsh-piggy。插件运行在 OpenCode 服务中，OpenCode Desktop 和 TUI 共用同一套联动。

dsh-piggy 官方安装包没有接收外部工作事件的入口，所以本仓库提供自己的 Windows x64 安装包：它内置固定版本的游戏和接收适配，安装后即可与 OpenCode 联动。

| 组件 | 版本 |
|---|---|
| OpenCode Piggy（兼容层） | 0.1.0-rc.3 |
| dsh-piggy 游戏（固定子模块） | 0.36.1 |
| 桌面外壳适配 | 0.6.5-rc.2 |
| OpenCode | V2（Desktop 与 TUI），2.0.26 或以上 |

安装包在 [Releases](../../releases) 页面下载。

## Windows 安装

下载 `opencode-piggy-setup-game-0.36.1-0.1.0-rc.3-x64.exe`，双击运行，按提示选择安装目录。默认目录是 `%LOCALAPPDATA%\Programs\OpenCode Piggy`。安装包没有代码签名，Windows 可能提示未知发布者。

安装包内含游戏、Electron 和独立的 Node 运行时，不需要另外安装 Git、Node 或 npm，也不需要管理员权限。安装会为当前用户启用全局 OpenCode 插件，并创建桌面和开始菜单的 **OpenCode Piggy** 快捷方式。

安装后：

1. 重新加载 OpenCode 项目，插件随之生效，并在需要时启动后台桥。
2. 双击 **OpenCode Piggy** 快捷方式打开小猪，不用时直接关闭。

插件在 OpenCode 服务中加载，Desktop 和 TUI 无需分别配置：在任一客户端里工作，都会推进小猪。TUI 联动已在 Windows、OpenCode 2.0.27 上验证。

安装不会自动打开小猪。桥跟随插件和 OpenCode 后台服务的生命周期，与小猪窗口是否打开无关；小猪没开着时，工作事件先留在队列里，下次打开后再应用。

升级时先退出小猪，并停止加载了此插件的 OpenCode 后台服务，然后运行新版安装包，选择原安装目录即可覆盖安装。卸载在 Windows 的应用列表或开始菜单中进行。升级和卸载都会保留游戏存档和桥队列。更多细节见[使用指南](docs/guides/opencode.md)。

## 隐私

桥只保存事件 ID、类型、时间和队列元数据，不记录聊天内容、代码或工具输出正文。桥目录里的 `bridge.json` 含有本机认证令牌，反馈问题时不要分享整个目录。

## 平台与源码使用

桌宠安装包面向 Windows x64。在 macOS 和 Linux 上，可以从源码运行 OpenCode 插件与桥。

源码入口需要 Node.js 22.15 或以上，以及 OpenCode V2。

### 只启用插件与桥

插件和桥不需要 Electron，也不需要游戏子模块。在本仓库根目录给一个项目安装：

```sh
node scripts/install-opencode.mjs --project="/path/to/your-project"
```

在 OpenCode Desktop 或 TUI 中重新打开项目，插件会连接或启动独立 Node 桥，不会启动或退出小猪。插件引用本机源码目录，启用后不要移动它。全局启用、设置与停用见[使用指南](docs/guides/opencode.md)。

也可以手动运行桥：

```sh
npm start
```

最后一个插件实例断开后桥退出，未应用的事件保留在队列中。

### 运行源码游戏接收端

准备 Git、游戏子模块和 Electron 依赖：

```sh
git submodule update --init --recursive
node scripts/prepare-release.mjs
npm run check
npm run start:receiver
```

`prepare-release.mjs` 面向 Windows x64；其他平台请自行准备 `apps/desktop` 的 Electron 依赖。接收端主动连接已有的桥，不启动桥，退出时也不关闭桥。

### 构建 Windows 安装包

在 Windows x64 上准备好上面的依赖和 NSIS 3 编译器。`makensis.exe` 不在 PATH 时，将 `MAKENSIS` 设置为它的完整路径：

```powershell
$env:MAKENSIS = 'C:\Program Files (x86)\NSIS\makensis.exe'
npm run dist:win
```

安装包生成在 `dist/`，`win-x64-unpacked/` 是同内容的解包目录。构建复用子模块里已编译的 `client.js`，并把构建所用的 Node 可执行文件及其许可装入桥运行时。

### 类型检查

`node scripts/prepare-release.mjs` 同时准备类型检查依赖，然后运行：

```sh
npm run typecheck
```

## 仓库结构

| 路径 | 内容 |
|---|---|
| `upstream/dsh-piggy/` | 原版 Git submodule，固定在游戏 0.36.1 的提交 `329be94` |
| `packages/opencode-piggy/` | OpenCode V2 插件、事件映射、投递和自动启动 |
| `packages/opencode-bridge/` | 独立 Node 桥、私有队列、租约和共用协议，不加载游戏 Store |
| `apps/desktop/` | 游戏接收适配、后台宿主、游戏 WAL 和 Windows 安装配置 |
| `core.js`、`store.js`、`store/state-file.js` | 兼容导出，全部转发到子模块 |
| `scripts/` | 启用、启动、接入检查、类型检查和安装包构建 |
| `.github/workflows/release.yml` | Windows 安装包的标签发布与手动草稿流程 |

原版的 `assets/`、`src/`、扩展及其文档只存在于子模块。版本变更见 [CHANGELOG](CHANGELOG.md)，维护者的发版步骤见[发布指南](docs/guides/releasing.md)。

## 上游版本

`git submodule update --init --recursive` 使用本仓库记录的固定提交，不会自动追随上游最新版本。升级游戏时，先在子模块里选定目标提交，运行 `npm run check` 并验证桌面行为，再在本仓库提交新的子模块指针和必要的适配调整。子模块源码保持不改。

## 许可

兼容层使用 [MIT](LICENSE) 许可。原版代码、素材和第三方依赖的许可见 [THIRD-PARTY](THIRD-PARTY.md)。
