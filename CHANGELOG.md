# 变更记录

中文 | [English](CHANGELOG.en.md)

## [0.2.0] - 2026-10-30

### Features
- 第三方 agent 工作事件接口已转正，插件以正式版发布到 npm `latest`，安装目标为 `opencode-piggy@latest`。
- 跟进官方 dsh-piggy 0.37.2-rc.5（桌面外壳 0.6.8-rc.3），优先发现统一的 `piggy/work-endpoint` 目录。
- Linux 游戏发现遵循绝对路径的 `XDG_DATA_HOME`，默认使用 `~/.local/share/piggy/work-endpoint`。Windows 和 macOS 分别使用 `%APPDATA%/piggy/work-endpoint` 和 `~/Library/Application Support/piggy/work-endpoint`。

### Design Rationale
- 游戏数据目录由官方桌面外壳管理；插件跟随其默认位置，不迁移游戏数据或插件队列。
- 工作事件协议仍为 v1，事件格式、稳定 ID、提交确认与七天离线窗口保持不变。

### Notes & Caveats
- 从 `@next` 或固定 RC 版本升级时，先移除旧安装目标，再添加 `opencode-piggy@latest`；插件队列保留。
- 新目录没有发现文件时，仍依次回退到旧配置目录下的 `dsh-piggy/work-endpoint` 和 `dsh-piggy-desktop/work-endpoint`。
- `gameDirectory` 和 `PIGGY_USERDATA` 保持优先；显式指向旧目录的配置需要随游戏实际位置更新。启动游戏时仍需 `--work-events`。

## [0.2.0-rc.2] - 2026-10-16

### Features
- 插件以预发布版本发布到 npm 的 `next` 通道，包名 `opencode-piggy`。用 `opencode plugin add opencode-piggy@next` 安装，用 `plugin update`、`plugin remove` 更新和移除；需要固定版本时安装 `opencode-piggy@0.2.0-rc.2`。
- 不使用 npm 时，仍可通过 Git 子目录目标 `github:WolalaQAQ/opencode-piggy#v0.2.0-rc.2::path:packages/opencode-piggy` 安装，GitHub Releases 的 `.tgz` 和 `.zip` 归档用于离线安装。
- 事件映射、投递、离线重试和目录发现与 0.2.0-rc.1 相同，游戏要求不变。

### Design Rationale
- 下载、配置写入和更新交给 OpenCode 的插件管理，用户不必再手动解压或修改 JSON。
- 预发布版本放在 `next` 通道，不占用 npm 默认的 `latest`；正式版使用新的版本号，发布到 `latest` 时再转正。

### Notes & Caveats
- 游戏仍需包含主线提交 `8f72f17` 的工作事件接口，并以 `--work-events` 启动。
- 固定版本的安装目标不会自动跳到下一个版本，需要换成新版本号重新安装。

## [0.2.0-rc.1] - 2026-10-16

### Features
- 自包含 OpenCode V2 插件：订阅服务端公共事件，把工作记录映射成带稳定 ID 的事件，先异步写入持久发件箱，再通过 HTTP 投递给 dsh-piggy 的官方工作事件接口。Desktop 和 TUI 共用同一个插件，要求 OpenCode 2.0.26 或以上。
- 游戏关闭期间事件继续落盘，重开后补投；每 5 秒重试，收到 `applied`、`duplicate` 或 `ignored` 后才移除。超过官方 7 天接收窗口的事件停止自动投递并保留在磁盘上。
- 同一 OpenCode 服务中的多个项目共用一个投递器，最后一个插件卸载时停止；新项目会等待在途的关闭完成后再接手。
- 自动发现游戏的 `work-endpoint`：先找安装版的 `dsh-piggy`，其发现文件不存在时再找源码版的 `dsh-piggy-desktop`。可用 `PIGGY_USERDATA`、插件选项 `gameDirectory` 或安装参数 `--game-endpoint` 覆盖，显式设置优先。队列默认位于配置根目录下的 `opencode-piggy-plugin/`，可用 `directory` 或 `--directory` 指定。
- 以 `.tgz` 和 `.zip` 两种归档发布到 GitHub Releases，顶层目录统一为 `package/`，内容仅为插件代码、许可和 README。`npm run pack:plugin` 生成这两个归档。
- GitHub Actions 在推送 `v*` 标签时运行检查、打包并创建 Release，手动运行可以只生成草稿。

### Design Rationale
- 官方游戏提供了与框架无关的持久接收接口，插件在 OpenCode 一侧完成映射和可靠投递即可，不需要中间进程。发件箱放在 OpenCode 一侧，游戏断开时工作记录不丢失，重试沿用原事件 ID，游戏端去重。
- 插件只使用 Node 内置模块并保持目录自包含，使用者无需额外运行时。游戏由用户自己启动，插件不注册模型工具、不改模型上下文。

### Notes & Caveats
- 游戏需要包含主线提交 `8f72f17` 的工作事件接口，并以 `--work-events` 启动。
- `directory` 指插件队列目录，`gameDirectory` 指游戏的 `work-endpoint/` 目录，两者互相独立。
