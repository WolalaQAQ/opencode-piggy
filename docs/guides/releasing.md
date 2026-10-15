# 打包与发布

本仓库只交付一个产物：自包含的 OpenCode 插件。它以 `.tgz` 和 `.zip` 两种归档发布在 GitHub Releases，不发布到 npm。

## 本地打包

打包需要 Node.js 22.15 或以上和 npm，先安装开发依赖：

```sh
npm install --ignore-scripts
```

`npm run pack:plugin` 用 libarchive 的 `tar`（bsdtar）同时生成 tgz 和 zip。Windows 和 macOS 的系统 `tar` 已经支持；Linux 需要先安装 `bsdtar`，Debian/Ubuntu 上的包名是 `libarchive-tools`。这些只是开发打包的条件，安装和运行插件不需要它们。

发布前的版本准备：

1. 根目录和 `packages/opencode-piggy/package.json` 使用同一版本，例如 `0.2.0-rc.1`。
2. 中英文 CHANGELOG 有对应版本小节，中英文 README 同步更新。

运行检查并打包：

```sh
npm run check
npm run pack:plugin
```

产物位于 `dist/`：

```text
dist/opencode-piggy-0.2.0-rc.1.tgz
dist/opencode-piggy-0.2.0-rc.1.zip
```

两个归档内容相同，顶层目录都是 `package/`，里面只有插件代码、`LICENSE` 和 `README`。插件只引用本包文件和 Node 内置模块，使用者不需要安装额外的 Node 才能运行或解包。

## 验证包内容

用 `tar` 查看 tgz 的文件清单，确认没有开发资料或包外依赖：

```sh
tar -tzf dist/opencode-piggy-0.2.0-rc.1.tgz
```

然后按[使用指南](opencode.md#安装插件)把归档解压到一个稳定目录，让 OpenCode 加载其中的 `package/`。在游戏关闭时执行一次工作，确认事件进入队列的 `events/`；用 `--work-events` 启动游戏后，事件应在一个重试周期内被投递并从队列消失。游戏需要包含主线提交 `8f72f17`。

## GitHub Release

Release 由 GitHub Actions 的 **Release** 工作流完成，使用自动提供的 `GITHUB_TOKEN`，仓库需要启用 Actions 并允许工作流写入内容。

### 标签发布

提交版本改动后推送 `v<版本>` 标签，例如 `v0.2.0-rc.1`。标签必须与根目录 `package.json` 的版本一致。工作流依次运行 `npm run check` 和打包，创建草稿 Release，上传 `.tgz` 与 `.zip`，最后公开。版本号带 `-` 时标记为预发布。

Release 只包含这两个插件归档，不包含游戏、安装程序或开发记录。

### 手动运行与重试

在 **Actions → Release → Run workflow** 中填写已经存在的版本标签。手动运行始终构建该标签的代码，而不是所选分支当前的代码。

默认勾选「仅生成草稿」，可以先检查产物和发布说明，再到 Releases 页面发布草稿。上传失败时 Release 保持草稿，重跑同一标签即可继续上传。已公开的 Release 不会被覆盖，后续修正使用新的版本号和标签。
