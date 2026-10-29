# 打包与发布

本仓库只交付一个产物：自包含的 OpenCode 插件。用户通过 `opencode plugin add opencode-piggy@latest` 从 npm 的正式通道安装；不使用 npm 时可以用 GitHub 的 Git 子目录目标安装，GitHub Releases 上的 `.tgz` 和 `.zip` 归档用于离线安装。

## 本地打包

打包需要 Node.js 22.15 或以上和 npm，先安装开发依赖：

```sh
npm install --ignore-scripts
```

`npm run pack:plugin` 用 libarchive 的 `tar`（bsdtar）同时生成 tgz 和 zip。Windows 和 macOS 的系统 `tar` 已经支持；Linux 需要先安装 `bsdtar`，Debian/Ubuntu 上的包名是 `libarchive-tools`。这些只是开发打包的条件，安装和运行插件不需要它们。

发布前的版本准备：

1. 根目录和 `packages/opencode-piggy/package.json` 使用同一正式版本，例如 `0.2.0`。
2. 中英文 CHANGELOG 有对应版本小节，中英文 README 同步更新。

运行检查并打包：

```sh
npm run check
npm run pack:plugin
```

产物位于 `dist/`：

```text
dist/opencode-piggy-0.2.0.tgz
dist/opencode-piggy-0.2.0.zip
```

两个归档内容相同，顶层目录都是 `package/`，里面只有插件代码、`LICENSE` 和 `README`。插件只引用本包文件和 Node 内置模块，使用者不需要安装额外的 Node 才能运行或解包。

## 验证包内容

用 `tar` 查看 tgz 的文件清单，确认没有开发资料或包外依赖：

```sh
tar -tzf dist/opencode-piggy-0.2.0.tgz
```

然后按[使用指南](opencode.md#离线安装发布包)把归档解压到一个稳定目录，让 OpenCode 加载其中的 `package/`。在游戏关闭时执行一次工作，确认事件进入队列的 `events/`；用 `--work-events` 启动游戏后，事件应通过自动重试投递并从队列消失。推荐使用官方 0.37.2-rc.5（桌面外壳 0.6.8-rc.3），并核对插件能自动发现新 `piggy` 数据目录；同时保留旧目录回退的验收。

## 发布到 npm

正式版由已登录的维护者在本机手工发布 tgz，发布到 `latest` 标签。发布前先确认最终的发布目标（包名、版本、标签、公开访问）和包内容，确认后再执行：

```sh
npm login
npm run check
npm run pack:plugin
npm publish ./dist/opencode-piggy-0.2.0.tgz --access public --tag latest --registry=https://registry.npmjs.org
```

只发布 `dist/` 里的插件 tgz，不发布根目录的 `package.json`（它是私有的开发包），也不用 zip。想先预检，在发布命令末尾加 `--dry-run`，它会列出将要发布的内容而不真正上传。

正式版使用不带预发布后缀的新版本号，GitHub Release 不标记为预发布。保留旧 `next` 标签供历史安装使用，不再向该标签发布本次版本。npm 上的版本发布后不能重新使用同一个版本号。

## GitHub Release

Release 由 GitHub Actions 的 **Release** 工作流完成，使用自动提供的 `GITHUB_TOKEN`，仓库需要启用 Actions 并允许工作流写入内容。

### 标签发布

提交版本改动后推送 `v<版本>` 标签，例如 `v0.2.0`。标签必须与根目录 `package.json` 的版本一致。工作流依次运行 `npm run check` 和打包，创建草稿 Release，上传 `.tgz` 与 `.zip`，最后公开。正式版本不会标记为预发布。

Release 只包含这两个插件归档，不包含游戏、安装程序或开发记录。工作流不发布 npm 包；Git 子目录目标使用的标签就是这里推送的 `v<版本>` 标签。

### 手动运行与重试

在 **Actions → Release → Run workflow** 中填写已经存在的版本标签。手动运行始终构建该标签的代码，而不是所选分支当前的代码。

默认勾选「仅生成草稿」，可以先检查产物和发布说明，再到 Releases 页面发布草稿。上传失败时 Release 保持草稿，重跑同一标签即可继续上传。已公开的 Release 不会被覆盖，后续修正使用新的版本号和标签。
