# OpenCode 插件与独立工作桥

插件运行在 OpenCode V2 服务中（2.0.26 或以上），捕获工作事件并启动独立 Node 桥。桥没有窗口，不启动或退出小猪。游戏固定为 0.36.1，游戏侧接收适配支持源码运行和 Windows 安装包。

## Windows 安装

运行 Releases 页面下载的 `opencode-piggy-setup-game-0.36.1-0.1.0-rc.3-x64.exe`。默认安装到 `%LOCALAPPDATA%\Programs\OpenCode Piggy`，可在安装界面选择目录，不需要管理员权限。安装包内含完整游戏、Electron 和独立 Node 运行时，安装后离线也能打开小猪。

安装自动写入当前用户的全局 `opencode-piggy.js` 插件入口，不修改 JSON/JSONC；入口引用安装目录内的插件，桥使用内置的 `resources/bridge-node/node.exe`。已有非托管的同名入口不会被覆盖，安装详情会报告冲突。

重新加载 OpenCode 项目后生效。通过桌面或开始菜单中的 **OpenCode Piggy** 启动小猪；关闭小猪不关闭桥，安装本身也不启动小猪。

如果项目中已经启用了源码插件，先在源码仓库停用它，避免全局与项目两处重复启用：

```sh
node scripts/install-opencode.mjs --project="/path/to/your-project" --uninstall
```

若只想给一个项目启用，先用安装目录内的 Node 停用全局入口，再指定项目安装。PowerShell 示例：

```powershell
$install = "$env:LOCALAPPDATA\Programs\OpenCode Piggy"
& "$install\resources\bridge-node\node.exe" "$install\resources\app\scripts\install-opencode.mjs" --global --uninstall
& "$install\resources\bridge-node\node.exe" "$install\resources\app\scripts\install-opencode.mjs" --project="C:\path\to\project" "--node-executable=$install\resources\bridge-node\node.exe"
```

更新安装版前退出小猪，并停止加载了此插件的 OpenCode 后台服务，让安装目录内的运行时释放文件。安装目录不能直接移动；需要换目录时先停用插件并卸载，再安装到新位置。

适配外壳使用配套安装包更新，不通过原版的外壳自动更新替换接收适配。官方安装版仍不具备外部工作事件接入口。

## 启用插件与桥

需要 Node.js 22.15 或以上、OpenCode V2。桥本身不需要 Electron 或游戏子模块。

在仓库根目录给一个项目安装：

```sh
node scripts/install-opencode.mjs --project="/path/to/your-project"
```

全局启用使用 `--global`。脚本只管理自己的 `opencode-piggy.js` 自动发现入口，不覆盖 JSON/JSONC 或其他插件。全局位置遵循 `OPENCODE_CONFIG_DIR` 或 `~/.config/opencode/plugins/`，项目位置为 `.opencode/plugins/`。重新打开项目加载插件。入口引用本机源码目录，启用后不要移动或删除它。

多个项目共用当前用户的一个桥，各自保持生产者租约。最后一个插件实例卸载或租约到期后桥退出，未应用事件保留。OpenCode 后台服务可能在 Desktop 窗口关闭后继续运行，桥不会仅因窗口关闭而立即退出。

手动运行桥：

```sh
npm start
```

没有生产者连接的手动桥只保留启动宽限，不永久留在后台。

## 配置

安装命令可加：

- `--directory="/absolute/bridge-home"`：桥的队列和通信目录，不是小猪 userData。
- `--node-executable="/absolute/node"`：桥的 Node 运行时，不能填写 OpenCode 的 Bun/打包可执行文件或小猪程序。
- `--no-auto-start`：插件只连接已有桥，不唤醒桥。

桥运行时也识别 `PIGGY_BRIDGE_HOME` 和 `PIGGY_BRIDGE_NODE`。旧 `--executable`、`--exit-disconnected` 及插件 `executable` / `exitWhenDisconnected` 选项已移除。

如自行管理 V2 配置，保留其他配置并使用：

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    {
      "package": "/path/to/repository/packages/opencode-piggy",
      "options": { "autoStart": true }
    }
  ]
}
```

手工配置与自动发现入口选一种，不重复启用。

## 桥目录与游戏目录

| 系统 | 独立桥默认目录 |
|---|---|
| Windows | `%APPDATA%/opencode-piggy-bridge` |
| macOS | `~/Library/Application Support/opencode-piggy-bridge` |
| Linux | `$XDG_CONFIG_HOME/opencode-piggy-bridge`，默认 `~/.config/opencode-piggy-bridge` |

桥只保存事件 ID、类型、时间、队列和通信元数据，不保存聊天、代码或工具正文。`bridge.json` 含私有认证令牌，不分享整个目录。

源码游戏接收适配仍使用相应平台的 `opencode-piggy` userData，原格式存档在其 `dsh-piggy/state.json`。游戏 receipts/WAL 留在游戏目录，桥不读写它们。不合并 DSH/普通桌面版存档，也不自动迁入旧内置桥发件箱。

## 运行源码游戏接收端

在仓库根目录准备原版子模块和 Electron 运行依赖：

```sh
git submodule update --init --recursive
node scripts/prepare-release.mjs
npm run check
npm run start:receiver
```

依赖准备入口用于 Windows x64；其他平台自行准备 `apps/desktop` 的 Electron 依赖。指定目录时使用：

```sh
npm run start:receiver -- --piggy-opencode-home="/absolute/game-home" --piggy-bridge-home="/absolute/bridge-home"
```

接收端主动连接桥，不自行启动桥。原 Store、路由、接收器和游戏事务共用后台单写者；窗口、玩法和原格式存档保持不变。游戏持久应用成功才确认，桥入队成功不等于已获得成长。接收端退出不关闭桥，桥退出也不关闭游戏。

未完成的旧 v1 游戏 WAL 不能直接按新快照协议恢复：启动保留原文件并停止自动恢复/接收，不通过删除 WAL 强行继续。已有稳定收据保留；新事件使用新的语义 ID 版本，不追溯重演历史事件。

## 停用

Windows 安装版在系统的应用列表或开始菜单中卸载。卸载会移除指向该安装目录的全局插件入口、快捷方式和程序文件，保留游戏存档、桥队列及其他 OpenCode 配置；若入口已改为引用其他目录，不会删除它。项目级入口需要按安装时使用的项目路径手动停用。

卸载前退出小猪，并停止使用内置桥运行时的 OpenCode 后台服务。安装与卸载不会强行终止其他程序。

源码插件使用：

```sh
node scripts/install-opencode.mjs --project="/path/to/your-project" --uninstall
```

全局启用过使用 `--global --uninstall`。手工配置只移除自己的插件项。重新加载项目后插件释放自己的租约，其他项目不受影响；脚本不删除队列或游戏存档，也不关闭小猪。

## 官方安装版与平台

官方 dsh-piggy 0.36.1 不提供外部工作事件的接入口，扩展 API 也无法喂入工作成长。本仓库的 Windows 安装包包含接收适配，不是未经适配的官方原包，官方安装版不能直接与 OpenCode 联动。外部直接修改 `state.json` 会与常驻内存的 Store 竞争，不作为替代方案。

目前只提供 Windows x64 安装包。macOS 和 Linux 可以从源码运行插件与桥，但还没有做真实的 Desktop 联动验收。
