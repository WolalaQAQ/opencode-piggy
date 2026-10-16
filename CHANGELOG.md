# 变更记录

中文 | [English](CHANGELOG.en.md)

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
